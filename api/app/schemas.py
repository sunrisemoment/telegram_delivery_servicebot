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
    delivery_slot_et: Optional[datetime] = None
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


class CustomerInviteCreate(BaseModel):
    alias_username: Optional[str] = None
    alias_email: Optional[str] = None
    target_role: Optional[str] = "customer"
    notes: Optional[str] = None


class MiniAppAuthRequest(BaseModel):
    init_data: str
    invite_code: Optional[str] = None


class MiniAppAddressCreate(BaseModel):
    label: str = "Home"
    address_text: str
    is_default: bool = False


class MiniAppDeliveryFeeRequest(BaseModel):
    delivery_or_pickup: str
    delivery_address_id: Optional[int] = None
    delivery_address_text: Optional[str] = None


class MiniAppOrderCreate(BaseModel):
    items: List[OrderItem]
    delivery_or_pickup: str
    delivery_address_id: Optional[int] = None
    delivery_address_text: Optional[str] = None
    pickup_address_id: Optional[int] = None
    pickup_address_text: Optional[str] = None
    notes: Optional[str] = None
    payment_type: str
    delivery_slot_et: Optional[datetime] = None


class MiniAppDriverProfileUpdate(BaseModel):
    is_online: Optional[bool] = None
    accepts_delivery: Optional[bool] = None
    accepts_pickup: Optional[bool] = None


class MiniAppDriverOrderStatusUpdate(BaseModel):
    status: str
