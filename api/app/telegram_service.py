import os
import requests
import logging
from typing import Dict, Any
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()
token = os.getenv("TELEGRAM_BOT_TOKEN")

if token is None:
    print("TELEGRAM_BOT_TOKEN environment variable is not set!")

class TelegramService:
    def __init__(self):
        self.bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
        if not self.bot_token:
            logger.error("TELEGRAM_BOT_TOKEN environment variable is not set!")
        self.api_url = f"https://api.telegram.org/bot{self.bot_token}"
    
    def send_message(self, chat_id: int, text: str, parse_mode: str = "HTML") -> bool:
        """Send message to Telegram user"""
        if not self.bot_token:
            logger.error("Cannot send message: TELEGRAM_BOT_TOKEN not set")
            return False
            
        try:
            url = f"{self.api_url}/sendMessage"
            payload = {
                "chat_id": chat_id,
                "text": text,
                "parse_mode": parse_mode
            }
            
            logger.info(f"Sending Telegram message to chat_id {chat_id}")
            logger.debug(f"Message content: {text}")
            
            response = requests.post(url, json=payload, timeout=10)
            
            if response.status_code == 200:
                logger.info(f"✅ Message successfully sent to chat_id {chat_id}")
                return True
            else:
                error_data = response.json()
                logger.error(f"❌ Failed to send message to {chat_id}: {error_data}")
                return False
                
        except requests.exceptions.Timeout:
            logger.error(f"⏰ Timeout sending message to chat_id {chat_id}")
            return False
        except requests.exceptions.ConnectionError:
            logger.error(f"🔌 Connection error sending message to chat_id {chat_id}")
            return False
        except Exception as e:
            logger.error(f"💥 Unexpected error sending message to {chat_id}: {e}")
            return False
    
    def notify_driver_assignment(self, driver_telegram_id: int, order_data: Dict[str, Any]) -> bool:
        """Notify driver about new order assignment"""
        try:
            order = order_data["order"]
            customer = order_data["customer"]
            driver = order_data["driver"]
            
            logger.info(f"Preparing driver assignment notification for driver {driver.name} (TG: {driver_telegram_id})")
            
            # Format delivery time
            delivery_time = ""
            if order.delivery_slot_et:
                from datetime import datetime
                if isinstance(order.delivery_slot_et, str):
                    # Parse string to datetime
                    delivery_dt = datetime.fromisoformat(order.delivery_slot_et.replace('Z', '+00:00'))
                else:
                    delivery_dt = order.delivery_slot_et
                delivery_time = f"\n🕐 <b>Delivery Time:</b> {delivery_dt.strftime('%Y-%m-%d %H:%M')}"
            
            # Format items and calculate total
            items_text = ""
            total_amount = 0
            for item in order.items:
                quantity = item.get('quantity', 1)
                item_total = item['price_cents'] * quantity
                total_amount += item_total
                items_text += f"• {item['name']} x{quantity} - ${item_total/100:.2f}\n"
            
            # Determine order type emoji and text
            order_type_emoji = "🚚" if order.delivery_or_pickup == 'delivery' else "🏃"
            order_type_text = "Delivery" if order.delivery_or_pickup == 'delivery' else "Pickup"
            
            message = f"""
{order_type_emoji} <b>NEW ORDER ASSIGNED TO YOU!</b>

📦 <b>Order #:</b> <code>{order.order_number}</code>
💰 <b>Total Amount:</b> <b>${total_amount/100:.2f}</b>
📍 <b>Type:</b> <b>{order_type_text}</b>
{delivery_time}

👤 <b>Customer:</b> {customer.phone if customer and customer.phone else 'No phone provided'}

📋 <b>Order Items:</b>
{items_text}

📝 <b>Customer Notes:</b> {order.notes or 'No special instructions'}

<b>Please confirm when you accept this order! ✅</b>

<b>Available Commands:</b>
/start_driver - Activate driver mode
/outside_{order.order_number} - Mark as arrived
/complete_{order.order_number} - Mark as delivered
            """.strip()
            
            logger.info(f"Sending assignment notification to driver {driver.name} (TG: {driver_telegram_id})")
            success = self.send_message(driver_telegram_id, message)
            
            if success:
                logger.info(f"✅ Driver assignment notification sent successfully to {driver.name}")
            else:
                logger.error(f"❌ Failed to send driver assignment notification to {driver.name}")
                
            return success
            
        except Exception as e:
            logger.error(f"💥 Error in notify_driver_assignment: {e}")
            return False
    
    def notify_order_status_update(self, customer_telegram_id: int, order_number: str, status: str, driver_name: str = None, additional_info: str = "") -> bool:
        """Notify customer about order status update"""
        try:
            status_messages = {
                'assigned': f"🚗 Driver <b>{driver_name}</b> has been assigned to your order!{additional_info}",
                'out_for_delivery': "📦 Your order is out for delivery and will arrive soon!",
                'delivered': "✅ Your order has been delivered! Thank you for choosing our service! 🎉",
                'scheduled': "⏰ Your order has been scheduled for delivery."
            }
            
            message = status_messages.get(status, f"Order status updated to: {status}")
            
            full_message = f"""
    📦 <b>Order Update: #{order_number}</b>

    {message}

    Thank you for your order! 🙏
            """.strip()
            
            logger.info(f"Sending status update to customer {customer_telegram_id} for order {order_number}")
            return self.send_message(customer_telegram_id, full_message)
            
        except Exception as e:
            logger.error(f"Error in notify_order_status_update: {e}")
            return False
    
    def send_driver_reminder(self, driver_telegram_id: int, order_number: str, reminder_type: str = "accept") -> bool:
        """Send reminder to driver"""
        try:
            if reminder_type == "accept":
                message = f"""
🔔 <b>Order Reminder</b>

Order #{order_number} is still waiting for your acceptance.

Please confirm if you can deliver this order!
                """.strip()
            else:
                message = f"""
⏰ <b>Delivery Reminder</b>
                
Order #{order_number} needs to be delivered soon.
Please check the delivery time and plan accordingly!
                """.strip()
            
            return self.send_message(driver_telegram_id, message)
            
        except Exception as e:
            logger.error(f"Error sending driver reminder: {e}")
            return False

# Global instance
telegram_service = TelegramService()
