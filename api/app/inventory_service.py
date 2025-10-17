# [file name]: inventory_service.py
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import logging
from . import models

logger = logging.getLogger(__name__)

class InventoryService:
    def __init__(self, db: Session):
        self.db = db
    
    def get_storefront_availability(self, menu_item_id: int) -> int:
        """Calculate available quantity for storefront display"""
        # Total stock across all active drivers
        total_on_hand = self.db.query(func.sum(models.DriverStock.on_hand_qty)).filter(
            models.DriverStock.menu_item_id == menu_item_id,
            models.DriverStock.on_hand_qty > 0
        ).join(models.Driver).filter(models.Driver.active == True).scalar() or 0
        
        # Subtract active reservations
        active_reservations = self.db.query(func.sum(models.InventoryReservation.reserved_qty)).filter(
            models.InventoryReservation.menu_item_id == menu_item_id,
            models.InventoryReservation.status == 'active'
        ).scalar() or 0
        
        available = total_on_hand - active_reservations
        return max(0, available)
    
    def get_driver_stock(self, driver_id: int, menu_item_id: int) -> Optional[models.DriverStock]:
        """Get driver's stock for a specific menu item"""
        return self.db.query(models.DriverStock).filter(
            models.DriverStock.driver_id == driver_id,
            models.DriverStock.menu_item_id == menu_item_id
        ).first()
    
    def update_driver_stock(self, driver_id: int, menu_item_id: int, qty_change: int, 
                          event_type: str, reason_note: str = None, order_id: int = None):
        """Update driver stock and create audit event"""
        # Get or create driver stock record
        driver_stock = self.get_driver_stock(driver_id, menu_item_id)
        
        if not driver_stock:
            driver_stock = models.DriverStock(
                driver_id=driver_id,
                menu_item_id=menu_item_id,
                on_hand_qty=0
            )
            self.db.add(driver_stock)
        
        # Update quantity
        driver_stock.on_hand_qty += qty_change
        driver_stock.on_hand_qty = max(0, driver_stock.on_hand_qty)  # Prevent negative
        
        # Create audit event
        event = models.DriverStockEvent(
            driver_id=driver_id,
            menu_item_id=menu_item_id,
            qty_change=qty_change,
            event_type=event_type,
            reason_note=reason_note,
            order_id=order_id
        )
        self.db.add(event)
        
        self.db.commit()
        logger.info(f"Driver {driver_id} stock updated: {menu_item_id} {qty_change:+} ({event_type})")
        return driver_stock
    
    def loadout_to_driver(self, driver_id: int, menu_item_id: int, quantity: int, reason_note: str = None):
        """Load stock to driver"""
        if quantity <= 0:
            raise ValueError("Loadout quantity must be positive")
        
        return self.update_driver_stock(
            driver_id, menu_item_id, quantity, 'loadout', reason_note
        )
    
    def create_reservations(self, order_id: int, items: List[Dict]) -> bool:
        """Create reservations for order items"""
        order = self.db.query(models.Order).filter(models.Order.id == order_id).first()
        if not order:
            raise ValueError(f"Order {order_id} not found")
        
        # Check availability for all items first
        for item in items:
            menu_item_id = item['menu_id']
            quantity = item['quantity']
            
            available = self.get_storefront_availability(menu_item_id)
            if available < quantity:
                raise ValueError(f"Insufficient stock for item {menu_item_id}. Available: {available}, Requested: {quantity}")
        
        # Create reservations
        for item in items:
            menu_item_id = item['menu_id']
            quantity = item['quantity']
            
            # Set expiry for BTC orders
            expires_at = None
            if order.payment_type == 'btc':
                expires_at = datetime.now() + timedelta(minutes=20)  # 20-minute window
            
            reservation = models.InventoryReservation(
                order_id=order_id,
                menu_item_id=menu_item_id,
                reserved_qty=quantity,
                expires_at=expires_at
            )
            self.db.add(reservation)
        
        self.db.commit()
        logger.info(f"Created reservations for order {order_id}")
        return True
    
    def release_reservations(self, order_id: int, reason: str = "cancelled"):
        """Release reservations for an order"""
        reservations = self.db.query(models.InventoryReservation).filter(
            models.InventoryReservation.order_id == order_id,
            models.InventoryReservation.status == 'active'
        ).all()
        
        for reservation in reservations:
            reservation.status = 'released'
        
        self.db.commit()
        logger.info(f"Released reservations for order {order_id}: {reason}")
    
    def fulfill_reservations(self, order_id: int, driver_id: int):
        """Fulfill reservations and deduct from driver stock"""
        order = self.db.query(models.Order).filter(models.Order.id == order_id).first()
        if not order:
            raise ValueError(f"Order {order_id} not found")
        
        reservations = self.db.query(models.InventoryReservation).filter(
            models.InventoryReservation.order_id == order_id,
            models.InventoryReservation.status == 'active'
        ).all()
        
        for reservation in reservations:
            # Update reservation status
            reservation.status = 'fulfilled'
            
            # Deduct from driver stock
            self.update_driver_stock(
                driver_id=driver_id,
                menu_item_id=reservation.menu_item_id,
                qty_change=-reservation.reserved_qty,
                event_type='sale',
                reason_note=f'Order {order.order_number} delivered',
                order_id=order_id
            )
        
        self.db.commit()
        logger.info(f"Fulfilled reservations for order {order_id} from driver {driver_id}")
    
    def transfer_stock(self, from_driver_id: int, to_driver_id: int, menu_item_id: int, quantity: int, reason_note: str = None):
        """Transfer stock between drivers"""
        if quantity <= 0:
            raise ValueError("Transfer quantity must be positive")
        
        # Check source driver has enough stock
        source_stock = self.get_driver_stock(from_driver_id, menu_item_id)
        if not source_stock or source_stock.on_hand_qty < quantity:
            raise ValueError(f"Source driver has insufficient stock")
        
        # Transfer out from source
        self.update_driver_stock(
            from_driver_id, menu_item_id, -quantity, 'transfer_out', 
            f"Transfer to driver {to_driver_id}: {reason_note}"
        )
        
        # Transfer in to destination
        self.update_driver_stock(
            to_driver_id, menu_item_id, quantity, 'transfer_in',
            f"Transfer from driver {from_driver_id}: {reason_note}"
        )
    
    def adjust_driver_stock(self, driver_id: int, menu_item_id: int, new_quantity: int, reason_note: str = None):
        """Adjust driver stock to specific quantity"""
        current_stock = self.get_driver_stock(driver_id, menu_item_id)
        current_qty = current_stock.on_hand_qty if current_stock else 0
        
        qty_change = new_quantity - current_qty
        
        return self.update_driver_stock(
            driver_id, menu_item_id, qty_change, 'adjustment', reason_note
        )
    
    def get_driver_inventory_summary(self, driver_id: int):
        """Get complete inventory summary for a driver"""
        return self.db.query(models.DriverStock).filter(
            models.DriverStock.driver_id == driver_id
        ).join(models.MenuItem).all()
    
    def cleanup_expired_reservations(self):
        """Clean up expired BTC reservations"""
        expired = self.db.query(models.InventoryReservation).filter(
            models.InventoryReservation.status == 'active',
            models.InventoryReservation.expires_at < datetime.now()
        ).all()
        
        for reservation in expired:
            reservation.status = 'released'
            logger.info(f"Released expired reservation {reservation.id} for order {reservation.order_id}")
        
        self.db.commit()
        return len(expired)

# Global function to get inventory service
def get_inventory_service(db: Session) -> InventoryService:
    return InventoryService(db)