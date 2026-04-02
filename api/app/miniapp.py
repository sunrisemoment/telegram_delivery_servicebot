from datetime import datetime, timezone
from html import escape

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from . import crud, models, schemas
from .database import get_db
from .dispatch_rules import SUPPORTED_PAYMENT_TYPES, get_payment_label, normalize_order_status, normalize_payment_type
from .inventory_service import get_inventory_service
from .miniapp_auth import (
    build_customer_display_name,
    get_current_miniapp_customer,
    get_current_miniapp_session,
    issue_miniapp_session,
    normalize_invite_code,
    validate_telegram_init_data,
)
from .payment_service import get_payment_service
from .telegram_service import telegram_service

router = APIRouter(prefix="/miniapp-api", tags=["miniapp"])


def _serialize_customer(customer: models.Customer) -> dict:
    invite_code = customer.invite.code if getattr(customer, "invite", None) else None
    return {
        "id": customer.id,
        "telegram_id": customer.telegram_id,
        "phone": customer.phone,
        "display_name": customer.display_name,
        "alias_username": customer.alias_username,
        "alias_email": customer.alias_email,
        "account_status": customer.account_status,
        "invite_code": invite_code,
        "last_login_at": customer.last_login_at.isoformat() if customer.last_login_at else None,
        "created_at": customer.created_at.isoformat() if customer.created_at else None,
    }


def _serialize_address(address: models.CustomerAddress) -> dict:
    return {
        "id": address.id,
        "label": address.label,
        "address_text": address.address_text,
        "is_default": address.is_default,
        "created_at": address.created_at.isoformat() if address.created_at else None,
    }


def _serialize_order(order: models.Order) -> dict:
    return {
        "id": order.id,
        "order_number": order.order_number,
        "status": normalize_order_status(order.status),
        "payment_status": order.payment_status,
        "payment_confirmed": order.payment_confirmed,
        "payment_type": order.payment_type,
        "payment_label": get_payment_label(order.payment_type),
        "delivery_or_pickup": order.delivery_or_pickup,
        "pickup_address_text": order.pickup_address_text,
        "delivery_address_text": order.delivery_address_text,
        "subtotal_cents": order.subtotal_cents,
        "delivery_fee_cents": order.delivery_fee_cents,
        "total_cents": order.total_cents,
        "items": order.items,
        "notes": order.notes,
        "delivery_slot_et": order.delivery_slot_et.isoformat() if order.delivery_slot_et else None,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "updated_at": order.updated_at.isoformat() if order.updated_at else None,
        "payment_metadata": order.payment_metadata or {},
    }


def _sanitize_alias_username(value: str | None, fallback: str) -> str:
    raw_value = value or fallback
    sanitized = "".join(char.lower() if char.isalnum() else "_" for char in raw_value)
    sanitized = sanitized.strip("_")
    sanitized = "_".join(filter(None, sanitized.split("_")))
    sanitized = sanitized[:50]
    return sanitized or fallback[:50].lower()


def _ensure_unique_alias_username(db: Session, desired_username: str | None, customer_id: int | None = None) -> str | None:
    if not desired_username:
        return None

    base = _sanitize_alias_username(desired_username, "member")
    candidate = base
    suffix = 1
    while True:
        query = db.query(models.Customer).filter(models.Customer.alias_username == candidate)
        if customer_id is not None:
            query = query.filter(models.Customer.id != customer_id)
        if not query.first():
            return candidate
        suffix += 1
        candidate = f"{base}_{suffix}"


def _find_valid_invite(db: Session, invite_code: str) -> models.CustomerInvite:
    normalized_code = normalize_invite_code(invite_code)
    if not normalized_code:
        raise HTTPException(status_code=400, detail={"code": "invalid_invite", "message": "Invite code is required"})

    invite = db.query(models.CustomerInvite).filter(
        models.CustomerInvite.code == normalized_code
    ).first()
    if not invite:
        raise HTTPException(status_code=404, detail={"code": "invalid_invite", "message": "Invite code was not found"})
    if invite.status == "revoked":
        raise HTTPException(status_code=403, detail={"code": "invite_revoked", "message": "Invite code has been revoked"})
    return invite


