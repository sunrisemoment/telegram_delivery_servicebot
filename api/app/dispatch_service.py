from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from . import models
from .audit_service import log_audit_event
from .dispatch_rules import (
    ACTIVE_DRIVER_ORDER_STATUSES,
    driver_can_accept_order,
    ensure_order_ready_for_dispatch,
    get_driver_active_order_count,
    normalize_order_status,
)
from .telegram_service import telegram_service


def _get_settings(db: Session) -> models.Settings:
    settings = db.query(models.Settings).first()
    if settings:
        return settings
    settings = models.Settings(id=1)
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return settings


def serialize_working_hours(hours: models.DriverWorkingHours) -> dict:
    return {
        "id": hours.id,
        "day_of_week": hours.day_of_week,
        "start_local_time": hours.start_local_time,
        "end_local_time": hours.end_local_time,
        "active": hours.active,
    }


def summarize_driver_working_hours(driver: models.Driver) -> str:
    windows = sorted(
        [hours for hours in (getattr(driver, "working_hours", []) or []) if getattr(hours, "active", True)],
        key=lambda hours: (hours.day_of_week, hours.start_local_time),
    )
    if not windows:
        return "Always available"

    day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    return " • ".join(
        f"{day_names[hours.day_of_week]} {hours.start_local_time}-{hours.end_local_time}"
        for hours in windows
    )


def serialize_dispatch_offer(offer: models.DriverAssignmentOffer) -> dict:
    destination = None
    total_cents = None
    delivery_or_pickup = None
    if offer.order:
        destination = offer.order.delivery_address_text or offer.order.pickup_address_text
        total_cents = offer.order.total_cents
        delivery_or_pickup = offer.order.delivery_or_pickup
    return {
        "id": offer.id,
        "order_number": offer.order.order_number if offer.order else None,
        "delivery_or_pickup": delivery_or_pickup,
        "destination": destination,
        "total_cents": total_cents,
        "driver_id": offer.driver_id,
        "driver_name": offer.driver.name if offer.driver else None,
        "status": offer.status,
        "sequence_number": offer.sequence_number,
        "response_note": offer.response_note,
        "offered_at": offer.offered_at.isoformat() if offer.offered_at else None,
        "expires_at": offer.expires_at.isoformat() if offer.expires_at else None,
        "responded_at": offer.responded_at.isoformat() if offer.responded_at else None,
    }


def serialize_dispatch_queue(queue: models.DispatchQueueEntry | None) -> dict | None:
    if not queue:
        return None
    return {
        "id": queue.id,
        "status": queue.status,
        "started_by_username": queue.started_by_username,
        "current_offer_id": queue.current_offer_id,
        "last_offered_driver_id": queue.last_offered_driver_id,
        "last_processed_at": queue.last_processed_at.isoformat() if queue.last_processed_at else None,
        "created_at": queue.created_at.isoformat() if queue.created_at else None,
        "updated_at": queue.updated_at.isoformat() if queue.updated_at else None,
    }


def get_order_dispatch_snapshot(db: Session, order: models.Order) -> dict:
    queue = db.query(models.DispatchQueueEntry).filter(
        models.DispatchQueueEntry.order_id == order.id
    ).first()
    offers = db.query(models.DriverAssignmentOffer).filter(
        models.DriverAssignmentOffer.order_id == order.id
    ).order_by(models.DriverAssignmentOffer.sequence_number.asc()).all()
    return {
        "dispatch_queue": serialize_dispatch_queue(queue),
        "dispatch_offers": [serialize_dispatch_offer(offer) for offer in offers],
    }


def _driver_offer_timeout_seconds(db: Session) -> int:
    settings = _get_settings(db)
    return max(int(getattr(settings, "dispatch_offer_timeout_seconds", 90) or 90), 15)


def _notify_driver_offer(driver: models.Driver, order: models.Order, expires_at: datetime) -> None:
    if not driver.telegram_id:
        return
    destination = order.delivery_address_text or order.pickup_address_text or "Pending destination"
    telegram_service.send_message(
        driver.telegram_id,
        (
            "📣 <b>Dispatch Offer</b>\n\n"
            f"📦 <b>Order #:</b> <code>{order.order_number}</code>\n"
            f"📍 <b>Type:</b> {order.delivery_or_pickup.title()}\n"
            f"🚚 <b>Destination:</b> {destination}\n"
            f"💰 <b>Total:</b> ${order.total_cents / 100:.2f}\n"
            f"⏳ <b>Respond by:</b> {expires_at.astimezone().strftime('%Y-%m-%d %H:%M:%S %Z')}\n\n"
            "Open the Mini App driver workspace to accept or decline this offer."
        ),
    )


