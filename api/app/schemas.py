from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime

class CustomerBase(BaseModel):
    telegram_id: int
    phone: Optional[str] = None

class CustomerCreate(CustomerBase):
    pass

class Customer(CustomerBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True

class MenuItemBase(BaseModel):
    name: str
    category: str
    description: Optional[str] = None
    price_cents: int

class MenuItem(MenuItemBase):
    id: int
    photo_url: Optional[str] = None
    stock: int
    active: bool

    class Config:
        from_attributes = True

class OrderItem(BaseModel):
    menu_id: int
    name: str
    quantity: int
    price_cents: int
    options: Optional[Dict[str, Any]] = None

class OrderCreate(BaseModel):
    customer_id: int
    items: List[OrderItem]
    subtotal_cents: int
    delivery_fee_cents: int = 0
    total_cents: int
    delivery_or_pickup: str
    pickup_address_text: Optional[str] = None
    delivery_address_id: Optional[int] = None
    delivery_address_text: Optional[str] = None
    notes: Optional[str] = None
    payment_type: str
    delivery_slot_et: datetime
    payment_metadata: Optional[Dict[str, Any]] = None

class Order(OrderCreate):
    id: int
    order_number: str
    status: str
    payment_status: str
    payment_confirmed: bool = False
    created_at: datetime

    class Config:
        from_attributes = True

class PaymentConfirmation(BaseModel):
    confirmed: bool
    confirmed_by: int
    notes: Optional[str] = None