def _claim_invite_for_customer(
    db: Session,
    invite: models.CustomerInvite,
    customer: models.Customer,
    telegram_id: int,
) -> models.CustomerInvite:
    if invite.status == "claimed":
        if invite.claimed_by_customer_id != customer.id:
            raise HTTPException(status_code=409, detail={"code": "invite_claimed", "message": "Invite code has already been claimed"})
        return invite

    invite.status = "claimed"
    invite.claimed_by_customer_id = customer.id
    invite.claimed_by_telegram_id = telegram_id
    invite.claimed_at = datetime.now(timezone.utc)
    customer.invite_id = invite.id
    if invite.alias_email and not customer.alias_email:
        normalized_email = invite.alias_email.strip().lower()
        existing_email_owner = db.query(models.Customer).filter(
            models.Customer.alias_email == normalized_email,
            models.Customer.id != customer.id,
        ).first()
        if existing_email_owner:
            raise HTTPException(status_code=409, detail={"code": "alias_conflict", "message": "Invite email is already in use"})
        customer.alias_email = normalized_email
    if invite.alias_username and not customer.alias_username:
        customer.alias_username = _ensure_unique_alias_username(db, invite.alias_username, customer.id)
    customer.account_status = "active"
    return invite


def _send_admin_order_notification(db: Session, order: models.Order) -> None:
    contact_settings = db.query(models.ContactSettings).first()
    if not contact_settings or not contact_settings.telegram_id:
        return

    customer = db.query(models.Customer).filter(models.Customer.id == order.customer_id).first()
    items_text = "\n".join(
        f"• {escape(str(item.get('name', 'Item')))} x{item.get('quantity', 1)}"
        for item in order.items
    )
    message = (
        "🆕 <b>Mini App Order</b>\n\n"
        f"📦 <b>Order #:</b> <code>{order.order_number}</code>\n"
        f"💰 <b>Total:</b> ${order.total_cents / 100:.2f}\n"
        f"💳 <b>Payment:</b> {get_payment_label(order.payment_type)}\n"
        f"👤 <b>Customer:</b> {escape(str(customer.display_name or customer.phone or customer.telegram_id))}\n"
        f"📍 <b>Type:</b> {order.delivery_or_pickup.title()}\n"
        f"🔐 <b>Invite:</b> {customer.invite.code if customer.invite else 'N/A'}\n\n"
        f"📋 <b>Items:</b>\n{items_text}"
    )
    telegram_service.send_message(contact_settings.telegram_id, message)


def _resolve_delivery_fee(
    db: Session,
    customer: models.Customer,
    delivery_or_pickup: str,
    delivery_address_id: int | None = None,
    delivery_address_text: str | None = None,
) -> tuple[int, str, int | None, str | None]:
    if delivery_or_pickup == "pickup":
        return 0, "Pickup", None, None

    resolved_address_id = delivery_address_id
    resolved_address_text = (delivery_address_text or "").strip() or None

    if resolved_address_id:
        address = db.query(models.CustomerAddress).filter(
            models.CustomerAddress.id == resolved_address_id,
            models.CustomerAddress.customer_id == customer.id,
        ).first()
        if not address:
            raise HTTPException(status_code=404, detail="Delivery address not found")
        resolved_address_text = address.address_text

    if not resolved_address_text:
        raise HTTPException(status_code=400, detail="Delivery address is required")

    from .delivery_service import get_delivery_service

    delivery_service = get_delivery_service(db)
    delivery_fee_cents, delivery_zone = delivery_service.calculate_delivery_fee(resolved_address_text)
    return delivery_fee_cents, delivery_zone, resolved_address_id, resolved_address_text


