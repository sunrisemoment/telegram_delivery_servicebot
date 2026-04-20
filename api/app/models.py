from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, BigInteger, JSON, Float, UniqueConstraint, CheckConstraint
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import datetime

Base = declarative_base()

class Customer(Base):
    __tablename__ = "customers"

    id = Column(BigInteger, primary_key=True, index=True)
    telegram_id = Column(BigInteger, unique=True, nullable=False)
    phone = Column(String(20))
    display_name = Column(String(150))
    alias_username = Column(String(100), unique=True)
    alias_email = Column(String(200), unique=True)
    app_role = Column(String(20), default="customer")
    account_status = Column(String(20), default="active")
    invite_id = Column(BigInteger, ForeignKey("customer_invites.id"))
    verified_bool = Column(Boolean, default=False)
    phone_verified_at = Column(DateTime(timezone=True))
    phone_verification_code_hash = Column(String(64))
    phone_verification_expires_at = Column(DateTime(timezone=True))
    phone_verification_sent_at = Column(DateTime(timezone=True))
    default_address_id = Column(BigInteger)
    last_login_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    invite = relationship("CustomerInvite", foreign_keys=[invite_id])


class CustomerInvite(Base):
    __tablename__ = "customer_invites"

    id = Column(BigInteger, primary_key=True, index=True)
    code = Column(String(32), unique=True, nullable=False, index=True)
    alias_username = Column(String(100))
    alias_email = Column(String(200))
    phone = Column(String(32))
    target_role = Column(String(20), default="customer")
    notes = Column(Text)
    status = Column(String(20), default="pending")
    created_by = Column(BigInteger, ForeignKey("customers.id"))
    claimed_by_customer_id = Column(BigInteger, ForeignKey("customers.id"))
    claimed_by_telegram_id = Column(BigInteger)
    claimed_at = Column(DateTime(timezone=True))
    revoked_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    created_by_customer = relationship("Customer", foreign_keys=[created_by])
    claimed_by_customer = relationship("Customer", foreign_keys=[claimed_by_customer_id])

class CustomerAddress(Base):
    __tablename__ = "customer_addresses"

    id = Column(BigInteger, primary_key=True, index=True)
    customer_id = Column(BigInteger, ForeignKey("customers.id"), nullable=False)
    label = Column(String(100))
    address_text = Column(Text, nullable=False)
    lat = Column(Float)
    lng = Column(Float)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Explicit relationship
    customer = relationship("Customer", backref="addresses")

