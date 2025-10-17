from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import text
import os
from datetime import datetime

from .database import SessionLocal, engine, Base, get_db
from . import models, crud, schemas
from .inventory_service import get_inventory_service
from dotenv import load_dotenv
import logging

logger = logging.getLogger(__name__)
load_dotenv()

app = FastAPI(title="Delivery Bot API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "static/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Try to create tables on startup
try:
    Base.metadata.create_all(bind=engine)
    print("✅ Database tables verified/created")
except Exception as e:
    print(f"⚠️ Database setup warning: {e}")

# Include routers
try:
    from .webhooks import router as webhook_router
    from .admin import router as admin_router
    app.include_router(webhook_router, prefix="/webhook", tags=["webhooks"])
    app.include_router(admin_router, prefix="/admin", tags=["admin"])
    app.mount("/admin", StaticFiles(directory="static/admin", html=True), name="admin")
    app.mount("/static", StaticFiles(directory="static"), name="static")
    print("✅ Routers loaded successfully")
except ImportError as e:
    print(f"⚠️ Router import warning: {e}")

@app.get("/")
async def root():
    return {"message": "Delivery Bot API"}

@app.get("/health")
async def health_check(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        
        # Try to check if menu_items table exists
        try:
            menu_count = db.query(models.MenuItem).count()
            return {
                "status": "healthy", 
                "database": "connected",
                "menu_items": menu_count,
                "timestamp": datetime.now().isoformat()
            }
        except:
            return {
                "status": "degraded", 
                "database": "connected but tables not ready",
                "timestamp": datetime.now().isoformat()
            }
            
    except Exception as e:
        return {
            "status": "degraded", 
            "database": "disconnected",
            "error": str(e)
        }

@app.get("/menu")
async def get_menu(db: Session = Depends(get_db)):
    """Get all active menu items"""
    try:
        menu_items = crud.get_active_menu_items(db)
        return [
            {
                "id": item.id,
                "name": item.name,
                "category": item.category,
                "description": item.description,
                "price_cents": item.price_cents,
                "photo_url": item.photo_url,
                "stock": item.stock
            }
            for item in menu_items
        ]
    except Exception as e:
        # Return sample menu if database is not ready
        print(f"⚠️ Database error, returning sample menu: {e}")
        return [
            {
                "id": 1,
                "name": "Margherita Pizza",
                "category": "Pizza",
                "description": "Classic tomato sauce and mozzarella",
                "price_cents": 2500,
                "stock": 100
            },
            {
                "id": 2,
                "name": "Pepperoni Pizza",
                "category": "Pizza",
                "description": "Pepperoni and cheese",
                "price_cents": 2800,
                "stock": 100
            },
            {
                "id": 3,
                "name": "French Fries",
                "category": "Sides",
                "description": "Crispy golden fries",
                "price_cents": 800,
                "stock": 200
            }
        ]

# Update the create_order endpoint to include inventory validation
@app.post("/order")
async def create_order(order_data: dict, db: Session = Depends(get_db)):
    """Create a new order with pre-calculated delivery fee"""
    try:
        # Check if this is just a fee calculation request
        if order_data.get('calculate_delivery_fee_only'):
            return await calculate_delivery_fee(order_data, db)
        
        # Validate required fields
        required_fields = ['customer_id', 'items', 'subtotal_cents', 'delivery_or_pickup', 'payment_type', 'total_cents']
        for field in required_fields:
            if field not in order_data:
                raise HTTPException(status_code=400, detail=f"Missing required field: {field}")
        
        # Use pre-calculated delivery fee from client
        delivery_fee_cents = order_data.get('delivery_fee_cents', 0)
        total_cents = order_data['total_cents']
        logger.info(f"delivery fee sents: {delivery_fee_cents}")
        # Apply BTC discount if applicable
        if order_data.get('payment_type') == 'btc':
            # Get BTC discount from settings
            settings = db.query(models.Settings).first()
            if settings and settings.btc_discount_percent > 0:
                # Calculate discount amount
                discount_percent = settings.btc_discount_percent
                subtotal_with_delivery = order_data['subtotal_cents'] + delivery_fee_cents
                discount_amount = int(subtotal_with_delivery * discount_percent / 100)
                logger.info(f"discount amount {discount_amount}")
                # Apply discount to total
                total_cents = subtotal_with_delivery - discount_amount
                logger.info(f"total cents: {total_cents}")
                # Store original and discounted amounts
                order_data['original_total_cents'] = subtotal_with_delivery
                order_data['btc_discount_percent'] = discount_percent
                order_data['btc_discount_amount_cents'] = discount_amount
            else:
                # No discount applied
                total_cents = order_data['subtotal_cents'] + delivery_fee_cents
        else:
            # Regular payment - verify the total matches subtotal + delivery fee
            expected_total = order_data['subtotal_cents'] + delivery_fee_cents
            if total_cents != expected_total:
                logger.warning(f"Total mismatch: expected {expected_total}, got {total_cents}")
                # Use the calculated total for consistency
                total_cents = expected_total
        
        # Check inventory availability
        inventory_service = get_inventory_service(db)
        for item in order_data['items']:
            menu_item_id = item['menu_id']
            quantity = item['quantity']
            
            available = inventory_service.get_storefront_availability(menu_item_id)
            if available < quantity:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Item {item.get('name', menu_item_id)} is out of stock. Available: {available}"
                )
        
        telegram_id = order_data["customer_id"]
        customer = db.query(models.Customer).filter(models.Customer.telegram_id == telegram_id).first()

        if not customer:
            customer = models.Customer(
                telegram_id=telegram_id,
                phone=order_data.get('phone', '')
            )
            db.add(customer)
            db.commit()
            db.refresh(customer)

        # Prepare payment metadata
        payment_metadata = {}
        if order_data.get('payment_type') == 'btc':
            payment_metadata = {
                'original_total_cents': order_data.get('original_total_cents'),
                'btc_discount_percent': order_data.get('btc_discount_percent'),
                'btc_discount_amount_cents': order_data.get('btc_discount_amount_cents')
            }

        # Create order using CRUD function
        order_create = schemas.OrderCreate(
            customer_id=customer.id,
            items=order_data['items'],
            subtotal_cents=order_data['subtotal_cents'],
            delivery_fee_cents=delivery_fee_cents,
            total_cents=total_cents,
            delivery_or_pickup=order_data['delivery_or_pickup'],
            pickup_address_text=order_data.get('pickup_address_text'),
            delivery_address_id=order_data.get('delivery_address_id'),
            delivery_address_text=order_data.get('delivery_address_text'),
            notes=order_data.get('notes'),
            payment_type=order_data['payment_type'],
            delivery_slot_et=order_data.get('delivery_slot_et'),
            payment_metadata=payment_metadata
        )
        order = crud.create_order(db, order_create)
        
        # Create inventory reservations
        try:
            inventory_service.create_reservations(order.id, order_data['items'])
        except Exception as e:
            # If reservation fails, delete the order
            db.delete(order)
            db.commit()
            raise HTTPException(status_code=400, detail=f"Inventory reservation failed: {str(e)}")
        
        # Generate payment URL for BTC orders
        payment_url = None
        needs_confirmation = False
        if order_data['payment_type'] == 'btc':
            from .payment_service import get_payment_service
            payment_service = get_payment_service(db)
            
            try:
                payment_details = payment_service.generate_btc_payment(order.order_number, total_cents)
                payment_url = payment_details['payment_url']
                needs_confirmation = True
            except Exception as e:
                logger.error(f"Error generating BTC payment: {e}")
                # Still create order but mark as payment failed
                payment_url = None
                needs_confirmation = False
                order.payment_status = 'payment_failed'
        
        return {
            "order_number": order.order_number,
            "status": "created",
            "customer_id": order.customer_id,
            "subtotal": order.subtotal_cents / 100,
            "delivery_fee": order.delivery_fee_cents / 100,
            "total": order.total_cents / 100,
            "payment_url": payment_url,
            "needs_confirmation": needs_confirmation
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/orders/{order_number}")
async def get_order(order_number: str, db: Session = Depends(get_db)):
    """Get order by order number"""
    order = crud.get_order_by_number(db, order_number)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    return {
        "order_number": order.order_number,
        "status": order.status,
        "payment_status": order.payment_status,
        "total": order.subtotal_cents / 100,
        "created_at": order.created_at.isoformat()
    }

@app.post("/customers")
async def create_customer(customer_data: dict, db: Session = Depends(get_db)):
    """Create or update customer"""
    try:
        customer = crud.get_customer_by_telegram_id(db, customer_data['telegram_id'])
        if customer:
            # Update existing customer
            if 'phone' in customer_data:
                customer.phone = customer_data['phone']
            db.commit()
            return {"id": customer.id, "action": "updated"}
        else:
            # Create new customer
            customer_create = schemas.CustomerCreate(
                telegram_id=customer_data['telegram_id'],
                phone=customer_data.get('phone')
            )
            customer = crud.create_customer(db, customer_create)
            return {"id": customer.id, "action": "created"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/customers/telegram/{telegram_id}")
async def get_customer_by_telegram(telegram_id: int, db: Session = Depends(get_db)):
    """Get customer by Telegram ID"""
    customer = crud.get_customer_by_telegram_id(db, telegram_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    
    return {
        "id": customer.id,
        "telegram_id": customer.telegram_id,
        "phone": customer.phone,
        "created_at": customer.created_at.isoformat()
    }

# Add endpoint to get menu with availability
@app.get("/menu-with-availability")
async def get_menu_with_availability(db: Session = Depends(get_db)):
    """Get menu with real-time availability information"""
    try:
        menu_items = crud.get_active_menu_items(db)
        inventory_service = get_inventory_service(db)
        
        menu_with_availability = []
        for item in menu_items:
            available_qty = inventory_service.get_storefront_availability(item.id)
            
            status = "in_stock"
            if available_qty == 0:
                status = "out_of_stock"
            elif available_qty <= 5:  # LOW_STOCK_THRESHOLD
                status = "low_stock"
            
            menu_with_availability.append({
                "id": item.id,
                "name": item.name,
                "category": item.category,
                "description": item.description,
                "price_cents": item.price_cents,
                "photo_url": item.photo_url,
                "stock": item.stock,
                "available_qty": available_qty,
                "status": status
            })
        
        return menu_with_availability
        
    except Exception as e:
        # Return sample data if database error
        print(f"⚠️ Database error, returning sample menu: {e}")
        return [
            {
                "id": 1,
                "name": "Margherita Pizza",
                "category": "Pizza",
                "description": "Classic tomato sauce and mozzarella",
                "price_cents": 2500,
                "stock": 100,
                "available_qty": 10,
                "status": "in_stock"
            }
        ]

@app.post("/inventory/check-availability")
async def check_inventory_availability(items_data: dict, db: Session = Depends(get_db)):
    """Check if items are available in inventory"""
    try:
        from .inventory_service import get_inventory_service
        
        inventory_service = get_inventory_service(db)
        unavailable_items = []
        
        for item in items_data.get('items', []):
            menu_item_id = item['menu_id']
            quantity = item.get('quantity', 1)
            
            available_qty = inventory_service.get_storefront_availability(menu_item_id)
            if available_qty < quantity:
                # Get menu item details
                menu_item = db.query(models.MenuItem).filter(models.MenuItem.id == menu_item_id).first()
                unavailable_items.append({
                    'menu_id': menu_item_id,
                    'name': menu_item.name if menu_item else f"Item {menu_item_id}",
                    'requested_qty': quantity,
                    'available_qty': available_qty
                })
        
        return {
            "available": len(unavailable_items) == 0,
            "unavailable_items": unavailable_items
        }
        
    except Exception as e:
        logger.error(f"Error checking inventory availability: {e}")
        # Return available on error to not block orders
        return {"available": True, "unavailable_items": []}

@app.post("/customer/address")
async def save_customer_address(address_data: dict, db: Session = Depends(get_db)):
    """Save customer address"""
    try:
        telegram_id = address_data.get('telegram_id')
        address_text = address_data.get('address_text')
        label = address_data.get('label', 'Home')
        is_default = address_data.get('is_default', True)
        
        if not telegram_id or not address_text:
            raise HTTPException(status_code=400, detail="Telegram ID and address text are required")
        
        # Find or create customer
        customer = db.query(models.Customer).filter(models.Customer.telegram_id == telegram_id).first()
        if not customer:
            customer = models.Customer(telegram_id=telegram_id)
            db.add(customer)
            db.commit()
            db.refresh(customer)
        
        # If setting as default, remove default from other addresses
        if is_default:
            db.query(models.CustomerAddress).filter(
                models.CustomerAddress.customer_id == customer.id,
                models.CustomerAddress.is_default == True
            ).update({"is_default": False})
        
        # Create address
        address = models.CustomerAddress(
            customer_id=customer.id,
            label=label,
            address_text=address_text,
            is_default=is_default
        )
        db.add(address)
        db.commit()
        db.refresh(address)
        
        return {
            "message": "Address saved successfully", 
            "address_id": address.id,
            "label": address.label,
            "address_text": address.address_text,
            "is_default": address.is_default
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error saving customer address: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/customer/{telegram_id}/addresses")
async def get_customer_addresses(telegram_id: int, db: Session = Depends(get_db)):
    """Get all addresses for a customer by Telegram ID"""
    try:
        customer = db.query(models.Customer).filter(models.Customer.telegram_id == telegram_id).first()
        if not customer:
            return []
        
        addresses = db.query(models.CustomerAddress).filter(
            models.CustomerAddress.customer_id == customer.id
        ).order_by(
            models.CustomerAddress.is_default.desc(),
            models.CustomerAddress.created_at.desc()
        ).all()
        
        return [
            {
                "id": addr.id,
                "label": addr.label,
                "address_text": addr.address_text,
                "is_default": addr.is_default,
                "created_at": addr.created_at.isoformat() if addr.created_at else None
            }
            for addr in addresses
        ]
        
    except Exception as e:
        logger.error(f"Error getting customer addresses: {e}")
        return []

@app.put("/customer/{telegram_id}/address/{address_id}/default")
async def set_default_address(
    telegram_id: int, 
    address_id: int, 
    db: Session = Depends(get_db)
):
    """Set an address as default for customer"""
    try:
        customer = db.query(models.Customer).filter(models.Customer.telegram_id == telegram_id).first()
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found")
        
        # Verify address belongs to customer
        address = db.query(models.CustomerAddress).filter(
            models.CustomerAddress.id == address_id,
            models.CustomerAddress.customer_id == customer.id
        ).first()
        
        if not address:
            raise HTTPException(status_code=404, detail="Address not found")
        
        # Remove default from all other addresses
        db.query(models.CustomerAddress).filter(
            models.CustomerAddress.customer_id == customer.id,
            models.CustomerAddress.is_default == True
        ).update({"is_default": False})
        
        # Set this address as default
        address.is_default = True
        db.commit()
        
        return {"message": "Default address set successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error setting default address: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/customer/address/{address_id}")
async def delete_customer_address(address_id: int, db: Session = Depends(get_db)):
    """Delete customer address"""
    try:
        address = db.query(models.CustomerAddress).filter(models.CustomerAddress.id == address_id).first()
        if not address:
            raise HTTPException(status_code=404, detail="Address not found")
        
        # Check if this is the default address
        was_default = address.is_default
        
        db.delete(address)
        db.commit()
        
        # If we deleted the default address, set a new default
        if was_default:
            new_default = db.query(models.CustomerAddress).filter(
                models.CustomerAddress.customer_id == address.customer_id
            ).first()
            
            if new_default:
                new_default.is_default = True
                db.commit()
        
        return {"message": "Address deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting customer address: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/calculate-delivery-fee")
async def calculate_delivery_fee(order_data: dict, db: Session = Depends(get_db)):
    """Calculate delivery fee without creating an order"""
    try:
        delivery_type = order_data.get('delivery_or_pickup', 'delivery')
        delivery_fee_cents = 0
        delivery_zone = 'Pickup'
        
        if delivery_type == 'delivery':
            delivery_address_text = order_data.get('delivery_address_text')
            delivery_address_id = order_data.get('delivery_address_id')
            
            if not delivery_address_text and delivery_address_id:
                # Get address text from address ID
                address = db.query(models.CustomerAddress).filter(
                    models.CustomerAddress.id == delivery_address_id
                ).first()
                if address:
                    delivery_address_text = address.address_text
            
            if delivery_address_text:
                from .delivery_service import get_delivery_service
                delivery_service = get_delivery_service(db)
                delivery_fee_cents, delivery_zone = delivery_service.calculate_delivery_fee(delivery_address_text)
                logger.info(f"Delivery fee calculated: ${delivery_fee_cents/100} for zone: {delivery_zone}")
            else:
                raise HTTPException(status_code=400, detail="Delivery address required for fee calculation")
        
        return {
            "delivery_fee_cents": delivery_fee_cents,
            "delivery_zone": delivery_zone,
            "delivery_type": delivery_type
        }
        
    except Exception as e:
        logger.error(f"Error calculating delivery fee: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/customer/pickup-addresses")
async def get_customer_addresses(db: Session = Depends(get_db)):
    """Get all addresses for a customer by Telegram ID"""
    try:
        pickup_addresses = db.query(models.PickupAddress).filter(models.PickupAddress.active == True).all()
        
        return [
            {
                "id": addr.id,
                "name": addr.name,
                "address": addr.address,
                "created_at": addr.created_at.isoformat() if addr.created_at else None
            }
            for addr in pickup_addresses
        ]
        
    except Exception as e:
        logger.error(f"Error getting pickup addresses: {e}")
        return []

@app.get("/customer/contact")
async def get_contact_info(db: Session = Depends(get_db)):
    """Get contact information and welcome message from database"""
    try:
        # Get contact settings from database
        contact_settings = db.query(models.ContactSettings).first()
        if not contact_settings:
            raise HTTPException(status_code=404, detail="Contact settings not found")
        
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
            "welcome_message": "Welcome to our delivery service!",
            "telegram_id": None,
            "telegram_username": "",
            "phone_number": "",
            "email_address": "contact@yourstore.com",
            "additional_info": "We're available 24/7 for your delivery needs!",
            "last_updated": None,
            "updated_by": None
        }

@app.get("/customer/btc-discount")
async def get_btc_discount(
    db: Session = Depends(get_db),
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

@app.on_event("startup")
async def startup_event():
    """Check required environment variables on startup"""
    required_vars = ['TELEGRAM_BOT_TOKEN', 'DATABASE_URL']
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    
    if missing_vars:
        print(f"❌ WARNING: Missing environment variables: {', '.join(missing_vars)}")
        print("   Telegram notifications will not work without TELEGRAM_BOT_TOKEN")
    else:
        print("✅ All required environment variables are set")
        
        # Test Telegram connection
        from .telegram_service import telegram_service
        print("🤖 Telegram bot token is configured")
        
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)