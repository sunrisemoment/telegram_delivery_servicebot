from pydantic import BaseModel, Field
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


class AdminLoginRequest(BaseModel):
    username: str
    password: str
    totp_code: Optional[str] = None


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


class MiniAppPickupEtaUpdateCreate(BaseModel):
    eta_minutes: int = Field(..., ge=1, le=240)
    note: Optional[str] = None


class DeliveryConfigUpdate(BaseModel):
    central_location_name: Optional[str] = None
    central_location_address: Optional[str] = None
    central_location_lat: Optional[float] = None
    central_location_lng: Optional[float] = None
    atlantic_station_radius_miles: Optional[float] = Field(default=None, ge=0)
    atlantic_station_fee_cents: Optional[int] = Field(default=None, ge=0)
    inside_i285_radius_miles: Optional[float] = Field(default=None, ge=0)
    inside_i285_fee_cents: Optional[int] = Field(default=None, ge=0)
    outside_i285_radius_miles: Optional[float] = Field(default=None, ge=0)
    outside_i285_fee_cents: Optional[int] = Field(default=None, ge=0)
    max_delivery_radius_miles: Optional[float] = Field(default=None, ge=0)
    delivery_radius_enforced: Optional[bool] = None
    dispatch_offer_timeout_seconds: Optional[int] = Field(default=None, ge=15, le=3600)
    dispatch_auto_escalate: Optional[bool] = None
    admin_session_hours: Optional[int] = Field(default=None, ge=1, le=168)


class DriverWorkingHourUpdate(BaseModel):
    day_of_week: int = Field(..., ge=0, le=6)
    start_local_time: str
    end_local_time: str
    active: bool = True


class DriverWorkingHoursUpdateRequest(BaseModel):
    timezone: Optional[str] = None
    hours: List[DriverWorkingHourUpdate]


class DriverOfferResponse(BaseModel):
    action: str
    note: Optional[str] = None


class MiniAppSupportTicketCreate(BaseModel):
    subject: str
    message: str
    category: str = "general"
    priority: str = "normal"
    order_number: Optional[str] = None


class AdminSupportTicketUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_admin_username: Optional[str] = None
    resolution_note: Optional[str] = None


class MiniAppReferralCreate(BaseModel):
    alias_username: Optional[str] = None
    alias_email: Optional[str] = None
    notes: Optional[str] = None