class Driver(Base):
    __tablename__ = "drivers"

    id = Column(BigInteger, primary_key=True, index=True)
    telegram_id = Column(BigInteger, unique=True, nullable=False)
    name = Column(String(100))
    phone = Column(String(20), nullable=True)
    active = Column(Boolean, default=True)
    is_online = Column(Boolean, default=True)
    accepts_delivery = Column(Boolean, default=True)
    accepts_pickup = Column(Boolean, default=True)
    max_delivery_distance_miles = Column(Float, default=15.0)
    max_concurrent_orders = Column(Integer, default=3)
    timezone = Column(String(64), default="America/New_York")
    pickup_address_id = Column(BigInteger, ForeignKey("pickup_addresses.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    pickup_address = relationship("PickupAddress", foreign_keys=[pickup_address_id])

class MenuItem(Base):
    __tablename__ = "menu_items"

    id = Column(BigInteger, primary_key=True, index=True)
    category = Column(String(100))
    name = Column(String(200), nullable=False)
    description = Column(Text)
    price_cents = Column(Integer, nullable=False)
    photo_url = Column(Text)
    stock = Column(Integer, default=0)
    active = Column(Boolean, default=True)


class MenuItemPhoto(Base):
    __tablename__ = "menu_item_photos"

    id = Column(BigInteger, primary_key=True, index=True)
    menu_item_id = Column(BigInteger, ForeignKey("menu_items.id"), nullable=False, index=True)
    photo_url = Column(Text, nullable=False)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    menu_item = relationship("MenuItem", foreign_keys=[menu_item_id], backref="photos")

class Order(Base):
    __tablename__ = "orders"

    id = Column(BigInteger, primary_key=True, index=True)
    order_number = Column(String(50), unique=True, nullable=False)
    customer_id = Column(BigInteger, ForeignKey("customers.id"), nullable=False)
    items = Column(JSON, nullable=False)
    subtotal_cents = Column(Integer, nullable=False)
    delivery_fee_cents = Column(Integer, default=0)
    total_cents = Column(Integer, nullable=False)
    delivery_or_pickup = Column(String(10), nullable=False)
    pickup_address_text = Column(Text)
    delivery_address_id = Column(BigInteger, ForeignKey("customer_addresses.id"))
    delivery_address_text = Column(Text)
    notes = Column(Text)
    payment_type = Column(String(10))
    payment_status = Column(String(20), default="pending")
    payment_txid = Column(String(100))
    payment_metadata = Column(JSON)
    tx_rbf = Column(Boolean, default=False)
    delivery_slot_et = Column(DateTime(timezone=True))
    driver_id = Column(BigInteger, ForeignKey("drivers.id"))
    last_pushed_msg_id = Column(BigInteger)
    status = Column(String(20), default="placed")
    payment_confirmed = Column(Boolean, default=False)
    payment_confirmed_by = Column(BigInteger, ForeignKey("customers.id"))
    payment_confirmed_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Explicit relationships with foreign_keys
    customer = relationship("Customer", foreign_keys=[customer_id])
    driver = relationship("Driver", foreign_keys=[driver_id])
    delivery_address = relationship("CustomerAddress", foreign_keys=[delivery_address_id])
    payment_confirmed_by_admin = relationship("Customer", foreign_keys=[payment_confirmed_by])

class OrderEvent(Base):
    __tablename__ = "order_events"

    id = Column(BigInteger, primary_key=True, index=True)
    order_id = Column(BigInteger, ForeignKey("orders.id"), nullable=False)
    type = Column(String(50), nullable=False)
    payload = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Explicit relationship
    order = relationship("Order", backref="events")


class PickupEtaUpdate(Base):
    __tablename__ = "pickup_eta_updates"

    id = Column(BigInteger, primary_key=True, index=True)
    order_id = Column(BigInteger, ForeignKey("orders.id"), nullable=False, index=True)
    customer_id = Column(BigInteger, ForeignKey("customers.id"), nullable=False)
    eta_minutes = Column(Integer, nullable=False)
    note = Column(Text)
    source = Column(String(20), default="miniapp")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    order = relationship("Order", backref="pickup_eta_updates")
    customer = relationship("Customer", foreign_keys=[customer_id])


class PickupArrivalPhoto(Base):
    __tablename__ = "pickup_arrival_photos"

    id = Column(BigInteger, primary_key=True, index=True)
    order_id = Column(BigInteger, ForeignKey("orders.id"), nullable=False, index=True)
    customer_id = Column(BigInteger, ForeignKey("customers.id"), nullable=False)
    photo_url = Column(Text, nullable=False)
    parking_note = Column(Text)
    source = Column(String(20), default="miniapp")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    order = relationship("Order", backref="pickup_arrival_photos")
    customer = relationship("Customer", foreign_keys=[customer_id])


class MiniAppSession(Base):
    __tablename__ = "miniapp_sessions"

    id = Column(BigInteger, primary_key=True, index=True)
    customer_id = Column(BigInteger, ForeignKey("customers.id"), nullable=False)
    telegram_id = Column(BigInteger, nullable=False)
    session_token = Column(String(128), unique=True, nullable=False, index=True)
    init_data_hash = Column(String(64))
    start_param = Column(String(255))
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True))
    last_seen_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    customer = relationship("Customer", foreign_keys=[customer_id])


class AdminSession(Base):
    __tablename__ = "admin_sessions"

    id = Column(BigInteger, primary_key=True, index=True)
    username = Column(String(100), nullable=False)
    session_token = Column(String(128), unique=True, nullable=False, index=True)
    ip_address = Column(String(64))
    user_agent = Column(Text)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True))
    last_seen_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class DriverStock(Base):
    __tablename__ = "driver_stock"
    
    id = Column(BigInteger, primary_key=True, index=True)
    driver_id = Column(BigInteger, ForeignKey("drivers.id"), nullable=False)
    menu_item_id = Column(BigInteger, ForeignKey("menu_items.id"), nullable=False)
    on_hand_qty = Column(Integer, default=0)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Unique constraint for driver + menu item
    __table_args__ = (UniqueConstraint('driver_id', 'menu_item_id', name='uq_driver_menu_item'),)
    
    # Explicit relationships
    driver = relationship("Driver", foreign_keys=[driver_id])
    menu_item = relationship("MenuItem", foreign_keys=[menu_item_id])

