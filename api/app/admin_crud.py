from sqlalchemy.orm import Session
from sqlalchemy import func, extract, and_
from datetime import datetime, date, timedelta
from typing import List, Optional
from . import models
import json

def get_dashboard_stats(db: Session):
    """Get overall dashboard statistics"""
    try:
        total_orders = db.query(models.Order).count()
        
        total_revenue_result = db.query(func.sum(models.Order.total_cents)).filter(
            models.Order.payment_status.in_(['paid_0conf', 'paid_confirmed'])
        ).scalar() or 0
        
        active_customers = db.query(models.Customer).count()
        
        pending_orders = db.query(models.Order).filter(
            models.Order.status.in_(['placed', 'scheduled', 'out_for_delivery'])
        ).count()
        
        completed_orders = db.query(models.Order).filter(
            models.Order.status == 'delivered'
        ).count()
        
        return {
            "total_orders": total_orders,
            "total_revenue": total_revenue_result / 100,
            "active_customers": active_customers,
            "pending_orders": pending_orders,
            "completed_orders": completed_orders
        }
    except Exception as e:
        print(f"Error in get_dashboard_stats: {e}")
        # Return default values on error
        return {
            "total_orders": 0,
            "total_revenue": 0,
            "active_customers": 0,
            "pending_orders": 0,
            "completed_orders": 0
        }

def get_revenue_analytics(db: Session, time_range: str = "daily"):
    """Get revenue analytics for different time periods"""
    end_date = datetime.now().date()
    
    if time_range == "daily":
        start_date = end_date - timedelta(days=30)
        group_by = func.date(models.Order.created_at)
    elif time_range == "weekly":
        start_date = end_date - timedelta(weeks=12)
        group_by = func.date_trunc('week', models.Order.created_at)
    elif time_range == "monthly":
        start_date = end_date - timedelta(days=365)
        group_by = func.date_trunc('month', models.Order.created_at)
    else:
        start_date = end_date - timedelta(days=7)
        group_by = func.date(models.Order.created_at)
    
    try:
        results = db.query(
            group_by.label('period'),
            func.count(models.Order.id).label('orders_count'),
            func.sum(models.Order.total_cents).label('total_revenue')
        ).filter(
            models.Order.created_at >= start_date,
            models.Order.payment_status.in_(['paid_0conf', 'paid_confirmed'])
        ).group_by(group_by).order_by('period').all()
        
        analytics = []
        for period, orders_count, total_revenue in results:
            if total_revenue:
                avg_order_value = total_revenue / orders_count / 100
                analytics.append({
                    "period": period.isoformat() if hasattr(period, 'isoformat') else str(period),
                    "revenue": total_revenue / 100,
                    "orders_count": orders_count,
                    "average_order_value": avg_order_value
                })
        
        return analytics
    except Exception as e:
        print(f"Error in get_revenue_analytics: {e}")
        return []

def get_all_customers(db: Session, skip: int = 0, limit: int = 100):
    """Get all customers with order counts"""
    customers = db.query(models.Customer).offset(skip).limit(limit).all()
    
    customer_data = []
    for customer in customers:
        order_count = db.query(models.Order).filter(
            models.Order.customer_id == customer.id
        ).count()
        
        customer_data.append({
            "id": customer.id,
            "telegram_id": customer.telegram_id,
            "phone": customer.phone,
            "order_count": order_count,
            "created_at": customer.created_at.isoformat(),
            "last_order_date": get_customer_last_order_date(db, customer.id)
        })
    
    return customer_data

def get_customer_last_order_date(db: Session, customer_id: int):
    """Get last order date for a customer"""
    last_order = db.query(models.Order).filter(
        models.Order.customer_id == customer_id
    ).order_by(models.Order.created_at.desc()).first()
    
    return last_order.created_at.isoformat() if last_order else None

def get_all_drivers(db: Session, skip: int = 0, limit: int = 100):
    """Get all drivers with their stats"""
    drivers = db.query(models.Driver).offset(skip).limit(limit).all()
    
    driver_data = []
    for driver in drivers:
        delivered_orders = db.query(models.Order).filter(
            models.Order.driver_id == driver.id,
            models.Order.status == 'delivered'
        ).count()
        
        active_orders = db.query(models.Order).filter(
            models.Order.driver_id == driver.id,
            models.Order.status.in_(['out_for_delivery', 'scheduled'])
        ).count()
        
        driver_data.append({
            "id": driver.id,
            "telegram_id": driver.telegram_id,
            "name": driver.name,
            "active": driver.active,
            "delivered_orders": delivered_orders,
            "active_orders": active_orders,
            "created_at": driver.created_at.isoformat()
        })
    
    return driver_data

