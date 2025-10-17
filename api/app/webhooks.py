from fastapi import APIRouter, Request, Header, HTTPException, Depends
from sqlalchemy.orm import Session
from .database import SessionLocal, get_db
from . import crud
import json
import hmac
import hashlib
import os
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

def verify_btcpay_signature(payload: bytes, signature: str, secret: str) -> bool:
    expected_signature = hmac.new(
        secret.encode(), 
        payload, 
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected_signature)

@router.post("/btcpay")
async def btcpay_webhook(request: Request, x_btcpay_sig: str = Header(None)):
    payload = await request.body()
    secret = os.getenv("BTC_WEBHOOK_SECRET")
    
    if not verify_btcpay_signature(payload, x_btcpay_sig, secret):
        raise HTTPException(status_code=401, detail="Invalid signature")
    
    data = json.loads(payload)
    
    # Process BTCPay webhook
    if data.get("type") in ["InvoiceReceivedPayment", "InvoicePaymentSettled"]:
        invoice_id = data.get("invoiceId")
        # Map invoice_id to order_number (you'll need to store this mapping)
        # For now, we'll assume invoice_id = order_number
        
        db = SessionLocal()
        try:
            order = crud.get_order_by_number(db, invoice_id)
            if order:
                if data["type"] == "InvoiceReceivedPayment" and os.getenv("ACCEPT_ZERO_CONF") == "true":
                    crud.update_order_payment_status(db, invoice_id, "paid_0conf")
                elif data["type"] == "InvoicePaymentSettled":
                    crud.update_order_payment_status(db, invoice_id, "paid_confirmed")
        finally:
            db.close()
    
    return {"status": "processed"}

@router.post("/btc-payment")
async def handle_btc_payment_webhook(request: Request, db: Session = Depends(get_db)):
    """Handle BTC payment webhooks from BlockCypher"""
    try:
        # Verify webhook signature
        signature = request.headers.get('X-BlockCypher-Signature', '')
        body = await request.body()
        
        from .btc_payment_gateway import btc_gateway
        if not btc_gateway.verify_webhook_signature(body.decode(), signature):
            logger.warning("Invalid webhook signature")
            return {"status": "error", "message": "Invalid signature"}
        
        data = await request.json()
        logger.info(f"BTC webhook received: {data}")
        
        # Process the webhook data
        # This would typically contain transaction information
        # For now, we'll just log it and let admins handle confirmation manually
        
        return {"status": "received"}
        
    except Exception as e:
        logger.error(f"Error processing BTC webhook: {e}")
        return {"status": "error", "message": str(e)}