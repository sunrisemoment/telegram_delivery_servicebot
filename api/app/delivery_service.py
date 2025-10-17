# [file name]: delivery_service.py
from sqlalchemy.orm import Session
from geopy.geocoders import Nominatim
from geopy.distance import geodesic
import logging
from typing import Optional, Tuple
from . import models

logger = logging.getLogger(__name__)

class DeliveryService:
    def __init__(self, db: Session):
        self.db = db
        self.geolocator = Nominatim(user_agent="delivery_bot")
    
    def calculate_delivery_fee(self, address_text: str, city: str = "YourCity") -> Tuple[int, str]:
        """
        Calculate delivery fee based on address
        Returns: (fee_cents, zone_name)
        """
        try:
            # Get delivery zones from database
            zones = self.db.query(models.DeliveryZone).filter(
                models.DeliveryZone.active == True
            ).all()
            
            if not zones:
                # Fallback: if no zones configured, use simple city-based logic
                return self._fallback_calculation(address_text, city)
            
            # Try to geocode the address
            location = self.geolocator.geocode(f"{address_text}, {city}")
            if not location:
                logger.warning(f"Could not geocode address: {address_text}")
                return self._fallback_calculation(address_text, city)
            
            customer_coords = (location.latitude, location.longitude)
            
            # Check if address is within any delivery zone
            for zone in zones:
                if self._is_in_delivery_zone(customer_coords, zone):
                    return zone.base_fee_cents, zone.name
            
            # If not in any zone, charge outside city fee
            return zones[0].outside_city_fee_cents, "Outside City"
            
        except Exception as e:
            logger.error(f"Error calculating delivery fee: {e}")
            # Fallback to base fee
            return 1000, "Standard"
    
    def _is_in_delivery_zone(self, coords: Tuple[float, float], zone: models.DeliveryZone) -> bool:
        """Check if coordinates are within delivery zone polygon"""
        # Simple implementation - you might want to use a proper geo library
        # This is a simplified version - in production, use shapely or similar
        if not zone.polygon_coords:
            # If no polygon defined, assume entire city
            return True
            
        # Basic point-in-polygon check (simplified)
        # For production, implement proper point-in-polygon algorithm
        try:
            polygon = zone.polygon_coords.get('coordinates', [])[0]
            return self._point_in_polygon(coords[0], coords[1], polygon)
        except:
            return True  # Fallback to True if polygon check fails
    
    def _point_in_polygon(self, x: float, y: float, poly: list) -> bool:
        """Ray casting algorithm for point in polygon"""
        n = len(poly)
        inside = False
        p1x, p1y = poly[0]
        for i in range(n + 1):
            p2x, p2y = poly[i % n]
            if y > min(p1y, p2y):
                if y <= max(p1y, p2y):
                    if x <= max(p1x, p2x):
                        if p1y != p2y:
                            xints = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                        if p1x == p2x or x <= xints:
                            inside = not inside
            p1x, p1y = p2x, p2y
        return inside
    
    def _fallback_calculation(self, address_text: str, city: str) -> Tuple[int, str]:
        """Fallback delivery fee calculation based on text analysis"""
        address_lower = address_text.lower()
        city_lower = city.lower()
        
        # Check if address contains city name (simple heuristic)
        if city_lower in address_lower:
            return 1000, "Within City"
        else:
            return 1000, "Outside City"

def get_delivery_service(db: Session) -> DeliveryService:
    return DeliveryService(db)