@router.post("/auth/telegram")
async def miniapp_telegram_auth(
    auth_request: schemas.MiniAppAuthRequest,
    db: Session = Depends(get_db),
):
    auth_data = validate_telegram_init_data(auth_request.init_data)
    telegram_user = auth_data["user"]
    telegram_id = telegram_user["id"]
    start_param = normalize_invite_code(auth_data.get("start_param"))
    provided_invite_code = normalize_invite_code(auth_request.invite_code) or start_param

    customer = db.query(models.Customer).filter(models.Customer.telegram_id == telegram_id).first()
    if customer and customer.account_status == "revoked":
        raise HTTPException(status_code=403, detail={"code": "account_revoked", "message": "This account has been disabled"})

    if not customer and not provided_invite_code:
        raise HTTPException(status_code=403, detail={"code": "invite_required", "message": "An invite code is required to access this Mini App"})

    if not customer:
        invite = _find_valid_invite(db, provided_invite_code)
        desired_alias = invite.alias_username or telegram_user.get("username") or f"user_{telegram_id}"
        customer = models.Customer(
            telegram_id=telegram_id,
            display_name=build_customer_display_name(telegram_user),
            alias_username=_ensure_unique_alias_username(db, desired_alias),
            alias_email=invite.alias_email.strip().lower() if invite.alias_email else None,
            account_status="active",
        )
        db.add(customer)
        db.commit()
        db.refresh(customer)
        _claim_invite_for_customer(db, invite, customer, telegram_id)
    elif not customer.invite_id:
        if not provided_invite_code:
            raise HTTPException(status_code=403, detail={"code": "invite_required", "message": "An invite code is required to activate this account"})
        invite = _find_valid_invite(db, provided_invite_code)
        _claim_invite_for_customer(db, invite, customer, telegram_id)

    customer.display_name = build_customer_display_name(telegram_user)
    customer.account_status = "active"
    if telegram_user.get("username") and not customer.alias_username:
        customer.alias_username = _ensure_unique_alias_username(db, telegram_user["username"], customer.id)
    db.commit()
    db.refresh(customer)

    session = issue_miniapp_session(
        db=db,
        customer=customer,
        telegram_id=telegram_id,
        init_data_hash=auth_data["hash"],
        start_param=auth_data.get("start_param"),
    )
    invite = customer.invite

    return {
        "session_token": session.session_token,
        "expires_at": session.expires_at.isoformat(),
        "customer": _serialize_customer(customer),
        "invite": {
            "code": invite.code if invite else None,
            "status": invite.status if invite else None,
            "alias_username": invite.alias_username if invite else None,
            "alias_email": invite.alias_email if invite else None,
        },
    }


@router.post("/logout")
async def miniapp_logout(
    session: models.MiniAppSession = Depends(get_current_miniapp_session),
    db: Session = Depends(get_db),
):
    session.revoked_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Mini App session revoked"}


@router.get("/me")
async def miniapp_me(customer: models.Customer = Depends(get_current_miniapp_customer)):
    return _serialize_customer(customer)


@router.get("/config")
async def miniapp_config(
    db: Session = Depends(get_db),
    customer: models.Customer = Depends(get_current_miniapp_customer),
):
    settings = db.query(models.Settings).first()
    contact_settings = db.query(models.ContactSettings).first()
    return {
        "customer": _serialize_customer(customer),
        "btc_discount_percent": settings.btc_discount_percent if settings else 0,
        "contact": {
            "welcome_message": contact_settings.welcome_message if contact_settings else "Welcome",
            "telegram_username": contact_settings.telegram_username if contact_settings else "",
            "phone_number": contact_settings.phone_number if contact_settings else "",
            "email_address": contact_settings.email_address if contact_settings else "",
            "additional_info": contact_settings.additional_info if contact_settings else "",
        },
    }


@router.get("/menu")
async def miniapp_menu(
    db: Session = Depends(get_db),
    customer: models.Customer = Depends(get_current_miniapp_customer),
):
    del customer
    inventory_service = get_inventory_service(db)
    menu_items = crud.get_active_menu_items(db)
    return [
        {
            "id": item.id,
            "name": item.name,
            "category": item.category,
            "description": item.description,
            "price_cents": item.price_cents,
            "photo_url": item.photo_url,
            "available_qty": inventory_service.get_storefront_availability(item.id),
        }
        for item in menu_items
    ]


@router.get("/orders")
async def miniapp_orders(
    db: Session = Depends(get_db),
    customer: models.Customer = Depends(get_current_miniapp_customer),
):
    orders = db.query(models.Order).filter(
        models.Order.customer_id == customer.id
    ).order_by(models.Order.created_at.desc()).all()
    return [_serialize_order(order) for order in orders]


