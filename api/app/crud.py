from sqlalchemy.orm import Session
from . import models, schemas
from datetime import datetime
import json
import random

def get_customer_by_telegram_id(db: Session, telegram_id: int):
    return db.query(models.Customer).filter(models.Customer.telegram_id == telegram_id).first()

def create_customer(db: Session, customer: schemas.CustomerCreate):
    db_customer = models.Customer(
        telegram_id=customer.telegram_id,
        phone=customer.phone
    )
    db.add(db_customer)
    db.commit()
    db.refresh(db_customer)
    return db_customer

def get_active_menu_items(db: Session):
    return db.query(models.MenuItem).filter(models.MenuItem.active == True).all()

def create_order(db: Session, order: schemas.OrderCreate):
    # Generate order number
    order_number = f"ORD{datetime.now().strftime('%Y%m%d')}{random.randint(1000, 9999)}"
    
    # Convert Pydantic objects to dictionaries for JSON serialization
    items_dict = [item.dict() for item in order.items]

    db_order = models.Order(
        order_number=order_number,
        customer_id=order.customer_id,
        items=items_dict,
        subtotal_cents=order.subtotal_cents,
        delivery_fee_cents=order.delivery_fee_cents,
        total_cents=order.total_cents,
        delivery_or_pickup=order.delivery_or_pickup,
        pickup_address_text=order.pickup_address_text,
        delivery_address_id=order.delivery_address_id,
        delivery_address_text=order.delivery_address_text,
        notes=order.notes,
        payment_type=order.payment_type,
        delivery_slot_et=order.delivery_slot_et,
        payment_metadata=order.payment_metadata
    )
    db.add(db_order)
    db.commit()
    db.refresh(db_order)
    return db_order

def get_order_by_number(db: Session, order_number: str):
    return db.query(models.Order).filter(models.Order.order_number == order_number).first()

def update_order_payment_status(db: Session, order_number: str, status: str, txid: str = None, rbf: bool = False):
    order = get_order_by_number(db, order_number)
    if order:
        order.payment_status = status
        if txid:
            order.payment_txid = txid
        order.tx_rbf = rbf
        db.commit()
        db.refresh(order)
    return order