# [file name]: btc_payment_gateway.py
import os
import hashlib
import hmac
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple
import requests
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

class BTCPaymentGateway:
    def __init__(self):
        self.api_key = os.getenv('BLOCKCYPHER_API_KEY', 'your_blockcypher_api_key')
        self.base_url = "https://api.blockcypher.com/v1/btc/main"
        self.webhook_secret = os.getenv('BTC_WEBHOOK_SECRET', '')
        self.btc_seed = os.getenv('BTC_SEED', 'default_demo_seed_change_in_production')

        if not self.webhook_secret:
            logger.warning("BTC_WEBHOOK_SECRET not set - webhook verification disabled")
        if self.btc_seed == 'default_demo_seed_change_in_production':
            logger.warning("Using default BTC_SEED - change this in production!")
        
    def generate_payment_address(self, order_number: str, total_cents: int) -> Dict:
        """Generate a unique BTC address for payment using BlockCypher"""
        try:
            usd_amount = total_cents / 100
            
            # Calculate BTC amount based on current rate
            btc_amount = self._get_btc_amount(usd_amount)
            
            # Create payment address
            callback_url = f"{os.getenv('API_BASE_URL', 'http://localhost:8000')}/webhook/btc-payment"
            
            payload = {
                "address": "",  # Let BlockCypher generate address
                "callback_url": callback_url,
                "scrypt_type": "multisig-2-of-3"
            }
            
            headers = {
                "Content-Type": "application/json"
            }
            
            if self.api_key and self.api_key != 'your_blockcypher_api_key':
                url = f"{self.base_url}/addrs?token={self.api_key}"
            else:
                url = f"{self.base_url}/addrs"
            
            response = requests.post(url, json=payload, headers=headers, timeout=30)
            
            if response.status_code == 201:
                data = response.json()
                
                # Create payment intent in database (you'll need to store this)
                payment_data = {
                    "btc_address": data['address'],
                    "btc_amount": btc_amount,
                    "private_key": data.get('private', ''),
                    "public_key": data.get('public', ''),
                    "wif": data.get('wif', ''),
                    "order_number": order_number,
                    "usd_amount": usd_amount,
                    "expires_at": datetime.now() + timedelta(hours=24)  # 24 hour expiry
                }
                
                return {
                    "success": True,
                    "btc_address": data['address'],
                    "btc_amount": btc_amount,
                    "usd_amount": usd_amount,
                    "payment_url": f"bitcoin:{data['address']}?amount={btc_amount}",
                    "expires_at": payment_data['expires_at'].isoformat(),
                    "qr_code_url": f"https://blockcypher.com/qr?data=bitcoin:{data['address']}?amount={btc_amount}"
                }
            else:
                logger.error(f"BlockCypher API error: {response.status_code} - {response.text}")
                return self._fallback_payment_generation(order_number, total_cents)
                
        except Exception as e:
            logger.error(f"Error generating BTC address: {e}")
            return self._fallback_payment_generation(order_number, total_cents)
    
    def _get_btc_amount(self, usd_amount: float) -> float:
        """Get current BTC exchange rate and calculate amount"""
        try:
            # Use CoinGecko API for exchange rate
            response = requests.get(
                "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                btc_rate = data['bitcoin']['usd']
                btc_amount = usd_amount / btc_rate
                return round(btc_amount, 8)
            else:
                # Fallback rate
                return round(usd_amount / 45000, 8)
                
        except Exception as e:
            logger.error(f"Error getting BTC rate: {e}")
            return round(usd_amount / 45000, 8)  # Fallback rate
    
    def _fallback_payment_generation(self, order_number: str, total_cents: int) -> Dict:
        """Fallback method when BlockCypher is unavailable"""
        usd_amount = total_cents / 100
        
        # Generate a deterministic address based on order number (for demo purposes)
        # In production, you should always use a proper payment processor
        address_seed = f"{order_number}{os.getenv('BTC_SEED', 'default_seed')}"
        demo_address = "bc1q" + hashlib.sha256(address_seed.encode()).hexdigest()[:40]
        
        btc_amount = round(usd_amount / 45000, 8)  # Demo rate
        
        return {
            "success": True,
            "btc_address": demo_address,
            "btc_amount": btc_amount,
            "usd_amount": usd_amount,
            "payment_url": f"bitcoin:{demo_address}?amount={btc_amount}",
            "expires_at": (datetime.now() + timedelta(hours=24)).isoformat(),
            "qr_code_url": f"https://blockcypher.com/qr?data=bitcoin:{demo_address}?amount={btc_amount}",
            "demo_mode": True,
            "note": "Demo mode - using generated address"
        }
    
    def check_payment_status(self, btc_address: str) -> Dict:
        """Check if payment has been received for an address"""
        try:
            if self.api_key and self.api_key != 'your_blockcypher_api_key':
                url = f"{self.base_url}/addrs/{btc_address}/balance?token={self.api_key}"
            else:
                url = f"{self.base_url}/addrs/{btc_address}/balance"
            
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                balance = data.get('final_balance', 0)
                unconfirmed_balance = data.get('unconfirmed_balance', 0)
                total_received = data.get('total_received', 0)
                
                return {
                    "address": btc_address,
                    "confirmed_balance": balance,
                    "unconfirmed_balance": unconfirmed_balance,
                    "total_received": total_received,
                    "has_payment": total_received > 0,
                    "has_unconfirmed": unconfirmed_balance > 0
                }
            else:
                return {
                    "address": btc_address,
                    "error": f"API returned {response.status_code}",
                    "has_payment": False,
                    "has_unconfirmed": False
                }
                
        except Exception as e:
            logger.error(f"Error checking payment status: {e}")
            return {
                "address": btc_address,
                "error": str(e),
                "has_payment": False,
                "has_unconfirmed": False
            }
    
    def verify_webhook_signature(self, payload: str, signature: str) -> bool:
        """Verify webhook signature from BlockCypher"""
        try:
            expected_signature = hmac.new(
                self.webhook_secret.encode(),
                payload.encode(),
                hashlib.sha256
            ).hexdigest()
            
            return hmac.compare_digest(signature, expected_signature)
        except Exception as e:
            logger.error(f"Error verifying webhook signature: {e}")
            return False

# Global instance
btc_gateway = BTCPaymentGateway()