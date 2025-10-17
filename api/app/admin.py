from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile
import os
import shutil
from sqlalchemy import func
from sqlalchemy.orm import Session
from .database import get_db
from . import crud, models
import csv
from datetime import datetime, timedelta, date
from io import StringIO
from .admin_crud import (
    get_dashboard_stats, get_revenue_analytics, get_all_customers,
    get_all_drivers, get_all_orders, update_order_status,
    create_menu_item, update_menu_item, delete_menu_item,
    get_categories, get_order_analytics_by_date
)
from .admin_models import TimeRange
import json
import re
from typing import List, Optional
from .telegram_service import telegram_service
import logging
from .auth import verify_admin_credentials  # Add this import

logger = logging.getLogger(__name__)

router = APIRouter()

UPLOAD_DIR = "static/uploads"

# Add authentication dependency to all admin routes
def get_current_admin(username: str = Depends(verify_admin_credentials)):
    """Dependency to ensure user is authenticated as admin"""
    return username

@router.get("/export_csv")
async def export_csv(date: str, db: Session = Depends(get_db), admin: str = Depends(get_current_admin)):
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    
    # Query orders for the date
    orders = db.query(models.Order).filter(
        models.Order.created_at >= target_date,
        models.Order.created_at < target_date + timedelta(days=1)
    ).all()
    
    # Generate CSV
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["Order Number", "Customer ID", "Total", "Status", "Created At"])
    
    for order in orders:
        writer.writerow([
            order.order_number,
            order.customer_id,
            order.subtotal_cents / 100,
            order.status,
            order.created_at.isoformat()
        ])
    
    return {"csv": output.getvalue()}

@router.post("/set_delivery_min")
async def set_delivery_min(amount: int, admin: str = Depends(get_current_admin)):
    # Store in Redis or database config table
    return {"message": f"Delivery minimum set to ${amount}"}

@router.post("/assign_driver")
async def assign_driver(order_number: str, driver_username: str, db: Session = Depends(get_db), admin: str = Depends(get_current_admin)):
    order = crud.get_order_by_number(db, order_number)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Find driver by username
    driver = db.query(models.Driver).filter(models.Driver.name.ilike(f"%{driver_username}%")).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    
    order.driver_id = driver.id
    db.commit()
    
    return {"message": f"Driver {driver.name} assigned to order {order_number}"}

# =====================================================

# Dashboard and Analytics Endpoints
@router.get("/dashboard/stats")
async def get_admin_dashboard(db: Session = Depends(get_db), admin: str = Depends(get_current_admin)):
    """Get dashboard statistics"""
    return get_dashboard_stats(db)