@router.get("/addresses")
async def miniapp_addresses(
    db: Session = Depends(get_db),
    customer: models.Customer = Depends(get_current_miniapp_customer),
):
    addresses = db.query(models.CustomerAddress).filter(
        models.CustomerAddress.customer_id == customer.id
    ).order_by(
        models.CustomerAddress.is_default.desc(),
        models.CustomerAddress.created_at.desc(),
    ).all()
    return [_serialize_address(address) for address in addresses]


@router.post("/addresses")
async def miniapp_create_address(
    address_data: schemas.MiniAppAddressCreate,
    db: Session = Depends(get_db),
    customer: models.Customer = Depends(get_current_miniapp_customer),
):
    if address_data.is_default:
        db.query(models.CustomerAddress).filter(
            models.CustomerAddress.customer_id == customer.id,
            models.CustomerAddress.is_default.is_(True),
        ).update({"is_default": False})

    address = models.CustomerAddress(
        customer_id=customer.id,
        label=address_data.label,
        address_text=address_data.address_text,
        is_default=address_data.is_default,
    )
    db.add(address)
    db.commit()
    db.refresh(address)
    return _serialize_address(address)


@router.put("/addresses/{address_id}/default")
async def miniapp_set_default_address(
    address_id: int,
    db: Session = Depends(get_db),
    customer: models.Customer = Depends(get_current_miniapp_customer),
):
    address = db.query(models.CustomerAddress).filter(
        models.CustomerAddress.id == address_id,
        models.CustomerAddress.customer_id == customer.id,
    ).first()
    if not address:
        raise HTTPException(status_code=404, detail="Address not found")

    db.query(models.CustomerAddress).filter(
        models.CustomerAddress.customer_id == customer.id,
        models.CustomerAddress.is_default.is_(True),
    ).update({"is_default": False})
    address.is_default = True
    customer.default_address_id = address.id
    db.commit()
    return {"message": "Default address updated"}


@router.delete("/addresses/{address_id}")
async def miniapp_delete_address(
    address_id: int,
    db: Session = Depends(get_db),
    customer: models.Customer = Depends(get_current_miniapp_customer),
):
    address = db.query(models.CustomerAddress).filter(
        models.CustomerAddress.id == address_id,
        models.CustomerAddress.customer_id == customer.id,
    ).first()
    if not address:
        raise HTTPException(status_code=404, detail="Address not found")

    db.delete(address)
    db.commit()
    return {"message": "Address deleted"}


@router.get("/pickup-addresses")
async def miniapp_pickup_addresses(
    db: Session = Depends(get_db),
    customer: models.Customer = Depends(get_current_miniapp_customer),
):
    del customer
    pickup_addresses = db.query(models.PickupAddress).filter(
        models.PickupAddress.active.is_(True)
    ).all()
    return [
        {
            "id": pickup_address.id,
            "name": pickup_address.name,
            "address": pickup_address.address,
            "instructions": pickup_address.instructions,
        }
        for pickup_address in pickup_addresses
    ]


@router.post("/delivery-fee")
async def miniapp_delivery_fee(
    fee_request: schemas.MiniAppDeliveryFeeRequest,
    db: Session = Depends(get_db),
    customer: models.Customer = Depends(get_current_miniapp_customer),
):
    delivery_fee_cents, delivery_zone, _, _ = _resolve_delivery_fee(
        db=db,
        customer=customer,
        delivery_or_pickup=fee_request.delivery_or_pickup,
        delivery_address_id=fee_request.delivery_address_id,
        delivery_address_text=fee_request.delivery_address_text,
    )
    return {
        "delivery_fee_cents": delivery_fee_cents,
        "delivery_zone": delivery_zone,
        "delivery_type": fee_request.delivery_or_pickup,
    }


