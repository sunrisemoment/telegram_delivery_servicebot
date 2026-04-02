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
    max_concurrent_orders = Column(Integer, default=1)
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
    updated_by = Column(BigInteger, ForeignKey("customers.id"))
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Explicit relationship
    updated_by_admin = relationship("Customer", foreign_keys=[updated_by])
    
    # Only one row should exist
    __table_args__ = (CheckConstraint('id = 1', name='single_row_check'),)