@router.get("/dashboard/revenue-analytics")
async def get_revenue_analytics_endpoint(
    time_range: TimeRange = Query(TimeRange.DAILY, description="Time range for analytics"),
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Get revenue analytics"""
    return get_revenue_analytics(db, time_range.value)

@router.get("/dashboard/order-analytics")
async def get_order_analytics(
    start_date: date = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: date = Query(..., description="End date (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Get order analytics for date range"""
    if start_date > end_date:
        raise HTTPException(status_code=400, detail="Start date must be before end date")
    
    return get_order_analytics_by_date(db, start_date, end_date)

# Customer Management Endpoints
@router.get("/customers")
async def admin_get_customers(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Get all customers with order counts"""
    return get_all_customers(db, skip, limit)

@router.get("/customers/{customer_id}/orders")
async def get_customer_orders(customer_id: int, db: Session = Depends(get_db), admin: str = Depends(get_current_admin)):
    """Get all orders for a specific customer"""
    customer = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    
    orders = db.query(models.Order).filter(models.Order.customer_id == customer_id).all()
    
    order_data = []
    for order in orders:
        order_data.append({
            "order_number": order.order_number,
            "status": order.status,
            "total": order.subtotal_cents / 100,
            "created_at": order.created_at.isoformat(),
            "delivery_type": order.delivery_or_pickup
        })
    
    return order_data

# Driver Management Endpoints
@router.get("/drivers")
async def admin_get_drivers(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Get all drivers with stats"""
    return get_all_drivers(db, skip, limit)

@router.post("/drivers")
async def create_driver(driver_data: dict, db: Session = Depends(get_db), admin: str = Depends(get_current_admin)):
    """Create a new driver"""
    driver = models.Driver(
        telegram_id=driver_data['telegram_id'],
        name=driver_data['name'],
        active=driver_data.get('active', True)
    )
    
    db.add(driver)
    db.commit()
    db.refresh(driver)
    
    return {"id": driver.id, "message": "Driver created successfully"}

@router.put("/drivers/{driver_id}")
async def update_driver(driver_id: int, driver_data: dict, db: Session = Depends(get_db), admin: str = Depends(get_current_admin)):
    """Update driver information"""
    driver = db.query(models.Driver).filter(models.Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    
    for field, value in driver_data.items():
        if hasattr(driver, field) and value is not None:
            setattr(driver, field, value)
    
    db.commit()
    return {"message": "Driver updated successfully"}

# Order Management Endpoints
@router.get("/orders")
async def admin_get_orders(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Get all orders with filters"""
    return get_all_orders(db, skip, limit, status)

@router.put("/orders/{order_number}/status")
async def update_order_status_endpoint(order_number: str, status_data: dict, db: Session = Depends(get_db), admin: str = Depends(get_current_admin)):
    """Update order status"""
    order = update_order_status(db, order_number, status_data['status'], status_data.get('driver_id'))
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    return {"message": "Order status updated successfully"}

@router.get("/orders/{order_number}")
async def get_order_details(order_number: str, db: Session = Depends(get_db), admin: str = Depends(get_current_admin)):
    """Get detailed order information"""
    order = db.query(models.Order).filter(models.Order.order_number == order_number).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    customer = db.query(models.Customer).filter(models.Customer.id == order.customer_id).first()
    driver = db.query(models.Driver).filter(models.Driver.id == order.driver_id).first() if order.driver_id else None
    events = db.query(models.OrderEvent).filter(models.OrderEvent.order_id == order.id).order_by(models.OrderEvent.created_at).all()
    
    return {
        "order_number": order.order_number,
        "customer": {
            "telegram_id": customer.telegram_id,
            "phone": customer.phone
        } if customer else None,
        "driver": {
            "name": driver.name,
            "telegram_id": driver.telegram_id
        } if driver else None,
        "items": order.items,
        "subtotal": order.subtotal_cents / 100,
        "delivery_type": order.delivery_or_pickup,
        "delivery_fee": order.delivery_fee_cents / 100,
        "delivery_address": order.delivery_address_text,
        "pickup_address": order.pickup_address_text,
        "total": order.total_cents / 100,
        "status": order.status,
        "payment_status": order.payment_status,
        "payment_type": order.payment_type,
        "delivery_slot": order.delivery_slot_et.isoformat() if order.delivery_slot_et else None,
        "notes": order.notes,
        "created_at": order.created_at.isoformat(),
        "events": [
            {
                "type": event.type,
                "payload": event.payload,
                "created_at": event.created_at.isoformat()
            } for event in events
        ]
    }

# Menu Management Endpoints
@router.get("/menu/categories")
async def get_menu_categories(db: Session = Depends(get_db), admin: str = Depends(get_current_admin)):
    """Get all menu categories"""
    return get_categories(db)

@router.post("/menu/items")
async def create_menu_item_endpoint(menu_data: dict, db: Session = Depends(get_db), admin: str = Depends(get_current_admin)):
    """Create a new menu item"""
    required_fields = ['category', 'name', 'price_cents']
    for field in required_fields:
        if field not in menu_data:
            raise HTTPException(status_code=400, detail=f"Missing required field: {field}")
    
    menu_item = create_menu_item(db, menu_data)
    return {"id": menu_item.id, "message": "Menu item created successfully"}

@router.put("/menu/items/{item_id}")
async def update_menu_item_endpoint(item_id: int, update_data: dict, db: Session = Depends(get_db), admin: str = Depends(get_current_admin)):
    """Update a menu item"""
    menu_item = update_menu_item(db, item_id, update_data)
    if not menu_item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    
    return {"message": "Menu item updated successfully"}

@router.delete("/menu/items/{item_id}")
async def delete_menu_item_endpoint(item_id: int, db: Session = Depends(get_db), admin: str = Depends(get_current_admin)):
    """Delete a menu item (soft delete)"""
    menu_item = delete_menu_item(db, item_id)
    if not menu_item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    
    return {"message": "Menu item deleted successfully"}

@router.get("/menu/items")
async def get_all_menu_items(
    active_only: bool = Query(True),
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Get all menu items with filters"""
    query = db.query(models.MenuItem)
    
    if active_only:
        query = query.filter(models.MenuItem.active == True)
    
    if category:
        query = query.filter(models.MenuItem.category == category)
    
    items = query.order_by(models.MenuItem.category, models.MenuItem.name).all()
    
    return [
        {
            "id": item.id,
            "category": item.category,
            "name": item.name,
            "description": item.description,
            "price_cents": item.price_cents,
            "price": f"${item.price_cents / 100:.2f}",
            "stock": item.stock,
            "active": item.active,
            "photo_url": item.photo_url
        }
        for item in items
    ]

@router.post("/upload-photo")
async def upload_photo(
    file: UploadFile = File(...),
    old_photo_url: str = None  # Add parameter for old photo URL
):
    """Upload a photo and return the URL, optionally removing old photo"""
    try:
        print(f"📸 Uploading photo: {file.filename}")
        
        # Validate file type
        allowed_types = ['image/jpeg', 'image/png', 'image/jpg', 'image/gif', 'image/webp']
        if file.content_type not in allowed_types:
            raise HTTPException(status_code=400, detail="File must be an image (JPEG, PNG, GIF, WebP)")
        
        # Remove old photo if provided
        if old_photo_url:
            await remove_old_photo(old_photo_url)
        
        # Generate unique filename
        file_extension = os.path.splitext(file.filename)[1]
        unique_filename = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{os.urandom(4).hex()}{file_extension}"
        file_path = os.path.join(UPLOAD_DIR, unique_filename)
        
        # Save file
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Return URL
        photo_url = f"/static/uploads/{unique_filename}"
        print(f"✅ Upload successful: {photo_url}")
        
        return {"photo_url": photo_url, "filename": unique_filename}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")
    finally:
        await file.close()

async def remove_old_photo(photo_url: str):
    """Remove old photo file from server"""
    try:
        if photo_url and photo_url.startswith("/static/uploads/"):
            filename = photo_url.replace("/static/uploads/", "")
            file_path = os.path.join(UPLOAD_DIR, filename)
            
            if os.path.exists(file_path):
                os.remove(file_path)
                print(f"🗑️ Removed old photo: {filename}")
            else:
                print(f"⚠️ Old photo not found: {file_path}")
    except Exception as e:
        print(f"❌ Error removing old photo: {e}")
        # Don't raise error - we don't want to fail the upload if deletion fails

@router.delete("/delete-photo")
async def delete_photo(photo_url: str, admin: str = Depends(get_current_admin)):
    """Delete a photo from server"""
    try:
        if not photo_url:
            return {"message": "No photo URL provided"}
            
        if photo_url.startswith("/static/uploads/"):
            filename = photo_url.replace("/static/uploads/", "")
            file_path = os.path.join(UPLOAD_DIR, filename)
            
            if os.path.exists(file_path):
                os.remove(file_path)
                print(f"🗑️ Deleted photo: {filename}")
                return {"message": "Photo deleted successfully"}
            else:
                return {"message": "Photo file not found"}
        else:
            return {"message": "Invalid photo URL"}
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")

@router.get("/orders/{order_number}/available-drivers")
async def get_available_drivers(order_number: str, db: Session = Depends(get_db), admin: str = Depends(get_current_admin)):
    """Get available drivers for order assignment"""
    # Get order to check if it already has a driver
    order = db.query(models.Order).filter(models.Order.order_number == order_number).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Get active drivers who don't have too many active orders
    active_drivers = db.query(models.Driver).filter(
        models.Driver.active == True
    ).all()
    
    # Calculate active orders for each driver
    drivers_with_stats = []
    for driver in active_drivers:
        active_order_count = db.query(models.Order).filter(
            models.Order.driver_id == driver.id,
            models.Order.status.in_(['assigned', 'out_for_delivery', 'scheduled'])
        ).count()
        
        drivers_with_stats.append({
            "id": driver.id,
            "name": driver.name,
            "telegram_id": driver.telegram_id,
            "active_orders": active_order_count,
            "already_assigned": driver.id == order.driver_id
        })
    
    return drivers_with_stats

@router.post("/orders/{order_number}/assign-driver")
async def assign_driver_to_order(
    order_number: str, 
    assignment_data: dict, 
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Assign driver to order and send notifications"""
    driver_id = assignment_data.get('driver_id')
    if not driver_id:
        raise HTTPException(status_code=400, detail="Driver ID is required")
    
    logger.info(f"Assigning driver {driver_id} to order {order_number}")
    
    # Assign order to driver
    from .admin_crud import assign_order_to_driver
    assignment_result = assign_order_to_driver(db, order_number, driver_id)
    
    if not assignment_result:
        raise HTTPException(status_code=404, detail="Order or driver not found")
    
    # Send notification to driver
    driver_notification_sent = False
    driver = assignment_result["driver"]
    order = assignment_result["order"]
    
    if driver.telegram_id:
        logger.info(f"Attempting to send Telegram notification to driver {driver.name} (TG: {driver.telegram_id})")
        driver_notification_sent = telegram_service.notify_driver_assignment(
            driver.telegram_id,
            assignment_result
        )
        
        if driver_notification_sent:
            logger.info(f"✅ Driver notification sent successfully to {driver.name}")
        else:
            logger.error(f"❌ Failed to send driver notification to {driver.name}")
    else:
        logger.warning(f"Driver {driver.name} has no Telegram ID, cannot send notification")
    
    # Send notification to customer
    customer_notification_sent = False
    customer = assignment_result["customer"]
    
    if customer and customer.telegram_id:
        logger.info(f"Attempting to send customer notification for order {order_number}")
        customer_notification_sent = telegram_service.notify_order_status_update(
            customer.telegram_id,
            order_number,
            'assigned',
            driver.name
        )
        
        if customer_notification_sent:
            logger.info(f"✅ Customer notification sent successfully")
        else:
            logger.error(f"❌ Failed to send customer notification")
    else:
        logger.warning(f"Customer has no Telegram ID, cannot send notification")
    
    # Create response with detailed notification status
    response_data = {
        "message": "Driver assigned successfully",
        "order_number": order_number,
        "driver_assigned": driver.name,
        "driver_telegram_id": driver.telegram_id,
        "notifications": {
            "driver": {
                "sent": driver_notification_sent,
                "telegram_id": driver.telegram_id,
                "driver_name": driver.name
            },
            "customer": {
                "sent": customer_notification_sent,
                "telegram_id": customer.telegram_id if customer else None
            }
        }
    }
    
    logger.info(f"Driver assignment completed: {response_data}")
    return response_data

@router.post("/orders/{order_number}/status")
async def update_order_status_with_notification(
    order_number: str, 
    status_data: dict, 
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Update order status and send notifications"""
    order = db.query(models.Order).filter(models.Order.order_number == order_number).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    new_status = status_data.get('status')
    if not new_status:
        raise HTTPException(status_code=400, detail="Status is required")
    
    # Update order status
    from .admin_crud import update_order_status
    updated_order = update_order_status(db, order_number, new_status, status_data.get('driver_id'))
    
    if not updated_order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Send notification to customer if status change warrants it
    customer = db.query(models.Customer).filter(models.Customer.id == order.customer_id).first()
    driver = db.query(models.Driver).filter(models.Driver.id == order.driver_id).first() if order.driver_id else None
    
    notification_sent = False
    if customer and customer.telegram_id and new_status in ['out_for_delivery', 'delivered']:
        notification_sent = telegram_service.notify_order_status_update(
            customer.telegram_id,
            order_number,
            new_status,
            driver.name if driver else None
        )
    
    return {
        "message": "Order status updated successfully",
        "notification_sent": notification_sent
    }

@router.post("/test-telegram")
async def test_telegram_notification(test_data: dict, db: Session = Depends(get_db), admin: str = Depends(get_current_admin)):
    """Test Telegram notification functionality"""
    telegram_id = test_data.get('telegram_id')
    message = test_data.get('message', 'Test message from Delivery Bot Admin')
    
    if not telegram_id:
        raise HTTPException(status_code=400, detail="Telegram ID is required")
    
    try:
        success = telegram_service.send_message(
            telegram_id, 
            f"🔔 <b>Test Notification</b>\n\n{message}\n\nThis is a test message from your delivery bot admin panel."
        )
        
        if success:
            return {"status": "success", "message": "Test message sent successfully"}
        else:
            return {"status": "error", "message": "Failed to send test message"}
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error sending test message: {str(e)}")
    
@router.get("/inventory/drivers/{driver_id}/stock")
async def get_driver_inventory(
    driver_id: int, 
    db: Session = Depends(get_db), 
    admin: str = Depends(get_current_admin)
):
    """Get driver's current inventory"""
    from .inventory_service import get_inventory_service
    
    inventory_service = get_inventory_service(db)
    driver_stock = inventory_service.get_driver_inventory_summary(driver_id)
    
    stock_data = []
    for stock in driver_stock:
        menu_item = db.query(models.MenuItem).filter(models.MenuItem.id == stock.menu_item_id).first()
        stock_data.append({
            "menu_item_id": stock.menu_item_id,
            "menu_item_name": menu_item.name if menu_item else "Unknown",
            "category": menu_item.category if menu_item else "Unknown",
            "on_hand_qty": stock.on_hand_qty,
            "updated_at": stock.updated_at.isoformat() if stock.updated_at else None
        })
    
    return stock_data

@router.post("/inventory/drivers/{driver_id}/loadout")
async def loadout_to_driver(
    driver_id: int,
    loadout_data: dict,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Load stock to driver"""
    from .inventory_service import get_inventory_service
    
    required_fields = ['menu_item_id', 'quantity']
    for field in required_fields:
        if field not in loadout_data:
            raise HTTPException(status_code=400, detail=f"Missing required field: {field}")
    
    inventory_service = get_inventory_service(db)
    
    try:
        driver_stock = inventory_service.loadout_to_driver(
            driver_id=driver_id,
            menu_item_id=loadout_data['menu_item_id'],
            quantity=loadout_data['quantity'],
            reason_note=loadout_data.get('reason_note', 'Admin loadout')
        )
        
        return {
            "message": "Loadout successful",
            "driver_id": driver_id,
            "menu_item_id": loadout_data['menu_item_id'],
            "new_quantity": driver_stock.on_hand_qty
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/inventory/transfer")
async def transfer_stock_between_drivers(
    transfer_data: dict,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Transfer stock between drivers"""
    from .inventory_service import get_inventory_service
    
    required_fields = ['from_driver_id', 'to_driver_id', 'menu_item_id', 'quantity']
    for field in required_fields:
        if field not in transfer_data:
            raise HTTPException(status_code=400, detail=f"Missing required field: {field}")
    
    inventory_service = get_inventory_service(db)
    
    try:
        inventory_service.transfer_stock(
            from_driver_id=transfer_data['from_driver_id'],
            to_driver_id=transfer_data['to_driver_id'],
            menu_item_id=transfer_data['menu_item_id'],
            quantity=transfer_data['quantity'],
            reason_note=transfer_data.get('reason_note', 'Admin transfer')
        )
        
        return {
            "message": "Transfer successful",
            "from_driver_id": transfer_data['from_driver_id'],
            "to_driver_id": transfer_data['to_driver_id'],
            "menu_item_id": transfer_data['menu_item_id'],
            "quantity": transfer_data['quantity']
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/inventory/drivers/{driver_id}/adjust")
async def adjust_driver_stock(
    driver_id: int,
    adjust_data: dict,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Adjust driver stock to specific quantity"""
    from .inventory_service import get_inventory_service
    
    required_fields = ['menu_item_id', 'new_quantity']
    for field in required_fields:
        if field not in adjust_data:
            raise HTTPException(status_code=400, detail=f"Missing required field: {field}")
    
    inventory_service = get_inventory_service(db)
    
    try:
        driver_stock = inventory_service.adjust_driver_stock(
            driver_id=driver_id,
            menu_item_id=adjust_data['menu_item_id'],
            new_quantity=adjust_data['new_quantity'],
            reason_note=adjust_data.get('reason_note', 'Admin adjustment')
        )
        
        return {
            "message": "Adjustment successful",
            "driver_id": driver_id,
            "menu_item_id": adjust_data['menu_item_id'],
            "new_quantity": driver_stock.on_hand_qty
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/inventory/reservations")
async def get_active_reservations(
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Get active reservations using manual joins"""
    try:
        from sqlalchemy.orm import aliased
        
        # Create aliases for clarity
        Order = models.Order
        MenuItem = models.MenuItem
        InventoryReservation = models.InventoryReservation
        
        # Query with explicit joins
        reservations = db.query(
            InventoryReservation,
            Order.order_number,
            MenuItem.name.label('menu_item_name')
        ).join(
            Order, InventoryReservation.order_id == Order.id
        ).join(
            MenuItem, InventoryReservation.menu_item_id == MenuItem.id
        ).filter(
            InventoryReservation.status == 'active'
        ).all()
        
        reservation_data = []
        for reservation, order_number, menu_item_name in reservations:
            reservation_data.append({
                "id": reservation.id,
                "order_number": order_number,
                "menu_item_name": menu_item_name,
                "reserved_qty": reservation.reserved_qty,
                "created_at": reservation.created_at.isoformat(),
                "expires_at": reservation.expires_at.isoformat() if reservation.expires_at else None
            })
        
        return reservation_data
        
    except Exception as e:
        logger.error(f"Error getting active reservations: {e}")
        return []

@router.post("/inventory/reservations/{reservation_id}/release")
async def release_reservation(
    reservation_id: int,
    release_data: dict,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Manually release a reservation"""
    reservation = db.query(models.InventoryReservation).filter(
        models.InventoryReservation.id == reservation_id
    ).first()
    
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    
    reservation.status = 'released'
    db.commit()
    
    return {"message": "Reservation released successfully"}

@router.post("/inventory/cleanup-expired")
async def cleanup_expired_reservations(
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Clean up expired reservations"""
    from .inventory_service import get_inventory_service
    
    inventory_service = get_inventory_service(db)
    cleaned_count = inventory_service.cleanup_expired_reservations()
    
    return {"message": f"Cleaned up {cleaned_count} expired reservations"}

# Update the order status endpoint to handle inventory on delivery
@router.post("/orders/{order_number}/status")
async def update_order_status_with_notification(
    order_number: str, 
    status_data: dict, 
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Update order status and handle inventory"""
    from .inventory_service import get_inventory_service
    
    order = db.query(models.Order).filter(models.Order.order_number == order_number).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    new_status = status_data.get('status')
    if not new_status:
        raise HTTPException(status_code=400, detail="Status is required")
    
    inventory_service = get_inventory_service(db)
    
    # Handle inventory for status changes
    if new_status == 'delivered' and order.assigned_driver_id:
        # Fulfill reservations and deduct from driver stock
        try:
            inventory_service.fulfill_reservations(order.id, order.assigned_driver_id)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Inventory fulfillment failed: {str(e)}")
    elif new_status in ['cancelled', 'expired']:
        # Release reservations
        inventory_service.release_reservations(order.id, f"Order {new_status}")
    
    # Update order status (using existing admin_crud function)
    from .admin_crud import update_order_status
    updated_order = update_order_status(db, order_number, new_status, status_data.get('driver_id'))
    
    if not updated_order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Send notification to customer if status change warrants it
    customer = db.query(models.Customer).filter(models.Customer.id == order.customer_id).first()
    driver = db.query(models.Driver).filter(models.Driver.id == order.driver_id).first() if order.driver_id else None
    
    notification_sent = False
    if customer and customer.telegram_id and new_status in ['out_for_delivery', 'delivered']:
        from .telegram_service import telegram_service
        notification_sent = telegram_service.notify_order_status_update(
            customer.telegram_id,
            order_number,
            new_status,
            driver.name if driver else None
        )
    
    return {
        "message": "Order status updated successfully",
        "inventory_updated": new_status in ['delivered', 'cancelled', 'expired'],
        "notification_sent": notification_sent
    }

@router.delete("/menu/items/{item_id}/permanent")
async def permanently_delete_menu_item(
    item_id: int, 
    db: Session = Depends(get_db), 
    admin: str = Depends(get_current_admin)
):
    """Permanently delete a menu item"""
    # Check if item exists
    menu_item = db.query(models.MenuItem).filter(models.MenuItem.id == item_id).first()
    if not menu_item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    
    # Check if item is referenced in any orders using JSON functions
    from sqlalchemy import text
    
    # Use json_array_elements for JSON type (not JSONB)
    order_references = db.execute(
        text("""
            SELECT COUNT(*) FROM orders 
            WHERE EXISTS (
                SELECT 1 FROM json_array_elements(items) AS item 
                WHERE (item->>'menu_id')::int = :menu_item_id
            )
        """),
        {"menu_item_id": item_id}
    ).scalar()
    
    if order_references > 0:
        raise HTTPException(
            status_code=400, 
            detail=f"Cannot delete menu item. It is referenced in {order_references} orders."
        )
    
    # Check inventory reservations
    inventory_references = db.query(models.InventoryReservation).filter(
        models.InventoryReservation.menu_item_id == item_id
    ).count()
    
    if inventory_references > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete menu item. It has {inventory_references} inventory reservations."
        )
    
    # Check driver stock
    driver_stock_references = db.query(models.DriverStock).filter(
        models.DriverStock.menu_item_id == item_id
    ).count()
    
    if driver_stock_references > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete menu item. It has {driver_stock_references} driver stock records."
        )
    
    # Check driver stock events
    driver_event_references = db.query(models.DriverStockEvent).filter(
        models.DriverStockEvent.menu_item_id == item_id
    ).count()
    
    if driver_event_references > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete menu item. It has {driver_event_references} driver stock events."
        )
    
    # Delete the item
    db.delete(menu_item)
    db.commit()
    
    return {"message": "Menu item permanently deleted"}
# Add a utility function for JSON searching in orders
def check_menu_item_in_orders(db: Session, menu_item_id: int) -> int:
    """Check if a menu item is referenced in any orders"""
    from sqlalchemy import text
    
    try:
        # Try PostgreSQL JSONB approach first
        result = db.execute(
            text("""
                SELECT COUNT(*) FROM orders 
                WHERE EXISTS (
                    SELECT 1 FROM jsonb_array_elements(items) AS item 
                    WHERE (item->>'menu_id')::int = :menu_item_id
                )
            """),
            {"menu_item_id": menu_item_id}
        ).scalar()
        return result
    except Exception as e:
        # Fallback: check if items field contains the menu_id (less precise but works)
        print(f"JSONB query failed, using fallback: {e}")
        try:
            # Convert to string search as last resort
            result = db.query(models.Order).filter(
                models.Order.items.astext.like(f'%"menu_id": {menu_item_id}%')
            ).count()
            return result
        except Exception as e2:
            print(f"Fallback also failed: {e2}")
            return 0

@router.delete("/menu/items/{item_id}/force")
async def force_delete_menu_item(
    item_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Force delete a menu item, removing all references"""
    menu_item = db.query(models.MenuItem).filter(models.MenuItem.id == item_id).first()
    if not menu_item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    
    # Get counts for reporting
    from sqlalchemy import text
    
    order_count = db.execute(
        text("""
            SELECT COUNT(*) FROM orders 
            WHERE EXISTS (
                SELECT 1 FROM json_array_elements(items) AS item 
                WHERE (item->>'menu_id')::int = :menu_item_id
            )
        """),
        {"menu_item_id": item_id}
    ).scalar()
    
    inventory_count = db.query(models.InventoryReservation).filter(
        models.InventoryReservation.menu_item_id == item_id
    ).count()
    
    driver_stock_count = db.query(models.DriverStock).filter(
        models.DriverStock.menu_item_id == item_id
    ).count()
    
    driver_event_count = db.query(models.DriverStockEvent).filter(
        models.DriverStockEvent.menu_item_id == item_id
    ).count()
    
    # Delete all references first
    try:
        # Delete inventory reservations
        db.query(models.InventoryReservation).filter(
            models.InventoryReservation.menu_item_id == item_id
        ).delete()
        
        # Delete driver stock
        db.query(models.DriverStock).filter(
            models.DriverStock.menu_item_id == item_id
        ).delete()
        
        # Delete driver stock events
        db.query(models.DriverStockEvent).filter(
            models.DriverStockEvent.menu_item_id == item_id
        ).delete()
        
        # Finally delete the menu item
        db.delete(menu_item)
        db.commit()
        
        return {
            "message": "Menu item force deleted successfully",
            "removed_references": {
                "orders_referencing": order_count,
                "inventory_reservations": inventory_count,
                "driver_stock_records": driver_stock_count,
                "driver_stock_events": driver_event_count
            }
        }
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Force delete failed: {str(e)}")

@router.get("/menu/items/{item_id}/references")
async def get_menu_item_references(
    item_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Get all references to a menu item before deletion"""
    from sqlalchemy import text
    
    menu_item = db.query(models.MenuItem).filter(models.MenuItem.id == item_id).first()
    if not menu_item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    
    # Get order references using json_array_elements
    order_references = db.execute(
        text("""
            SELECT order_number, created_at FROM orders 
            WHERE EXISTS (
                SELECT 1 FROM json_array_elements(items) AS item 
                WHERE (item->>'menu_id')::int = :menu_item_id
            )
            LIMIT 10
        """),
        {"menu_item_id": item_id}
    ).fetchall()
    
    # Get counts
    order_count = db.execute(
        text("""
            SELECT COUNT(*) FROM orders 
            WHERE EXISTS (
                SELECT 1 FROM json_array_elements(items) AS item 
                WHERE (item->>'menu_id')::int = :menu_item_id
            )
        """),
        {"menu_item_id": item_id}
    ).scalar()
    
    inventory_count = db.query(models.InventoryReservation).filter(
        models.InventoryReservation.menu_item_id == item_id
    ).count()
    
    driver_stock_count = db.query(models.DriverStock).filter(
        models.DriverStock.menu_item_id == item_id
    ).count()
    
    driver_event_count = db.query(models.DriverStockEvent).filter(
        models.DriverStockEvent.menu_item_id == item_id
    ).count()
    
    return {
        "menu_item": {
            "id": menu_item.id,
            "name": menu_item.name,
            "category": menu_item.category
        },
        "references": {
            "orders": {
                "count": order_count,
                "sample": [dict(row) for row in order_references]
            },
            "inventory_reservations": inventory_count,
            "driver_stock_records": driver_stock_count,
            "driver_stock_events": driver_event_count
        },
        "can_safe_delete": all([
            order_count == 0,
            inventory_count == 0,
            driver_stock_count == 0,
            driver_event_count == 0
        ])
    }

@router.delete("/customers/{customer_id}/permanent")
async def permanently_delete_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Permanently delete a customer"""
    customer = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    
    # Check if customer has orders
    order_count = db.query(models.Order).filter(models.Order.customer_id == customer_id).count()
    if order_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete customer. They have {order_count} orders."
        )
    
    # Check if customer has addresses
    address_count = db.query(models.CustomerAddress).filter(
        models.CustomerAddress.customer_id == customer_id
    ).count()
    
    if address_count > 0:
        # Delete addresses first
        db.query(models.CustomerAddress).filter(
            models.CustomerAddress.customer_id == customer_id
        ).delete()
    
    db.delete(customer)
    db.commit()
    
    return {"message": "Customer permanently deleted"}

@router.delete("/drivers/{driver_id}/permanent")
async def permanently_delete_driver(
    driver_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Permanently delete a driver"""
    driver = db.query(models.Driver).filter(models.Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    
    # Check if driver is assigned to any orders
    assigned_orders = db.query(models.Order).filter(models.Order.driver_id == driver_id).count()
    if assigned_orders > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete driver. They are assigned to {assigned_orders} orders."
        )
    
    # Check driver stock
    stock_count = db.query(models.DriverStock).filter(models.DriverStock.driver_id == driver_id).count()
    if stock_count > 0:
        # Delete driver stock records
        db.query(models.DriverStock).filter(models.DriverStock.driver_id == driver_id).delete()
    
    # Check driver stock events
    event_count = db.query(models.DriverStockEvent).filter(models.DriverStockEvent.driver_id == driver_id).count()
    if event_count > 0:
        db.query(models.DriverStockEvent).filter(models.DriverStockEvent.driver_id == driver_id).delete()
    
    db.delete(driver)
    db.commit()
    
    return {"message": "Driver permanently deleted"}

@router.delete("/orders/{order_number}/permanent")
async def permanently_delete_order(
    order_number: str,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Permanently delete an order"""
    order = db.query(models.Order).filter(models.Order.order_number == order_number).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Delete related records first
    
    # Delete order events
    db.query(models.OrderEvent).filter(models.OrderEvent.order_id == order.id).delete()
    
    # Delete inventory reservations
    db.query(models.InventoryReservation).filter(models.InventoryReservation.order_id == order.id).delete()
    
    # Delete driver stock events related to this order
    db.query(models.DriverStockEvent).filter(models.DriverStockEvent.order_id == order.id).delete()
    
    # Delete the order
    db.delete(order)
    db.commit()
    
    return {"message": "Order permanently deleted"}

# Add bulk delete endpoints
@router.post("/menu/items/bulk-delete")
async def bulk_delete_menu_items(
    delete_data: dict,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Bulk delete multiple menu items"""
    item_ids = delete_data.get('item_ids', [])
    results = []
    
    for item_id in item_ids:
        try:
            # Use soft delete for bulk operations
            menu_item = db.query(models.MenuItem).filter(models.MenuItem.id == item_id).first()
            if menu_item:
                menu_item.active = False
                results.append({"id": item_id, "status": "deactivated"})
        except Exception as e:
            results.append({"id": item_id, "status": "error", "message": str(e)})
    
    db.commit()
    return {"results": results}

def check_menu_item_in_orders_universal(db: Session, menu_item_id: int) -> int:
    """Universal approach to check menu item references in orders"""
    try:
        # Try PostgreSQL JSON approach first
        from sqlalchemy import text
        try:
            result = db.execute(
                text("""
                    SELECT COUNT(*) FROM orders 
                    WHERE EXISTS (
                        SELECT 1 FROM json_array_elements(items) AS item 
                        WHERE (item->>'menu_id')::int = :menu_item_id
                    )
                """),
                {"menu_item_id": menu_item_id}
            ).scalar()
            return result
        except Exception as json_error:
            # If JSON functions fail, try the manual approach
            print(f"JSON query failed, using manual approach: {json_error}")
            return check_menu_item_in_orders_manual(db, menu_item_id)
            
    except Exception as e:
        print(f"All approaches failed: {e}")
        return 0

def check_menu_item_in_orders_manual(db: Session, menu_item_id: int) -> int:
    """Manual approach - works with any database but less efficient"""
    orders = db.query(models.Order).all()
    count = 0
    
    for order in orders:
        try:
            # Safely check each order's items
            if isinstance(order.items, list):
                for item in order.items:
                    if isinstance(item, dict) and item.get('menu_id') == menu_item_id:
                        count += 1
                        break  # Only count order once
        except Exception as e:
            print(f"Error checking order {order.id}: {e}")
            continue
    
    return count

def get_order_references_universal(db: Session, menu_item_id: int, limit: int = 10):
    """Get order references using universal approach"""
    try:
        # Try PostgreSQL JSON approach first
        from sqlalchemy import text
        try:
            results = db.execute(
                text("""
                    SELECT order_number, created_at FROM orders 
                    WHERE EXISTS (
                        SELECT 1 FROM json_array_elements(items) AS item 
                        WHERE (item->>'menu_id')::int = :menu_item_id
                    )
                    LIMIT :limit
                """),
                {"menu_item_id": menu_item_id, "limit": limit}
            ).fetchall()
            return [dict(row) for row in results]
        except Exception as json_error:
            # Fallback to manual approach
            print(f"JSON query failed, using manual approach: {json_error}")
            return get_order_references_manual(db, menu_item_id, limit)
            
    except Exception as e:
        print(f"All approaches failed: {e}")
        return []

def get_order_references_manual(db: Session, menu_item_id: int, limit: int = 10):
    """Manual approach to get order references"""
    orders = db.query(models.Order).all()
    references = []
    
    for order in orders:
        if len(references) >= limit:
            break
            
        try:
            if isinstance(order.items, list):
                for item in order.items:
                    if isinstance(item, dict) and item.get('menu_id') == menu_item_id:
                        references.append({
                            "order_number": order.order_number,
                            "created_at": order.created_at
                        })
                        break  # Only add order once
        except Exception as e:
            print(f"Error processing order {order.id}: {e}")
            continue
    
    return references

# Update the endpoints to use universal functions
@router.delete("/menu/items/{item_id}/permanent-universal")
async def permanently_delete_menu_item_universal(
    item_id: int, 
    db: Session = Depends(get_db), 
    admin: str = Depends(get_current_admin)
):
    """Permanently delete a menu item (universal version)"""
    menu_item = db.query(models.MenuItem).filter(models.MenuItem.id == item_id).first()
    if not menu_item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    
    # Use universal approach to check orders
    order_references = check_menu_item_in_orders_universal(db, item_id)
    
    if order_references > 0:
        raise HTTPException(
            status_code=400, 
            detail=f"Cannot delete menu item. It is referenced in {order_references} orders."
        )
    
    # Check other references
    inventory_references = db.query(models.InventoryReservation).filter(
        models.InventoryReservation.menu_item_id == item_id
    ).count()
    
    driver_stock_references = db.query(models.DriverStock).filter(
        models.DriverStock.menu_item_id == item_id
    ).count()
    
    driver_event_references = db.query(models.DriverStockEvent).filter(
        models.DriverStockEvent.menu_item_id == item_id
    ).count()
    
    if any([inventory_references > 0, driver_stock_references > 0, driver_event_references > 0]):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete menu item. It has references: {inventory_references} reservations, {driver_stock_references} stock records, {driver_event_references} events."
        )
    
    # Delete the item
    db.delete(menu_item)
    db.commit()
    
    return {"message": "Menu item permanently deleted"}

@router.get("/menu/items/{item_id}/references-universal")
async def get_menu_item_references_universal(
    item_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Get all references to a menu item (universal version)"""
    menu_item = db.query(models.MenuItem).filter(models.MenuItem.id == item_id).first()
    if not menu_item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    
    # Use universal approaches
    order_references = get_order_references_universal(db, item_id, 10)
    order_count = check_menu_item_in_orders_universal(db, item_id)
    
    inventory_count = db.query(models.InventoryReservation).filter(
        models.InventoryReservation.menu_item_id == item_id
    ).count()
    
    driver_stock_count = db.query(models.DriverStock).filter(
        models.DriverStock.menu_item_id == item_id
    ).count()
    
    driver_event_count = db.query(models.DriverStockEvent).filter(
        models.DriverStockEvent.menu_item_id == item_id
    ).count()
    
    return {
        "menu_item": {
            "id": menu_item.id,
            "name": menu_item.name,
            "category": menu_item.category
        },
        "references": {
            "orders": {
                "count": order_count,
                "sample": order_references
            },
            "inventory_reservations": inventory_count,
            "driver_stock_records": driver_stock_count,
            "driver_stock_events": driver_event_count
        },
        "can_safe_delete": all([
            order_count == 0,
            inventory_count == 0,
            driver_stock_count == 0,
            driver_event_count == 0
        ])
    }

@router.get("/payments/pending-btc")
async def get_pending_btc_payments(
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Get list of BTC payments needing confirmation"""
    from .payment_service import get_payment_service
    
    payment_service = get_payment_service(db)
    pending_payments = payment_service.get_pending_btc_payments()
    
    return pending_payments

@router.post("/payments/confirm-btc/{order_number}")
async def confirm_btc_payment(
    order_number: str,
    confirmation_data: dict,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Manually confirm BTC 0-conf payment"""
    from .payment_service import get_payment_service
    
    confirmed_by = confirmation_data.get('confirmed_by')  # Admin user ID
    notes = confirmation_data.get('notes', '')
    
    if not confirmed_by:
        raise HTTPException(status_code=400, detail="confirmed_by field is required")
    
    payment_service = get_payment_service(db)
    success = payment_service.confirm_btc_payment(order_number, confirmed_by, notes)
    
    if success:
        # Send notification to customer
        order = db.query(models.Order).filter(models.Order.order_number == order_number).first()
        if order:
            customer = db.query(models.Customer).filter(models.Customer.id == order.customer_id).first()
            if customer and customer.telegram_id:
                from .telegram_service import telegram_service
                telegram_service.send_message(
                    customer.telegram_id,
                    f"✅ <b>Payment Confirmed!</b>\n\n"
                    f"Your BTC payment for order #{order_number} has been confirmed.\n"
                    f"Your order is now being processed! 🚀"
                )
        
        return {"message": f"BTC payment for order {order_number} confirmed successfully"}
    else:
        raise HTTPException(status_code=400, detail="Failed to confirm BTC payment")

@router.get("/orders/{order_number}/payment-details")
async def get_order_payment_details(
    order_number: str,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Get detailed payment information for an order"""
    order = db.query(models.Order).filter(models.Order.order_number == order_number).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    customer = db.query(models.Customer).filter(models.Customer.id == order.customer_id).first()
    
    return {
        "order_number": order.order_number,
        "payment_type": order.payment_type,
        "payment_status": order.payment_status,
        "payment_confirmed": order.payment_confirmed,
        "payment_confirmed_by": order.payment_confirmed_by,
        "payment_confirmed_at": order.payment_confirmed_at.isoformat() if order.payment_confirmed_at else None,
        "subtotal": order.subtotal_cents / 100,
        "delivery_fee": order.delivery_fee_cents / 100,
        "total": order.total_cents / 100,
        "customer_telegram_id": customer.telegram_id if customer else None,
        "customer_phone": customer.phone if customer else None,
        "delivery_address": order.delivery_address_text
    }

@router.get("/payments/btc-all")
async def get_all_btc_payments(
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Get all BTC payments"""
    from .payment_service import get_payment_service
    
    payment_service = get_payment_service(db)
    payments = payment_service.get_all_btc_payments()
    
    return payments

@router.get("/payments/check-btc/{order_number}")
async def check_btc_payment_status(
    order_number: str,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Check BTC payment status for an order"""
    from .payment_service import get_payment_service
    
    payment_service = get_payment_service(db)
    status = payment_service.check_btc_payment_status(order_number)
    
    return status

@router.post("/payments/generate-btc/{order_number}")
async def generate_btc_payment(
    order_number: str,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Generate BTC payment details for an order"""
    from .payment_service import get_payment_service
    
    order = db.query(models.Order).filter(models.Order.order_number == order_number).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    payment_service = get_payment_service(db)
    payment_details = payment_service.generate_btc_payment(order_number, order.total_cents)
    
    return payment_details

@router.get("/pickup-addresses")
async def get_pickup_addresses(
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Get all pickup addresses"""
    pickup_addresses = db.query(models.PickupAddress).filter(
        models.PickupAddress.active == True
    ).order_by(models.PickupAddress.name).all()
    
    return [
        {
            "id": addr.id,
            "name": addr.name,
            "address": addr.address,
            "instructions": addr.instructions,
            "active": addr.active,
            "created_at": addr.created_at.isoformat() if addr.created_at else None
        }
        for addr in pickup_addresses
    ]

@router.post("/pickup-addresses")
async def create_pickup_address(
    address_data: dict,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Create a new pickup address"""
    required_fields = ['name', 'address']
    for field in required_fields:
        if field not in address_data:
            raise HTTPException(status_code=400, detail=f"Missing required field: {field}")
    
    pickup_address = models.PickupAddress(
        name=address_data['name'],
        address=address_data['address'],
        instructions=address_data.get('instructions'),
        active=address_data.get('active', True)
    )
    
    db.add(pickup_address)
    db.commit()
    db.refresh(pickup_address)
    
    return {
        "id": pickup_address.id,
        "message": "Pickup address created successfully"
    }

@router.put("/pickup-addresses/{address_id}")
async def update_pickup_address(
    address_id: int,
    address_data: dict,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Update a pickup address"""
    pickup_address = db.query(models.PickupAddress).filter(
        models.PickupAddress.id == address_id
    ).first()
    
    if not pickup_address:
        raise HTTPException(status_code=404, detail="Pickup address not found")
    
    updatable_fields = ['name', 'address', 'instructions', 'active']
    for field in updatable_fields:
        if field in address_data:
            setattr(pickup_address, field, address_data[field])
    
    db.commit()
    
    return {"message": "Pickup address updated successfully"}

@router.delete("/pickup-addresses/{address_id}")
async def delete_pickup_address(
    address_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Soft delete a pickup address"""
    pickup_address = db.query(models.PickupAddress).filter(
        models.PickupAddress.id == address_id
    ).first()
    
    if not pickup_address:
        raise HTTPException(status_code=404, detail="Pickup address not found")
    
    pickup_address.active = False
    db.commit()
    
    return {"message": "Pickup address deleted successfully"}

@router.put("/orders/{order_number}/delivery-slot")
async def update_order_delivery_slot(
    order_number: str,
    slot_data: dict,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Update order delivery/pickup slot"""
    order = db.query(models.Order).filter(models.Order.order_number == order_number).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    new_slot = slot_data.get('delivery_slot_et')
    if not new_slot:
        raise HTTPException(status_code=400, detail="Delivery slot is required")
    
    try:
        # Parse the datetime string
        from datetime import datetime
        delivery_slot = datetime.fromisoformat(new_slot.replace('Z', '+00:00'))
        order.delivery_slot_et = delivery_slot
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid datetime format: {str(e)}")
    
    # Create order event
    event = models.OrderEvent(
        order_id=order.id,
        type="delivery_slot_updated",
        payload={
            "previous_slot": order.delivery_slot_et.isoformat() if order.delivery_slot_et else None,
            "new_slot": new_slot,
            "updated_by": "admin"
        }
    )
    db.add(event)
    
    db.commit()
    
    # Send notification to customer if slot is changed significantly
    customer = db.query(models.Customer).filter(models.Customer.id == order.customer_id).first()
    if customer and customer.telegram_id:
        from .telegram_service import telegram_service
        telegram_service.send_message(
            customer.telegram_id,
            f"🕒 <b>Delivery Time Updated</b>\n\n"
            f"Your {order.delivery_or_pickup} time for order #{order_number} has been updated.\n"
            f"New time: {delivery_slot.strftime('%Y-%m-%d %H:%M')}\n\n"
            f"Thank you for your understanding!"
        )
    
    return {
        "message": "Delivery slot updated successfully",
        "order_number": order_number,
        "new_slot": new_slot,
        "notification_sent": customer and customer.telegram_id is not None
    }

@router.put("/orders/{order_number}/pickup-address")
async def update_order_pickup_address(
    order_number: str,
    address_data: dict,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Update order pickup address"""
    order = db.query(models.Order).filter(models.Order.order_number == order_number).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    if order.delivery_or_pickup != 'pickup':
        raise HTTPException(status_code=400, detail="Order is not a pickup order")
    
    new_address = address_data.get('pickup_address_text')
    if not new_address:
        raise HTTPException(status_code=400, detail="Pickup address is required")
    
    old_address = order.pickup_address_text
    order.pickup_address_text = new_address
    
    # Create order event
    event = models.OrderEvent(
        order_id=order.id,
        type="pickup_address_updated",
        payload={
            "previous_address": old_address,
            "new_address": new_address,
            "updated_by": "admin"
        }
    )
    db.add(event)
    
    db.commit()
    
    # Send notification to customer
    customer = db.query(models.Customer).filter(models.Customer.id == order.customer_id).first()
    if customer and customer.telegram_id:
        from .telegram_service import telegram_service
        telegram_service.send_message(
            customer.telegram_id,
            f"📍 <b>Pickup Location Updated</b>\n\n"
            f"Your pickup location for order #{order_number} has been updated.\n"
            f"New location: {new_address}\n\n"
            f"Please make note of this change!"
        )
    
    return {
        "message": "Pickup address updated successfully",
        "order_number": order_number,
        "new_address": new_address,
        "notification_sent": customer and customer.telegram_id is not None
    }

@router.get("/customers/{customer_id}")
async def get_customer_details(
    customer_id: int, 
    db: Session = Depends(get_db), 
    admin: str = Depends(get_current_admin)
):
    """Get detailed customer information"""
    customer = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    
    # Get customer's addresses
    addresses = db.query(models.CustomerAddress).filter(
        models.CustomerAddress.customer_id == customer_id
    ).order_by(
        models.CustomerAddress.is_default.desc(),
        models.CustomerAddress.created_at.desc()
    ).all()
    
    # Get customer's order statistics
    total_orders = db.query(models.Order).filter(
        models.Order.customer_id == customer_id
    ).count()
    
    total_spent_result = db.query(func.sum(models.Order.total_cents)).filter(
        models.Order.customer_id == customer_id,
        models.Order.payment_status.in_(['paid_0conf', 'paid_confirmed'])
    ).scalar() or 0
    
    recent_orders = db.query(models.Order).filter(
        models.Order.customer_id == customer_id
    ).order_by(models.Order.created_at.desc()).limit(5).all()
    
    return {
        "customer": {
            "id": customer.id,
            "telegram_id": customer.telegram_id,
            "phone": customer.phone,
            "verified": customer.verified_bool,
            "created_at": customer.created_at.isoformat(),
            "default_address_id": customer.default_address_id
        },
        "statistics": {
            "total_orders": total_orders,
            "total_spent": total_spent_result / 100,
            "average_order_value": (total_spent_result / total_orders / 100) if total_orders > 0 else 0
        },
        "addresses": [
            {
                "id": addr.id,
                "label": addr.label,
                "address_text": addr.address_text,
                "is_default": addr.is_default,
                "created_at": addr.created_at.isoformat(),
                "updated_at": addr.updated_at.isoformat() if addr.updated_at else None
            }
            for addr in addresses
        ],
        "recent_orders": [
            {
                "order_number": order.order_number,
                "status": order.status,
                "payment_status": order.payment_status,
                "total": order.total_cents / 100,
                "delivery_type": order.delivery_or_pickup,
                "created_at": order.created_at.isoformat()
            }
            for order in recent_orders
        ]
    }

@router.get("/payments")
async def get_payments_list(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    payment_type: Optional[str] = Query(None),
    payment_status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Get list of payments with filters"""
    query = db.query(models.Order).filter(
        models.Order.payment_status.in_(['paid_0conf', 'paid_confirmed', 'pending_btc', 'pending'])
    )
    
    if payment_type:
        query = query.filter(models.Order.payment_type == payment_type)
    
    if payment_status:
        query = query.filter(models.Order.payment_status == payment_status)
    
    payments = query.order_by(models.Order.created_at.desc()).offset(skip).limit(limit).all()
    
    payment_data = []
    for order in payments:
        customer = db.query(models.Customer).filter(models.Customer.id == order.customer_id).first()
        driver = db.query(models.Driver).filter(models.Driver.id == order.driver_id).first() if order.driver_id else None
        
        payment_data.append({
            "order_number": order.order_number,
            "customer_telegram_id": customer.telegram_id if customer else None,
            "customer_phone": customer.phone if customer else None,
            "driver_name": driver.name if driver else None,
            "payment_type": order.payment_type,
            "payment_status": order.payment_status,
            "payment_confirmed": order.payment_confirmed,
            "payment_confirmed_by": order.payment_confirmed_by,
            "payment_confirmed_at": order.payment_confirmed_at.isoformat() if order.payment_confirmed_at else None,
            "subtotal": order.subtotal_cents / 100,
            "delivery_fee": order.delivery_fee_cents / 100,
            "total": order.total_cents / 100,
            "delivery_type": order.delivery_or_pickup,
            "created_at": order.created_at.isoformat(),
            "payment_metadata": order.payment_metadata
        })
    
    # Get summary statistics
    total_query = db.query(
        func.count(models.Order.id).label('total_count'),
        func.sum(models.Order.total_cents).label('total_amount')
    ).filter(
        models.Order.payment_status.in_(['paid_0conf', 'paid_confirmed', 'pending_btc', 'pending'])
    )
    
    if payment_type:
        total_query = total_query.filter(models.Order.payment_type == payment_type)
    
    if payment_status:
        total_query = total_query.filter(models.Order.payment_status == payment_status)
    
    total_result = total_query.first()
    
    return {
        "payments": payment_data,
        "pagination": {
            "skip": skip,
            "limit": limit,
            "total": total_result[0] if total_result else 0
        },
        "summary": {
            "total_amount": (total_result[1] or 0) / 100,
            "total_count": total_result[0] or 0
        }
    }

@router.get("/contact")
async def get_contact_info(db: Session = Depends(get_db), admin: str = Depends(get_current_admin)):
    """Get contact information and welcome message from database"""
    try:
        # Get contact settings from database
        contact_settings = db.query(models.ContactSettings).first()
        
        if not contact_settings:
            # Create default settings if they don't exist
            contact_settings = models.ContactSettings(
                welcome_message="Welcome to our delivery service! 🚀\n\nWe're happy to serve you. Use the menu below to browse our offerings and place your order.",
                telegram_id=None,
                telegram_username="",
                phone_number="",
                email_address="contact@yourstore.com",
                additional_info="We're available 24/7 for your delivery needs!"
            )
            db.add(contact_settings)
            db.commit()
            db.refresh(contact_settings)
            logger.info("Created default contact settings")
        
        # Get admin customer ID for updated_by reference
        admin_customer = db.query(models.Customer).filter(
            models.Customer.telegram_id == 0  # Assuming admin has a special Telegram ID
        ).first()
        
        return {
            "welcome_message": contact_settings.welcome_message,
            "telegram_id": contact_settings.telegram_id,
            "telegram_username": contact_settings.telegram_username or "",
            "phone_number": contact_settings.phone_number or "",
            "email_address": contact_settings.email_address or "",
            "additional_info": contact_settings.additional_info or "",
            "last_updated": contact_settings.updated_at.isoformat() if contact_settings.updated_at else None,
            "updated_by": contact_settings.updated_by
        }
        
    except Exception as e:
        logger.error(f"Error getting contact info: {e}")
        # Return safe defaults in case of error
        return {
            "welcome_message": "Welcome to our delivery service! 🚀\n\nWe're happy to serve you. Use the menu below to browse our offerings and place your order.",
            "telegram_id": None,
            "telegram_username": "",
            "phone_number": "",
            "email_address": "contact@yourstore.com",
            "additional_info": "We're available 24/7 for your delivery needs!",
            "last_updated": None,
            "updated_by": None
        }

@router.post("/contact/welcome-message")
async def update_welcome_message(
    welcome_data: dict,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Update welcome message in database"""
    try:
        welcome_message = welcome_data.get('welcome_message', '').strip()
        
        if not welcome_message:
            raise HTTPException(status_code=400, detail="Welcome message cannot be empty")
        
        if len(welcome_message) > 4000:
            raise HTTPException(status_code=400, detail="Welcome message is too long (max 4000 characters)")
        
        # Get or create contact settings
        contact_settings = db.query(models.ContactSettings).first()
        if not contact_settings:
            contact_settings = models.ContactSettings()
            db.add(contact_settings)
        
        # Get admin customer for updated_by reference
        admin_customer = db.query(models.Customer).filter(
            models.Customer.telegram_id == 0  # Admin user
        ).first()
        
        if admin_customer:
            contact_settings.updated_by = admin_customer.id
        
        # Update welcome message
        contact_settings.welcome_message = welcome_message
        contact_settings.updated_at = datetime.now()
        
        db.commit()
        
        logger.info(f"Welcome message updated by admin {admin}")
        
        return {
            "message": "Welcome message updated successfully",
            "welcome_message": welcome_message,
            "updated_at": contact_settings.updated_at.isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating welcome message: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update welcome message")

@router.get("/settings/btc-discount")
async def get_btc_discount(
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Get BTC discount settings"""
    settings = db.query(models.Settings).first()
    if not settings:
        settings = models.Settings(btc_discount_percent=0)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    
    return {
        "btc_discount_percent": settings.btc_discount_percent,
        "updated_at": settings.updated_at.isoformat() if settings.updated_at else None
    }

@router.put("/settings/btc-discount")
async def update_btc_discount(
    discount_data: dict,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Update BTC discount settings"""
    discount_percent = discount_data.get('btc_discount_percent')
    if discount_percent is None:
        raise HTTPException(status_code=400, detail="BTC discount percentage is required")
    
    if not isinstance(discount_percent, int) or discount_percent < 0 or discount_percent > 100:
        raise HTTPException(status_code=400, detail="BTC discount must be a number between 0 and 100")
    
    settings = db.query(models.Settings).first()
    if not settings:
        settings = models.Settings()
        db.add(settings)
    
    settings.btc_discount_percent = discount_percent
    settings.updated_at = datetime.now()
    
    db.commit()
    db.refresh(settings)
    
    return {
        "message": "BTC discount updated successfully",
        "btc_discount_percent": settings.btc_discount_percent,
        "updated_at": settings.updated_at.isoformat()
    }

@router.post("/contact/info")
async def update_contact_info(
    contact_data: dict,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin)
):
    """Update contact information in database"""
    try:
        # Validate contact data
        telegram_id = contact_data.get('telegram_id')
        telegram_username = contact_data.get('telegram_username', '').strip()
        phone_number = contact_data.get('phone_number', '').strip()
        email_address = contact_data.get('email_address', '').strip()
        additional_info = contact_data.get('additional_info', '').strip()
        
        # Validate at least one contact method is provided
        if not any([telegram_id, telegram_username, phone_number, email_address]):
            raise HTTPException(
                status_code=400, 
                detail="At least one contact method (Telegram ID, Telegram username, phone number, or email) is required"
            )
        
        # Validate email format if provided
        if email_address and '@' not in email_address:
            raise HTTPException(status_code=400, detail="Invalid email address format")
        
        # Validate phone number format if provided (basic validation)
        if phone_number and len(phone_number) < 10:
            raise HTTPException(status_code=400, detail="Phone number seems too short")
        
        # Clean telegram username (remove @ if present at start)
        if telegram_username and telegram_username.startswith('@'):
            telegram_username = telegram_username[1:]
        
        # Validate telegram username format
        if telegram_username and not re.match(r'^[a-zA-Z0-9_]{5,32}$', telegram_username):
            raise HTTPException(
                status_code=400, 
                detail="Telegram username must be 5-32 characters long and contain only letters, numbers, and underscores"
            )
        
        # Get or create contact settings
        contact_settings = db.query(models.ContactSettings).first()
        if not contact_settings:
            contact_settings = models.ContactSettings()
            db.add(contact_settings)
        
        # Get admin customer for updated_by reference
        admin_customer = db.query(models.Customer).filter(
            models.Customer.telegram_id == 0  # Admin user
        ).first()
        
        if admin_customer:
            contact_settings.updated_by = admin_customer.id
        
        # Update contact information
        contact_settings.telegram_id = telegram_id
        contact_settings.telegram_username = telegram_username
        contact_settings.phone_number = phone_number
        contact_settings.email_address = email_address
        contact_settings.additional_info = additional_info
        contact_settings.updated_at = datetime.now()
        
        db.commit()
        db.refresh(contact_settings)
        
        logger.info(f"Contact information updated by admin {admin}")
        
        return {
            "message": "Contact information updated successfully",
            "contact_info": {
                "telegram_id": telegram_id,
                "telegram_username": telegram_username,
                "phone_number": phone_number,
                "email_address": email_address,
                "additional_info": additional_info
            },
            "updated_at": contact_settings.updated_at.isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating contact info: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update contact information")
