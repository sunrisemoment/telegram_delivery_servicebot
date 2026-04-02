from sqlalchemy.orm import Session

from . import models


ACTIVE_DRIVER_ORDER_STATUSES = ("assigned", "scheduled", "out_for_delivery")
FINAL_ORDER_STATUSES = ("delivered", "cancelled", "expired")
ORDER_STATUS_ALIASES = {
    "completed": "delivered",
}
SUPPORTED_PAYMENT_TYPES = {
    "btc",
    "cash",
    "cashapp",
    "apple_cash",
    "card",
}
MANUAL_PAYMENT_TYPES = {
    "cash",
    "cashapp",
    "apple_cash",
    "card",
}


def normalize_order_status(status: str | None) -> str | None:
    if status is None:
        return None
    return ORDER_STATUS_ALIASES.get(status, status)


def normalize_payment_type(payment_type: str | None) -> str | None:
    if payment_type is None:
        return None

    normalized = payment_type.strip().lower()
    aliases = {
        "applecash": "apple_cash",
        "apple cash": "apple_cash",
    }
    return aliases.get(normalized, normalized)


def get_payment_label(payment_type: str | None) -> str:
    labels = {
        "btc": "Bitcoin",
        "cash": "Cash",
        "cashapp": "Cash App",
        "apple_cash": "Apple Cash",
        "card": "Card",
    }
    return labels.get(normalize_payment_type(payment_type), (payment_type or "Payment").replace("_", " ").title())


def get_driver_active_order_count(
    db: Session,
    driver_id: int,
    exclude_order_id: int | None = None,
) -> int:
    query = db.query(models.Order).filter(
        models.Order.driver_id == driver_id,
        models.Order.status.in_(ACTIVE_DRIVER_ORDER_STATUSES),
    )

    if exclude_order_id is not None:
        query = query.filter(models.Order.id != exclude_order_id)

    return query.count()


def ensure_order_ready_for_dispatch(order: models.Order):
    if not order.payment_confirmed:
        raise ValueError("Order payment must be approved before dispatch")


def driver_can_accept_order(
    db: Session,
    driver: models.Driver,
    order: models.Order,
) -> tuple[bool, str | None]:
    if not driver.active:
        return False, "Driver is inactive"

    if not getattr(driver, "is_online", True):
        return False, "Driver is offline"

    if order.delivery_or_pickup == "delivery" and not getattr(driver, "accepts_delivery", True):
        return False, "Driver does not accept delivery orders"

    if order.delivery_or_pickup == "pickup" and not getattr(driver, "accepts_pickup", True):
        return False, "Driver does not accept pickup orders"

    active_order_count = get_driver_active_order_count(
        db,
        driver.id,
        exclude_order_id=order.id,
    )
    max_concurrent_orders = max(getattr(driver, "max_concurrent_orders", 1) or 1, 1)
    if active_order_count >= max_concurrent_orders:
        return False, f"Driver is already at max concurrent orders ({max_concurrent_orders})"

    return True, None
