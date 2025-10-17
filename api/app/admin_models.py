from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, date
from enum import Enum

class TimeRange(str, Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"

class DashboardStats(BaseModel):
    total_orders: int
    total_revenue: float
    active_customers: int
    pending_orders: int
    completed_orders: int

class RevenueAnalytics(BaseModel):
    period: str
    revenue: float
    orders_count: int
    average_order_value: float

class OrderAnalytics(BaseModel):
    date: date
    orders_count: int
    total_revenue: float

class CustomerStats(BaseModel):
    total_customers: int
    new_customers_today: int
    customers_with_orders: int

class MenuUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    price_cents: Optional[int] = None
    stock: Optional[int] = None
    active: Optional[bool] = None

class CategoryCreate(BaseModel):
    name: str
    description: Optional[str] = None

class OrderStatusUpdate(BaseModel):
    status: str
    driver_id: Optional[int] = None

class SettingsUpdate(BaseModel):
    btc_discount_percent: Optional[int] = None