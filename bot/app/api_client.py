import aiohttp
import os
import logging
import asyncio
from typing import List, Dict, Any, Optional
import time

logger = logging.getLogger(__name__)

class APIClient:
    def __init__(self):
        self.base_url = os.getenv("API_BASE_URL", "http://localhost:8000")
        self._session = None
        self._menu_cache = None
        self._cache_time = None
        self._cache_ttl = 30
        
    async def ensure_session(self):
        """Ensure session exists"""
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=5.0)
            self._session = aiohttp.ClientSession(timeout=timeout)
        return self._session

    async def _request(self, method: str, endpoint: str, **kwargs):
        """Optimized request with error handling"""
        try:
            session = await self.ensure_session()
            url = f"{self.base_url}{endpoint}"
            
            async with session.request(method, url, **kwargs) as response:
                if response.status == 200:
                    return await response.json()
                else:
                    logger.error(f"API error {response.status}: {await response.text()}")
                    return None
        except asyncio.TimeoutError:
            logger.error(f"API timeout for {url}")
            return None
        except Exception as e:
            logger.error(f"API connection error: {e}")
            return None
    
    async def get_menu(self) -> Optional[List[Dict]]:
        """Get available menu items from API"""
        return await self._request("GET", "/menu")
    
    async def create_order(self, order_data: Dict[str, Any]) -> Optional[Dict]:
        """Create a new order via API"""
        return await self._request("POST", "/order", json=order_data)
    
    async def get_order(self, order_number: str) -> Optional[Dict]:
        """Get order details by order number"""
        return await self._request("GET", f"/orders/{order_number}")
    
    async def create_customer(self, customer_data: Dict[str, Any]) -> Optional[Dict]:
        """Create or update customer information"""
        return await self._request("POST", "/customers", json=customer_data)
    
    async def get_customer(self, telegram_id: int) -> Optional[Dict]:
        """Get customer by Telegram ID"""
        return await self._request("GET", f"/customers/telegram/{telegram_id}")
    
    async def health_check(self) -> bool:
        """Check if API is available"""
        result = await self._request("GET", "/health")
        return result is not None and result.get("status") == "healthy"
    
    async def get_menu_with_availability(self) -> Optional[List[Dict]]:
        """Get menu items with real-time availability"""
        current_time = time.time()
        # Return cached menu if still valid
        if (self._menu_cache is not None and 
            self._cache_time is not None and 
            (current_time - self._cache_time) < self._cache_ttl):
            return self._menu_cache
        try:
            menu = await self._request("GET", "/menu-with-availability")
            if menu:
                self._menu_cache = menu
                self._cache_time = current_time
            return menu
        except Exception as e:
            logger.error(f"Error getting menu with availability: {e}")
            # Fallback to regular menu
            return await self.get_menu()
    
    async def get_driver_inventory(self, driver_id: int) -> Optional[List[Dict]]:
        """Get driver's current inventory"""
        return await self._request("GET", f"/inventory/drivers/{driver_id}/stock")
    
    async def check_inventory_availability(self, items: List[Dict]) -> Optional[Dict]:
        """Check if items are available before order placement"""
        try:
            # Since we don't have a dedicated endpoint, we'll implement client-side checking
            menu_items = await self.get_menu_with_availability()
            if not menu_items:
                return {"available": True}  # Assume available if we can't check
            
            # Convert menu_items to a dict for easy lookup
            menu_dict = {str(item['id']): item for item in menu_items}
            
            unavailable_items = []
            for cart_item in items:
                menu_id = str(cart_item['menu_id'])
                if menu_id in menu_dict:
                    menu_item = menu_dict[menu_id]
                    available_qty = menu_item.get('available_qty', 0)
                    if available_qty <= 0:
                        unavailable_items.append({
                            'menu_id': cart_item['menu_id'],
                            'name': cart_item['name'],
                            'requested_qty': cart_item.get('quantity', 1),
                            'available_qty': available_qty
                        })
            
            return {
                "available": len(unavailable_items) == 0,
                "unavailable_items": unavailable_items
            }
            
        except Exception as e:
            logger.error(f"Error checking inventory availability: {e}")
            return {"available": True}  # Assume available on error

    async def save_customer_address(self, address_data: Dict[str, Any]) -> Optional[Dict]:
        """Save customer address"""
        return await self._request("POST", "/customer/address", json=address_data)
    
    async def get_customer_addresses(self, telegram_id: int) -> Optional[List[Dict]]:
        """Get customer addresses by Telegram ID"""
        return await self._request("GET", f"/customer/{telegram_id}/addresses")
    
    async def get_pickup_addresses(self) -> Optional[List[Dict]]:
        """Get predefined pickup addresses"""
        return await self._request("GET", "/customer/pickup-addresses")

    async def set_default_address(self, telegram_id: int, address_id: int) -> Optional[Dict]:
        """Set default address for customer"""
        return await self._request("PUT", f"/customer/{telegram_id}/address/{address_id}/default")
    
    async def delete_customer_address(self, address_id: int) -> Optional[Dict]:
        """Delete customer address"""
        return await self._request("DELETE", f"/customer/address/{address_id}")

    async def calculate_delivery_fee(self, order_data: Dict[str, Any]) -> Optional[Dict]:
        """Calculate delivery fee via API"""
        return await self._request("POST", "/calculate-delivery-fee", json=order_data)

    async def get_welcome_message(self) -> Optional[Dict]:
        """Get welcome message and contact info"""
        return await self._request("GET", "/customer/contact")

    async def get_btc_discount(self) -> Optional[Dict]:
        """Get BTC discount information"""
        return await self._request("GET", "/customer/btc-discount")
    
    async def close(self):
        """Close session properly"""
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None

# Singleton instance
api_client = APIClient()