class DriverStockEvent(Base):
    __tablename__ = "driver_stock_events"
    
    id = Column(BigInteger, primary_key=True, index=True)
    driver_id = Column(BigInteger, ForeignKey("drivers.id"), nullable=False)
    menu_item_id = Column(BigInteger, ForeignKey("menu_items.id"), nullable=False)
    qty_change = Column(Integer, nullable=False)
    event_type = Column(String(20), nullable=False)
    reason_note = Column(Text)
    order_id = Column(BigInteger, ForeignKey("orders.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Explicit relationships
    driver = relationship("Driver", foreign_keys=[driver_id])
    menu_item = relationship("MenuItem", foreign_keys=[menu_item_id])
    order = relationship("Order", foreign_keys=[order_id])

class InventoryReservation(Base):
    __tablename__ = "inventory_reservations"
    
    id = Column(BigInteger, primary_key=True, index=True)
    order_id = Column(BigInteger, ForeignKey("orders.id"), nullable=False)
    menu_item_id = Column(BigInteger, ForeignKey("menu_items.id"), nullable=False)
    reserved_qty = Column(Integer, nullable=False)
    status = Column(String(20), default="active")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True))
    
    # Explicit relationships
    order = relationship("Order", foreign_keys=[order_id])
    menu_item = relationship("MenuItem", foreign_keys=[menu_item_id])


class DriverWorkingHours(Base):
    __tablename__ = "driver_working_hours"

    id = Column(BigInteger, primary_key=True, index=True)
    driver_id = Column(BigInteger, ForeignKey("drivers.id"), nullable=False)
    day_of_week = Column(Integer, nullable=False)
    start_local_time = Column(String(5), nullable=False)
    end_local_time = Column(String(5), nullable=False)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("driver_id", "day_of_week", name="uq_driver_working_hours_driver_day"),
    )

    driver = relationship("Driver", foreign_keys=[driver_id], backref="working_hours")


class DispatchQueueEntry(Base):
    __tablename__ = "dispatch_queue_entries"

    id = Column(BigInteger, primary_key=True, index=True)
    order_id = Column(BigInteger, ForeignKey("orders.id"), nullable=False, unique=True)
    status = Column(String(20), default="queued")
    started_by_username = Column(String(100))
    current_offer_id = Column(BigInteger, ForeignKey("driver_assignment_offers.id"))
    last_offered_driver_id = Column(BigInteger, ForeignKey("drivers.id"))
    last_processed_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    order = relationship("Order", foreign_keys=[order_id], backref="dispatch_queue")
    current_offer = relationship("DriverAssignmentOffer", foreign_keys=[current_offer_id], post_update=True)
    last_offered_driver = relationship("Driver", foreign_keys=[last_offered_driver_id])


class DriverAssignmentOffer(Base):
    __tablename__ = "driver_assignment_offers"

    id = Column(BigInteger, primary_key=True, index=True)
    order_id = Column(BigInteger, ForeignKey("orders.id"), nullable=False)
    queue_entry_id = Column(BigInteger, ForeignKey("dispatch_queue_entries.id"), nullable=False)
    driver_id = Column(BigInteger, ForeignKey("drivers.id"), nullable=False)
    sequence_number = Column(Integer, nullable=False, default=1)
    status = Column(String(20), default="pending")
    created_by_username = Column(String(100))
    response_note = Column(Text)
    offered_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)
    responded_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    order = relationship("Order", foreign_keys=[order_id], backref="driver_assignment_offers")
    queue_entry = relationship("DispatchQueueEntry", foreign_keys=[queue_entry_id], backref="offers")
    driver = relationship("Driver", foreign_keys=[driver_id], backref="assignment_offers")