def _notify_customer_assignment(order: models.Order, driver: models.Driver, db: Session) -> None:
    customer = order.customer
    if not customer or not customer.telegram_id:
        return

    pickup_info = ""
    if order.delivery_or_pickup == "pickup" and driver.pickup_address_id:
        pickup_address = db.query(models.PickupAddress).filter(
            models.PickupAddress.id == driver.pickup_address_id
        ).first()
        if pickup_address:
            pickup_info = f"\n📍 <b>Pickup Location:</b>\n{pickup_address.name}\n{pickup_address.address}"
            if pickup_address.instructions:
                pickup_info += f"\n📝 <b>Instructions:</b> {pickup_address.instructions}"

    telegram_service.notify_order_status_update(
        customer.telegram_id,
        order.order_number,
        "assigned",
        driver_name=driver.name,
        additional_info=pickup_info,
    )


def _build_candidate_drivers(
    db: Session,
    order: models.Order,
    *,
    exclude_driver_ids: set[int] | None = None,
) -> list[models.Driver]:
    excluded = exclude_driver_ids or set()
    drivers = db.query(models.Driver).filter(models.Driver.active.is_(True)).all()
    ranked: list[tuple[int, datetime | None, models.Driver]] = []
    for driver in drivers:
        if driver.id in excluded:
            continue
        can_accept, _ = driver_can_accept_order(db, driver, order)
        if not can_accept:
            continue
        active_order_count = get_driver_active_order_count(db, driver.id, exclude_order_id=order.id)
        ranked.append((active_order_count, driver.created_at, driver))
    ranked.sort(key=lambda item: (item[0], item[1] or datetime.max.replace(tzinfo=timezone.utc), item[2].id))
    return [driver for _, _, driver in ranked]


def _ensure_queue_entry(
    db: Session,
    order: models.Order,
    started_by_username: str,
) -> models.DispatchQueueEntry:
    queue = db.query(models.DispatchQueueEntry).filter(
        models.DispatchQueueEntry.order_id == order.id
    ).first()
    if queue:
        if not queue.started_by_username:
            queue.started_by_username = started_by_username
        return queue

    queue = models.DispatchQueueEntry(
        order_id=order.id,
        status="queued",
        started_by_username=started_by_username,
        last_processed_at=datetime.now(timezone.utc),
    )
    db.add(queue)
    db.flush()
    return queue


def _mark_offer_status(
    db: Session,
    offer: models.DriverAssignmentOffer,
    status: str,
    *,
    response_note: str | None = None,
) -> None:
    offer.status = status
    offer.responded_at = datetime.now(timezone.utc)
    if response_note is not None:
        offer.response_note = response_note
    db.add(offer)


def _offer_next_driver(
    db: Session,
    queue: models.DispatchQueueEntry,
    *,
    actor_username: str,
) -> models.DriverAssignmentOffer | None:
    order = db.query(models.Order).filter(models.Order.id == queue.order_id).first()
    if not order:
        queue.status = "cancelled"
        queue.current_offer_id = None
        return None

    normalized_status = normalize_order_status(order.status)
    if normalized_status in {"delivered", "cancelled"}:
        queue.status = "closed"
        queue.current_offer_id = None
        return None

    offered_driver_ids = {
        offer.driver_id
        for offer in db.query(models.DriverAssignmentOffer).filter(
            models.DriverAssignmentOffer.order_id == order.id
        ).all()
    }
    candidates = _build_candidate_drivers(db, order, exclude_driver_ids=offered_driver_ids)
    if not candidates:
        queue.status = "exhausted"
        queue.current_offer_id = None
        queue.last_processed_at = datetime.now(timezone.utc)
        db.add(
            models.OrderEvent(
                order_id=order.id,
                type="dispatch_queue_exhausted",
                payload={"actor_username": actor_username},
            )
        )
        log_audit_event(
            db,
            actor_type="admin",
            actor_username=actor_username,
            action="dispatch_queue_exhausted",
            entity_type="order",
            entity_id=order.order_number,
        )
        return None

    driver = candidates[0]
    next_sequence = (db.query(models.DriverAssignmentOffer).filter(
        models.DriverAssignmentOffer.order_id == order.id
    ).count()) + 1
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=_driver_offer_timeout_seconds(db))
    offer = models.DriverAssignmentOffer(
        order_id=order.id,
        queue_entry_id=queue.id,
        driver_id=driver.id,
        sequence_number=next_sequence,
        status="pending",
        created_by_username=actor_username,
        expires_at=expires_at,
    )
    queue.status = "offering"
    queue.last_offered_driver_id = driver.id
    queue.last_processed_at = datetime.now(timezone.utc)
    db.add(offer)
    db.flush()
    queue.current_offer_id = offer.id
    db.add(
        models.OrderEvent(
            order_id=order.id,
            type="driver_offer_created",
            payload={
                "driver_id": driver.id,
                "driver_name": driver.name,
                "sequence_number": next_sequence,
                "expires_at": expires_at.isoformat(),
            },
        )
    )
    log_audit_event(
        db,
        actor_type="admin",
        actor_username=actor_username,
        action="driver_offer_created",
        entity_type="order",
        entity_id=order.order_number,
        payload={"driver_id": driver.id, "sequence_number": next_sequence},
    )
    _notify_driver_offer(driver, order, expires_at)
    return offer