@router.post("/orders")
async def miniapp_create_order(
    order_data: schemas.MiniAppOrderCreate,
    db: Session = Depends(get_db),
    customer: models.Customer = Depends(get_current_miniapp_customer),
):
    if not order_data.items:
        raise HTTPException(status_code=400, detail="At least one item is required")

    delivery_or_pickup = (order_data.delivery_or_pickup or "").strip().lower()
    if delivery_or_pickup not in {"delivery", "pickup"}:
        raise HTTPException(status_code=400, detail="delivery_or_pickup must be 'delivery' or 'pickup'")

    payment_type = normalize_payment_type(order_data.payment_type)
    if payment_type not in SUPPORTED_PAYMENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported payment type: {order_data.payment_type}")

    requested_menu_ids = [item.menu_id for item in order_data.items]
    menu_items = db.query(models.MenuItem).filter(models.MenuItem.id.in_(requested_menu_ids)).all()
    menu_lookup = {item.id: item for item in menu_items}
    if len(menu_lookup) != len(set(requested_menu_ids)):
        raise HTTPException(status_code=404, detail="One or more menu items are unavailable")

    inventory_service = get_inventory_service(db)
    normalized_items: list[schemas.OrderItem] = []
    subtotal_cents = 0
    for item in order_data.items:
        menu_item = menu_lookup[item.menu_id]
        quantity = max(1, int(item.quantity))
        available_qty = inventory_service.get_storefront_availability(menu_item.id)
        if available_qty < quantity:
            raise HTTPException(
                status_code=400,
                detail=f"{menu_item.name} only has {available_qty} available",
            )

        subtotal_cents += menu_item.price_cents * quantity
        normalized_items.append(
            schemas.OrderItem(
                menu_id=menu_item.id,
                name=menu_item.name,
                quantity=quantity,
                price_cents=menu_item.price_cents,
                options=item.options,
            )
        )

    delivery_fee_cents, delivery_zone, delivery_address_id, delivery_address_text = _resolve_delivery_fee(
        db=db,
        customer=customer,
        delivery_or_pickup=delivery_or_pickup,
        delivery_address_id=order_data.delivery_address_id,
        delivery_address_text=order_data.delivery_address_text,
    )

    pickup_address_text = order_data.pickup_address_text
    if delivery_or_pickup == "pickup" and order_data.pickup_address_id:
        pickup_address = db.query(models.PickupAddress).filter(
            models.PickupAddress.id == order_data.pickup_address_id,
            models.PickupAddress.active.is_(True),
        ).first()
        if not pickup_address:
            raise HTTPException(status_code=404, detail="Pickup location not found")
        pickup_address_text = f"{pickup_address.name} - {pickup_address.address}"

    total_cents = subtotal_cents + delivery_fee_cents
    payment_metadata = {
        "source": "miniapp",
        "delivery_zone": delivery_zone,
    }
    if payment_type == "btc":
        settings = db.query(models.Settings).first()
        discount_percent = settings.btc_discount_percent if settings else 0
        if discount_percent > 0:
            discount_amount = int(total_cents * discount_percent / 100)
            payment_metadata.update(
                {
                    "original_total_cents": total_cents,
                    "btc_discount_percent": discount_percent,
                    "btc_discount_amount_cents": discount_amount,
                }
            )
            total_cents -= discount_amount

    order_create = schemas.OrderCreate(
        customer_id=customer.id,
        items=normalized_items,
        subtotal_cents=subtotal_cents,
        delivery_fee_cents=delivery_fee_cents,
        total_cents=total_cents,
        delivery_or_pickup=delivery_or_pickup,
        pickup_address_text=pickup_address_text,
        delivery_address_id=delivery_address_id,
        delivery_address_text=delivery_address_text,
        notes=order_data.notes,
        payment_type=payment_type,
        delivery_slot_et=order_data.delivery_slot_et,
        payment_metadata=payment_metadata,
    )
    order = crud.create_order(db, order_create)

    try:
        inventory_service.create_reservations(order.id, [item.dict() for item in normalized_items])
    except Exception as exc:
        db.delete(order)
        db.commit()
        raise HTTPException(status_code=400, detail=f"Inventory reservation failed: {exc}") from exc

    order_event = models.OrderEvent(
        order_id=order.id,
        type="miniapp_order_created",
        payload={
            "customer_alias": customer.alias_username,
            "invite_code": customer.invite.code if customer.invite else None,
        },
    )
    db.add(order_event)
    db.commit()
    db.refresh(order)

    _send_admin_order_notification(db, order)

    payment_url = None
    if payment_type == "btc":
        payment_service = get_payment_service(db)
        payment_details = payment_service.generate_btc_payment(order.order_number, total_cents)
        payment_url = payment_details.get("payment_url")

    return {
        "order": _serialize_order(order),
        "payment_url": payment_url,
        "payment_label": get_payment_label(payment_type),
        "message": "Order created. Payment approval is required before dispatch.",
    }