class DeliveryZone(Base):
    __tablename__ = "delivery_zones"
    
    id = Column(BigInteger, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    city = Column(String(100), nullable=False)
    base_fee_cents = Column(Integer, default=1000)
    outside_city_fee_cents = Column(Integer, default=2000)
    polygon_coords = Column(JSON)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class PickupAddress(Base):
    __tablename__ = "pickup_addresses"
    
    id = Column(BigInteger, primary_key=True, index=True)
    name = Column(String(200), nullable=False)  # e.g., "Main Store", "Downtown Location"
    address = Column(Text, nullable=False)  # Full address
    instructions = Column(Text)  # Special instructions for pickup
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id = Column(BigInteger, primary_key=True, index=True)
    customer_id = Column(BigInteger, ForeignKey("customers.id"), nullable=False)
    order_id = Column(BigInteger, ForeignKey("orders.id"))
    role = Column(String(20), default="customer")
    category = Column(String(50), default="general")
    priority = Column(String(20), default="normal")
    subject = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    status = Column(String(20), default="open")
    assigned_admin_username = Column(String(100))
    resolution_note = Column(Text)
    resolved_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    customer = relationship("Customer", foreign_keys=[customer_id], backref="support_tickets")
    order = relationship("Order", foreign_keys=[order_id], backref="support_tickets")


class Referral(Base):
    __tablename__ = "referrals"

    id = Column(BigInteger, primary_key=True, index=True)
    referrer_customer_id = Column(BigInteger, ForeignKey("customers.id"), nullable=False)
    referred_customer_id = Column(BigInteger, ForeignKey("customers.id"))
    invite_id = Column(BigInteger, ForeignKey("customer_invites.id"), nullable=False, unique=True)
    status = Column(String(20), default="pending")
    reward_status = Column(String(20), default="pending")
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    claimed_at = Column(DateTime(timezone=True))

    referrer_customer = relationship("Customer", foreign_keys=[referrer_customer_id], backref="referrals_sent")
    referred_customer = relationship("Customer", foreign_keys=[referred_customer_id], backref="referrals_received")
    invite = relationship("CustomerInvite", foreign_keys=[invite_id], backref="referral")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(BigInteger, primary_key=True, index=True)
    actor_type = Column(String(20), nullable=False)
    actor_username = Column(String(100))
    actor_customer_id = Column(BigInteger, ForeignKey("customers.id"))
    action = Column(String(100), nullable=False)
    entity_type = Column(String(100))
    entity_id = Column(String(100))
    payload = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    actor_customer = relationship("Customer", foreign_keys=[actor_customer_id])

class ContactSettings(Base):
    __tablename__ = "contact_settings"
    
    id = Column(BigInteger, primary_key=True, index=True)
    welcome_message = Column(Text, nullable=False, default="Welcome to our service!")
    welcome_photo_url = Column(String(500), nullable=True)  # Add photo support for welcome message
    telegram_id = Column(BigInteger, nullable=True)
    telegram_username = Column(String(100), nullable=True)
    phone_number = Column(String(20), nullable=True)
    email_address = Column(String(200), nullable=True)
    additional_info = Column(Text, nullable=True)
    updated_by = Column(BigInteger, ForeignKey("customers.id"))
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Explicit relationship
    updated_by_admin = relationship("Customer", foreign_keys=[updated_by])
    
    # Only one row should exist
        # Only one row should exist
    __table_args__ = (CheckConstraint('id = 1', name='single_row_check'),)

class Settings(Base):
    __tablename__ = "settings"
    
    id = Column(BigInteger, primary_key=True, index=True)
    btc_discount_percent = Column(Integer, default=0)  # Percentage discount for BTC payments
    central_location_name = Column(String(120), default="Atlantic Station")
    central_location_address = Column(String(255), default="Atlantic Station, Atlanta, GA")
    central_location_lat = Column(Float, default=33.7901)
    central_location_lng = Column(Float, default=-84.3972)
    atlantic_station_radius_miles = Column(Float, default=2.0)
    atlantic_station_fee_cents = Column(Integer, default=500)
    inside_i285_radius_miles = Column(Float, default=10.0)
    inside_i285_fee_cents = Column(Integer, default=1000)
    outside_i285_radius_miles = Column(Float, default=18.0)
    outside_i285_fee_cents = Column(Integer, default=2000)
    max_delivery_radius_miles = Column(Float, default=18.0)
    delivery_radius_enforced = Column(Boolean, default=True)
    delivery_minimum_subtotal_cents = Column(Integer, default=7500)
    dispatch_offer_timeout_seconds = Column(Integer, default=90)
    dispatch_auto_escalate = Column(Boolean, default=True)
    admin_session_hours = Column(Integer, default=12)
    updated_by = Column(BigInteger, ForeignKey("customers.id"))
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Explicit relationship
    updated_by_admin = relationship("Customer", foreign_keys=[updated_by])
    
    # Only one row should exist
    __table_args__ = (CheckConstraint('id = 1', name='single_row_check'),)