def process_expired_dispatch_offers(
    db: Session,
    *,
    actor_username: str = "system",
) -> int:
    settings = _get_settings(db)
    expired_count = 0
    now = datetime.now(timezone.utc)
    pending_offers = db.query(models.DriverAssignmentOffer).filter(
        models.DriverAssignmentOffer.status == "pending",
        models.DriverAssignmentOffer.expires_at <= now,
    ).all()
    for offer in pending_offers:
        queue = db.query(models.DispatchQueueEntry).filter(
            models.DispatchQueueEntry.id == offer.queue_entry_id
        ).first()
        if not queue:
            continue
        _mark_offer_status(db, offer, "expired", response_note="Offer timed out")
        queue.status = "queued"
        queue.current_offer_id = None
        queue.last_processed_at = now
        db.add(
            models.OrderEvent(
                order_id=offer.order_id,
                type="driver_offer_expired",
                payload={
                    "driver_id": offer.driver_id,
                    "offer_id": offer.id,
                },
            )
        )
        log_audit_event(
            db,
            actor_type="system",
            actor_username=actor_username,
            action="driver_offer_expired",
            entity_type="order",
            entity_id=offer.order.order_number if offer.order else offer.order_id,
            payload={"offer_id": offer.id, "driver_id": offer.driver_id},
        )
        expired_count += 1
        if getattr(settings, "dispatch_auto_escalate", True):
            _offer_next_driver(db, queue, actor_username=actor_username)

    if expired_count:
        db.commit()
    return expired_count


def start_dispatch_queue(
    db: Session,
    order_number: str,
    *,
    actor_username: str,
) -> dict:
    process_expired_dispatch_offers(db, actor_username=actor_username)

    order = db.query(models.Order).filter(models.Order.order_number == order_number).first()
    if not order:
        raise ValueError("Order not found")

    ensure_order_ready_for_dispatch(order)
    if normalize_order_status(order.status) in {"delivered", "cancelled"}:
        raise ValueError("Dispatch queue cannot start for a closed order")

    queue = _ensure_queue_entry(db, order, actor_username)
    offer = None
    if queue.current_offer_id:
        current_offer = db.query(models.DriverAssignmentOffer).filter(
            models.DriverAssignmentOffer.id == queue.current_offer_id
        ).first()
        if current_offer and current_offer.status == "pending" and current_offer.expires_at > datetime.now(timezone.utc):
            offer = current_offer
        else:
            queue.current_offer_id = None

    if not offer and order.driver_id and normalize_order_status(order.status) in ACTIVE_DRIVER_ORDER_STATUSES:
        queue.status = "assigned"
    elif not offer:
        offer = _offer_next_driver(db, queue, actor_username=actor_username)

    db.commit()
    db.refresh(queue)
    if offer:
        db.refresh(offer)
    return {
        "order": order,
        "dispatch_queue": serialize_dispatch_queue(queue),
        "current_offer": serialize_dispatch_offer(offer) if offer else None,
        "dispatch_offers": [
            serialize_dispatch_offer(item)
            for item in db.query(models.DriverAssignmentOffer).filter(
                models.DriverAssignmentOffer.order_id == order.id
            ).order_by(models.DriverAssignmentOffer.sequence_number.asc()).all()
        ],
    }


