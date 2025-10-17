# [file name]: payment_service.py
import os
import hashlib
import logging
from datetime import datetime
from typing import Optional, Dict, List
from sqlalchemy.orm import Session
from . import models
from .btc_payment_gateway import btc_gateway

logger = logging.getLogger(__name__)

class PaymentService:
    def __init__(self, db: Session):
        self.db = db
    
    def generate_btc_payment(self, order_number: str, total_cents: int) -> Dict:
        """Generate BTC payment details using the payment gateway"""
        order = self.db.query(models.Order).filter(models.Order.order_number == order_number).first()
        if not order:
            raise ValueError(f"Order {order_number} not found")
        
        # Generate BTC payment address
        payment_result = btc_gateway.generate_payment_address(order_number, total_cents)
        
        if payment_result['success']:
            # Store payment details in order
            order.payment_txid = f"pending_{order_number}"  # Temporary ID
            order.payment_status = 'pending_btc'
            order.payment_metadata = order.payment_metadata | {
                "btc_address": payment_result['btc_address'],
                "btc_amount": payment_result['btc_amount'],
                "usd_amount": payment_result['usd_amount'],
                "payment_url": payment_result['payment_url'],
                "qr_code_url": payment_result.get('qr_code_url'),
                "expires_at": payment_result['expires_at'],
                "demo_mode": payment_result.get('demo_mode', False)
            }
            
            self.db.commit()
            
            return {
                "payment_url": payment_result['payment_url'],
                "btc_address": payment_result['btc_address'],
                "btc_amount": payment_result['btc_amount'],
                "usd_amount": payment_result['usd_amount'],
                "expires_at": payment_result['expires_at'],
                "qr_code_url": payment_result.get('qr_code_url')
            }
        else:
            raise ValueError("Failed to generate BTC payment address")
    
    def check_btc_payment_status(self, order_number: str) -> Dict:
        """Check BTC payment status for an order"""
        order = self.db.query(models.Order).filter(models.Order.order_number == order_number).first()
        if not order or not order.payment_metadata:
            return {"error": "Order or payment details not found"}
        
        btc_address = order.payment_metadata.get('btc_address')
        if not btc_address:
            return {"error": "No BTC address found for order"}
        
        # Check payment status
        status_result = btc_gateway.check_payment_status(btc_address)
        
        # Update order status if payment detected
        if status_result.get('has_payment') and order.payment_status != 'paid_0conf':
            order.payment_status = 'paid_0conf'
            # Don't auto-confirm - wait for admin approval
            self.db.commit()
        
        return status_result
    
    def confirm_btc_payment(self, order_number: str, confirmed_by: int, notes: str = None) -> bool:
        """Manually confirm BTC 0-conf payment"""
        order = self.db.query(models.Order).filter(models.Order.order_number == order_number).first()
        if not order:
            logger.error(f"Order not found: {order_number}")
            return False
        
        if order.payment_type != 'btc':
            logger.error(f"Order {order_number} is not a BTC payment")
            return False
        
        # Update payment status
        order.payment_status = 'paid_0conf'
        order.payment_confirmed = True
        order.payment_confirmed_by = confirmed_by
        order.payment_confirmed_at = datetime.now()
        
        # Create order event
        event = models.OrderEvent(
            order_id=order.id,
            type="payment_confirmed",
            payload={
                "confirmed_by": confirmed_by,
                "notes": notes,
                "previous_status": order.payment_status
            }
        )
        self.db.add(event)
        
        self.db.commit()
        
        logger.info(f"BTC payment confirmed for order {order_number} by admin {confirmed_by}")
        return True
    
    def get_all_btc_payments(self) -> List[Dict]:
        """Get all BTC payments with details"""
        btc_orders = self.db.query(models.Order).filter(
            models.Order.payment_type == 'btc'
        ).order_by(models.Order.created_at.desc()).all()
        
        result = []
        for order in btc_orders:
            customer = self.db.query(models.Customer).filter(models.Customer.id == order.customer_id).first()
            payment_metadata = order.payment_metadata or {}
            
            # Generate blockchain explorer URL
            explorer_url = None
            if payment_metadata.get('btc_address'):
                explorer_url = f"https://blockstream.info/address/{payment_metadata['btc_address']}"
            
            result.append({
                "order_number": order.order_number,
                "customer_telegram_id": customer.telegram_id if customer else None,
                "customer_phone": customer.phone if customer else None,
                "total_amount": order.total_cents / 100,
                "subtotal": order.subtotal_cents / 100,
                "delivery_fee": order.delivery_fee_cents / 100,
                "created_at": order.created_at.isoformat(),
                "delivery_type": order.delivery_or_pickup,
                "delivery_address": order.delivery_address_text,
                "payment_status": order.payment_status,
                "payment_confirmed": order.payment_confirmed,
                "payment_confirmed_by": order.payment_confirmed_by,
                "payment_confirmed_at": order.payment_confirmed_at.isoformat() if order.payment_confirmed_at else None,
                "btc_address": payment_metadata.get('btc_address'),
                "btc_amount": payment_metadata.get('btc_amount'),
                "explorer_url": explorer_url,
                "payment_txid": order.payment_txid
            })
        
        return result

def get_payment_service(db: Session) -> PaymentService:
    return PaymentService(db)