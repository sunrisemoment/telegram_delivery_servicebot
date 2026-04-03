from __future__ import annotations

import logging
import os
from typing import Any

import requests
from geopy.distance import geodesic
from geopy.geocoders import Nominatim
from sqlalchemy.orm import Session

from . import models

logger = logging.getLogger(__name__)

DEFAULT_CENTER = {
    "name": "Atlantic Station",
    "address": "Atlantic Station, Atlanta, GA",
    "lat": 33.7901,
    "lng": -84.3972,
}


class DeliveryService:
    def __init__(self, db: Session):
        self.db = db
        self.geolocator = Nominatim(user_agent="delivery_bot")
        self.google_maps_api_key = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()

    def _get_settings(self) -> models.Settings:
        settings = self.db.query(models.Settings).first()
        if settings:
            return settings

        settings = models.Settings(id=1)
        self.db.add(settings)
        self.db.commit()
        self.db.refresh(settings)
        return settings

    def _get_origin(self, settings: models.Settings) -> dict[str, Any]:
        return {
            "name": settings.central_location_name or DEFAULT_CENTER["name"],
            "address": settings.central_location_address or DEFAULT_CENTER["address"],
            "lat": settings.central_location_lat or DEFAULT_CENTER["lat"],
            "lng": settings.central_location_lng or DEFAULT_CENTER["lng"],
        }

    def _geocode_with_google(self, address_text: str) -> dict[str, Any] | None:
        if not self.google_maps_api_key:
            return None

        try:
            response = requests.get(
                "https://maps.googleapis.com/maps/api/geocode/json",
                params={
                    "address": address_text,
                    "key": self.google_maps_api_key,
                },
                timeout=10,
            )
            payload = response.json()
            if response.status_code != 200 or payload.get("status") != "OK":
                logger.warning("Google geocoding failed for %s: %s", address_text, payload.get("status"))
                return None

            result = payload["results"][0]
            location = result["geometry"]["location"]
            return {
                "provider": "google_maps",
                "lat": location["lat"],
                "lng": location["lng"],
                "formatted_address": result.get("formatted_address") or address_text,
            }
        except Exception as exc:
            logger.warning("Google geocoding request failed for %s: %s", address_text, exc)
            return None

    def _geocode_with_nominatim(self, address_text: str) -> dict[str, Any] | None:
        try:
            location = self.geolocator.geocode(address_text)
            if not location:
                return None
            return {
                "provider": "nominatim",
                "lat": location.latitude,
                "lng": location.longitude,
                "formatted_address": getattr(location, "address", None) or address_text,
            }
        except Exception as exc:
            logger.warning("Nominatim geocoding failed for %s: %s", address_text, exc)
            return None

    def geocode_address(self, address_text: str) -> dict[str, Any]:
        if not address_text or not address_text.strip():
            raise ValueError("Delivery address is required")

        normalized_address = address_text.strip()
        geocoded = self._geocode_with_google(normalized_address) or self._geocode_with_nominatim(normalized_address)
        if not geocoded:
            raise ValueError("Unable to validate the delivery address")
        return geocoded

    def calculate_delivery_quote(self, address_text: str) -> dict[str, Any]:
        settings = self._get_settings()
        origin = self._get_origin(settings)
        geocoded = self.geocode_address(address_text)
        destination = (geocoded["lat"], geocoded["lng"])
        origin_coords = (origin["lat"], origin["lng"])
        distance_miles = float(geodesic(origin_coords, destination).miles)

        atlantic_station_radius = max(float(settings.atlantic_station_radius_miles or 0), 0)
        inside_i285_radius = max(float(settings.inside_i285_radius_miles or 0), atlantic_station_radius)
        outside_i285_radius = max(float(settings.outside_i285_radius_miles or 0), inside_i285_radius)
        max_delivery_radius = max(float(settings.max_delivery_radius_miles or 0), outside_i285_radius)

        if distance_miles <= atlantic_station_radius:
            zone_name = "Atlantic Station"
            fee_cents = int(settings.atlantic_station_fee_cents or 0)
        elif distance_miles <= inside_i285_radius:
            zone_name = "Inside I-285"
            fee_cents = int(settings.inside_i285_fee_cents or 0)
        elif distance_miles <= outside_i285_radius:
            zone_name = "Outside I-285"
            fee_cents = int(settings.outside_i285_fee_cents or 0)
        elif not getattr(settings, "delivery_radius_enforced", True):
            zone_name = "Outside I-285"
            fee_cents = int(settings.outside_i285_fee_cents or 0)
        else:
            raise ValueError(
                f"Delivery address is outside the service radius ({distance_miles:.1f} miles from {origin['name']})"
            )

        if getattr(settings, "delivery_radius_enforced", True) and distance_miles > max_delivery_radius:
            raise ValueError(
                f"Delivery address is outside the maximum service radius ({max_delivery_radius:.1f} miles)"
            )

        return {
            "delivery_fee_cents": fee_cents,
            "delivery_zone": zone_name,
            "distance_miles": round(distance_miles, 2),
            "origin_name": origin["name"],
            "origin_address": origin["address"],
            "resolved_address": geocoded["formatted_address"],
            "geocoder_provider": geocoded["provider"],
            "max_delivery_radius_miles": max_delivery_radius,
            "atlantic_station_radius_miles": atlantic_station_radius,
            "inside_i285_radius_miles": inside_i285_radius,
            "outside_i285_radius_miles": outside_i285_radius,
        }

    def calculate_delivery_fee(self, address_text: str) -> tuple[int, str]:
        quote = self.calculate_delivery_quote(address_text)
        return quote["delivery_fee_cents"], quote["delivery_zone"]


def get_delivery_service(db: Session) -> DeliveryService:
    return DeliveryService(db)