def respond_to_dispatch_offer(
    db: Session,
    *,
    offer_id: int,
    driver_id: int,
    action: str,
    response_note: str | None = None,
) -> dict:
    process_expired_dispatch_offers(db)

    offer = db.query(models.DriverAssignmentOffer).filter(
        models.DriverAssignmentOffer.id == offer_id
    ).first()
    if not offer:
        raise ValueError("Dispatch offer not found")
    if offer.driver_id != driver_id:
        raise ValueError("Offer does not belong to this driver")

    queue = db.query(models.DispatchQueueEntry).filter(
        models.DispatchQueueEntry.id == offer.queue_entry_id
    ).first()
    if not queue:
        raise ValueError("Dispatch queue not found")

    order = db.query(models.Order).filter(models.Order.id == offer.order_id).first()
    driver = db.query(models.Driver).filter(models.Driver.id == driver_id).first()
    if not order or not driver:
        raise ValueError("Dispatch offer is missing order or driver context")

    if offer.status != "pending":
        raise ValueError(f"Offer is already {offer.status}")

    normalized_action = (action or "").strip().lower()
    if normalized_action not in {"accept", "decline"}:
        raise ValueError("Offer action must be accept or decline")

    if normalized_action == "accept":
        ensure_order_ready_for_dispatch(order)
        can_accept, reason = driver_can_accept_order(db, driver, order)
        if not can_accept:
            raise ValueError(reason or "Driver can no longer accept this order")

        previous_status = order.status
        order.driver_id = driver.id
        order.status = "assigned"
        order.updated_at = datetime.now(timezone.utc)
        queue.status = "assigned"
        queue.current_offer_id = offer.id
        queue.last_offered_driver_id = driver.id
        queue.last_processed_at = datetime.now(timezone.utc)
        _mark_offer_status(db, offer, "accepted", response_note=response_note)

        other_pending_offers = db.query(models.DriverAssignmentOffer).filter(
            models.DriverAssignmentOffer.order_id == order.id,
            models.DriverAssignmentOffer.status == "pending",
            models.DriverAssignmentOffer.id != offer.id,
        ).all()
        for pending_offer in other_pending_offers:
            _mark_offer_status(db, pending_offer, "cancelled", response_note="Order assigned to another driver")

        db.add(
            models.OrderEvent(
                order_id=order.id,
                type="driver_offer_accepted",
                payload={
                    "offer_id": offer.id,
                    "driver_id": driver.id,
                    "driver_name": driver.name,
                    "previous_status": previous_status,
                },
            )
        )
        log_audit_event(
            db,
            actor_type="driver",
            actor_customer_id=order.customer_id,
            action="driver_offer_accepted",
            entity_type="order",
            entity_id=order.order_number,
            payload={"offer_id": offer.id, "driver_id": driver.id},
        )
        db.commit()
        db.refresh(order)
        db.refresh(queue)
        db.refresh(offer)
        _notify_customer_assignment(order, driver, db)
        return {
            "assigned": True,
            "order": order,
            "dispatch_queue": serialize_dispatch_queue(queue),
            "offer": serialize_dispatch_offer(offer),
        }

    _mark_offer_status(db, offer, "declined", response_note=response_note)
    queue.status = "queued"
    queue.current_offer_id = None
    queue.last_processed_at = datetime.now(timezone.utc)
    db.add(
        models.OrderEvent(
            order_id=order.id,
            type="driver_offer_declined",
            payload={
                "offer_id": offer.id,
                "driver_id": driver.id,
                "driver_name": driver.name,
                "note": response_note,
            },
        )
    )
    log_audit_event(
        db,
        actor_type="driver",
        actor_customer_id=order.customer_id,
        action="driver_offer_declined",
        entity_type="order",
        entity_id=order.order_number,
        payload={"offer_id": offer.id, "driver_id": driver.id},
    )

    next_offer = None
    if getattr(_get_settings(db), "dispatch_auto_escalate", True):
        next_offer = _offer_next_driver(db, queue, actor_username="system")

    db.commit()
    db.refresh(queue)
    db.refresh(offer)
    return {
        "assigned": False,
        "order": order,
        "dispatch_queue": serialize_dispatch_queue(queue),
        "offer": serialize_dispatch_offer(offer),
        "next_offer": serialize_dispatch_offer(next_offer) if next_offer else None,
    }