def get_all_orders(db: Session, skip: int = 0, limit: int = 100, status: Optional[str] = None):
    """Get all orders with customer and driver information"""
    query = db.query(models.Order)
    
    if status:
        query = query.filter(models.Order.status == status)
    
    orders = query.order_by(models.Order.created_at.desc()).offset(skip).limit(limit).all()
    
    order_data = []
    for order in orders:
        customer = db.query(models.Customer).filter(models.Customer.id == order.customer_id).first()
        driver = db.query(models.Driver).filter(models.Driver.id == order.driver_id).first() if order.driver_id else None
        
        order_data.append({
            "id": order.id,
            "order_number": order.order_number,
            "customer_telegram_id": customer.telegram_id if customer else None,
            "customer_phone": customer.phone if customer else None,
            "driver_name": driver.name if driver else None,
            "items": order.items,
            "subtotal_cents": order.subtotal_cents,
            "total_cents": order.total_cents,
            "delivery_or_pickup": order.delivery_or_pickup,
            "status": order.status,
            "payment_status": order.payment_status,
            "payment_type": order.payment_type,
            "delivery_slot_et": order.delivery_slot_et.isoformat() if order.delivery_slot_et else None,
            "created_at": order.created_at.isoformat(),
            "payment_confirmed": order.payment_confirmed,
            "payment_metadata": order.payment_metadata if order.payment_metadata else None
        })
    
    return order_data

def update_order_status(db: Session, order_number: str, status: str, driver_id: Optional[int] = None):
    """Update order status and optionally assign driver"""
    order = db.query(models.Order).filter(models.Order.order_number == order_number).first()
    if not order:
        return None
    
    order.status = status
    if driver_id:
        order.driver_id = driver_id
    
    # Create order event
    event = models.OrderEvent(
        order_id=order.id,
        type="status_update",
        payload={"new_status": status, "driver_id": driver_id}
    )
    db.add(event)
    
    db.commit()
    db.refresh(order)
    return order

def create_menu_item(db: Session, menu_data: dict):
    """Create new menu item"""
    menu_item = models.MenuItem(
        category=menu_data['category'],
        name=menu_data['name'],
        description=menu_data.get('description'),
        price_cents=menu_data['price_cents'],
        photo_url=menu_data.get('photo_url'),
        stock=menu_data.get('stock', 0),
        active=menu_data.get('active', True)
    )
    
    db.add(menu_item)
    db.commit()
    db.refresh(menu_item)
    return menu_item

def update_menu_item(db: Session, item_id: int, update_data: dict):
    """Update menu item"""
    menu_item = db.query(models.MenuItem).filter(models.MenuItem.id == item_id).first()
    if not menu_item:
        return None
    
    for field, value in update_data.items():
        if value is not None:
            setattr(menu_item, field, value)
    
    db.commit()
    db.refresh(menu_item)
    return menu_item

def delete_menu_item(db: Session, item_id: int):
    """Soft delete menu item (set inactive)"""
    menu_item = db.query(models.MenuItem).filter(models.MenuItem.id == item_id).first()
    if not menu_item:
        return None
    
    menu_item.active = False
    db.commit()
    return menu_item

def get_categories(db: Session):
    """Get all unique categories"""
    categories = db.query(models.MenuItem.category).distinct().all()
    return [category[0] for category in categories if category[0]]

def get_order_analytics_by_date(db: Session, start_date: date, end_date: date):
    """Get order analytics by date range"""
    results = db.query(
        func.date(models.Order.created_at).label('order_date'),
        func.count(models.Order.id).label('orders_count'),
        func.sum(models.Order.subtotal_cents).label('total_revenue')
    ).filter(
        models.Order.created_at >= start_date,
        models.Order.created_at <= end_date,
        models.Order.payment_status.in_(['paid_0conf', 'paid_confirmed'])
    ).group_by(func.date(models.Order.created_at)).order_by('order_date').all()
    
    analytics = []
    for order_date, orders_count, total_revenue in results:
        analytics.append({
            "date": order_date.isoformat(),
            "orders_count": orders_count,
            "total_revenue": (total_revenue or 0) / 100
        })
    
    return analytics

def assign_order_to_driver(db: Session, order_number: str, driver_id: int):
    """Assign order to driver and return order details for notification"""
    order = db.query(models.Order).filter(models.Order.order_number == order_number).first()
    if not order:
        return None
    
    driver = db.query(models.Driver).filter(models.Driver.id == driver_id).first()
    if not driver:
        return None
    
    # Update order with driver assignment
    order.driver_id = driver_id
    order.status = 'assigned'
    
    # Create order event
    event = models.OrderEvent(
        order_id=order.id,
        type="driver_assigned",
        payload={
            "driver_id": driver_id,
            "driver_name": driver.name,
            "previous_status": order.status
        }
    )
    db.add(event)
    
    db.commit()
    db.refresh(order)
    
    # Return order and driver details for notification
    customer = db.query(models.Customer).filter(models.Customer.id == order.customer_id).first()
    
    return {
        "order": order,
        "driver": driver,
        "customer": customer
    }

def get_settings(db: Session):
    """Get system settings"""
    settings = db.query(models.Settings).first()
    if not settings:
        settings = models.Settings(btc_discount_percent=0)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings

def update_settings(db: Session, admin_id: int, update_data: dict):
    """Update system settings"""
    settings = db.query(models.Settings).first()
    if not settings:
        settings = models.Settings(id=1)
        db.add(settings)
    
    for field, value in update_data.items():
        if hasattr(settings, field) and value is not None:
            setattr(settings, field, value)
    
    settings.updated_by = admin_id
    settings.updated_at = datetime.now()
    
    db.commit()
    db.refresh(settings)
    return settings