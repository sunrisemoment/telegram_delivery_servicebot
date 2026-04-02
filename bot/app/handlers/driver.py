from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.filters import Command, CommandObject
from aiogram.fsm.context import FSMContext
import logging
from ..api_client import api_client

router = Router()
logger = logging.getLogger(__name__)

def get_driver_orders_keyboard(orders):
    """Generate keyboard for driver to manage orders"""
    keyboard = []
    for order in orders:
        status_emoji = {
            'placed': '🆕',
            'assigned': '👨‍🍳',
            'preparing': '👨‍🍳', 
            'ready': '✅',
            'out_for_delivery': '🚗',
            'delivered': '🎉',
            'cancelled': '❌'
        }.get(order['status'], '📦')
        
        order_text = f"{status_emoji} Order #{order['order_number']} - ${order['total_cents']/100:.2f}"
        keyboard.append([
            InlineKeyboardButton(
                text=order_text,
                callback_data=f"driver_order:{order['order_number']}"
            )
        ])
    
    # keyboard.append([InlineKeyboardButton(text="🔄 Refresh Orders", callback_data="driver_refresh")])
    
    return InlineKeyboardMarkup(inline_keyboard=keyboard)

def get_order_management_keyboard(order_number, current_status):
    """Generate keyboard for specific order management"""
    keyboard = []
    
    if current_status in ["assigned", "preparing", "ready"]:
        keyboard.append([
            InlineKeyboardButton(
                text="🚗 Start Delivery", 
                callback_data=f"driver_start:{order_number}"
            )
        ])
    
    if current_status in ["out_for_delivery"]:
        # keyboard.append([
        #     InlineKeyboardButton(
        #         text="📍 I'm Outside", 
        #         callback_data=f"driver_outside:{order_number}"
        #     )
        # ])
        keyboard.append([
            InlineKeyboardButton(
                text="✅ Complete Delivery", 
                callback_data=f"driver_complete:{order_number}"
            )
        ])
    
    keyboard.append([InlineKeyboardButton(text="📋 Order Details", callback_data=f"driver_details:{order_number}")])
    keyboard.append([InlineKeyboardButton(text="⬅️ Back to Orders", callback_data="driver_back")])
    
    return InlineKeyboardMarkup(inline_keyboard=keyboard)

@router.message(Command("orders"))
async def view_driver_orders(message: Message):
    """View orders assigned to driver"""
    try:
        # Get driver ID first
        driver_info = await api_client.get_driver_by_telegram_id(message.from_user.id)
        if not driver_info:
            await message.answer("❌ You are not registered as a driver. Use /start to register.")
            return
        
        driver_id = driver_info['id']
        orders = await api_client.get_driver_orders(driver_id)
        
        if not orders:
            await message.answer("📭 No orders assigned to you at the moment.")
            return
        
        # Filter out delivered and cancelled orders for active view
        active_orders = [order for order in orders if order.get('status') not in ['delivered', 'cancelled']]
        
        if not active_orders:
            await message.answer("📭 No active orders assigned to you.")
            return
        
        orders_text = "📦 Your Active Orders:\n\n"
        for order in active_orders:
            status_display = order['status'].replace('_', ' ').title()
            orders_text += f"🆔 #{order['order_number']}\n"
            orders_text += f"📊 Status: {status_display}\n"
            orders_text += f"📍 Type: {order.get('delivery_or_pickup', 'delivery').title()}\n"
            orders_text += f"💰 Total: ${order['total_cents']/100:.2f}\n"
            payment_state = "Approved" if order.get('payment_confirmed') else "Pending Approval"
            orders_text += f"💳 Payment: {payment_state}\n"
            
            if order.get('delivery_or_pickup') == 'delivery':
                address = order.get('delivery_address', 'Not specified')
                if len(address) > 50:
                    address = address[:47] + "..."
                orders_text += f"🏠 Address: {address}\n"
            else:
                pickup = order.get('pickup_address_text', 'Not specified')
                if len(pickup) > 50:
                    pickup = pickup[:47] + "..."
                orders_text += f"🏃 Pickup: {pickup}\n"
            
            orders_text += "─" * 30 + "\n"
        
        await message.answer(
            orders_text,
            reply_markup=get_driver_orders_keyboard(active_orders)
        )
        
    except Exception as e:
        logger.error(f"Error fetching driver orders: {e}")
        await message.answer("❌ Error fetching your orders. Please try again.")

@router.message(Command("outside"))
async def driver_outside_command(message: Message, command: CommandObject):
    """Handle /outside command with or without order number"""
    try:
        order_number = command.args
        
        if not order_number:
            await message.answer("Usage: /outside <order_number>")
            return
        
        await update_order_status(message, order_number, "out_for_delivery")
            
    except Exception as e:
        logger.error(f"Error in outside command: {e}")
        await message.answer("❌ Error updating order status.")

@router.message(Command("complete"))
async def complete_order_command(message: Message, command: CommandObject):
    """Handle /complete command with or without order number"""
    try:
        order_number = command.args
        
        if not order_number:
            await message.answer("Usage: /complete <order_number>")
            return
        
        await update_order_status(message, order_number, "delivered")
            
    except Exception as e:
        logger.error(f"Error in complete command: {e}")
        await message.answer("❌ Error updating order status.")

@router.message(Command("status"))
async def check_order_status_command(message: Message, command: CommandObject):
    """Handle /status command with order number"""
    try:
        order_number = command.args
        
        if not order_number:
            await message.answer("Usage: /status <order_number>")
            return
        
        status_info = await api_client.get_order_status(order_number)
        
        if status_info:
            status = status_info.get('status', 'unknown')
            driver_info = status_info.get('driver')
            
            status_display = status.replace('_', ' ').title()
            
            response = f"📦 Order #{order_number}\n"
            response += f"📊 Status: {status_display}\n"
            
            if driver_info:
                response += f"🚗 Driver: {driver_info.get('driver_name', 'Unknown')}\n"
                if driver_info.get('driver_phone'):
                    response += f"📞 Driver Phone: {driver_info['driver_phone']}\n"
            
            response += f"🕐 Last Update: {status_info.get('updated_at', 'Unknown')}"
            
            await message.answer(response)
        else:
            await message.answer(f"❌ Order #{order_number} not found.")
            
    except Exception as e:
        logger.error(f"Error checking order status: {e}")
        await message.answer("❌ Error checking order status.")

# Handle commands with order number in the command itself (e.g., /outside_ORDER123)
@router.message(F.text.regexp(r'^/(outside|complete|status)_([A-Z0-9_]+)$'))
async def handle_combined_commands(message: Message):
    """Handle commands like /outside_ORDER123, /complete_ORDER123"""
    try:
        text = message.text
        command_parts = text[1:].split('_')  # Remove '/' and split
        action = command_parts[0]
        order_number = command_parts[1] if len(command_parts) > 1 else None
        
        if not order_number:
            await message.answer(f"Usage: /{action} <order_number>")
            return
        
        if action == "outside":
            await update_order_status(message, order_number, "out_for_delivery")
        elif action == "complete":
            await update_order_status(message, order_number, "delivered")
        elif action == "status":
            status_info = await api_client.get_order_status(order_number)
            if status_info:
                status = status_info.get('status', 'unknown')
                status_display = status.replace('_', ' ').title()
                await message.answer(f"📦 Order #{order_number}\n📊 Status: {status_display}")
            else:
                await message.answer(f"❌ Order #{order_number} not found.")
                
    except Exception as e:
        logger.error(f"Error handling combined command: {e}")
        await message.answer("❌ Error processing command.")

async def update_order_status(message: Message, order_number: str, new_status: str):
    """Update order status with driver verification"""
    try:
        # Get driver ID
        driver_info = await api_client.get_driver_by_telegram_id(message.from_user.id)
        if not driver_info:
            await message.answer("❌ You are not registered as a driver.")
            return
        
        driver_id = driver_info['id']
        
        # Update order status
        result = await api_client.update_order_status(order_number, new_status, driver_id)
        
        if result:
            status_display = new_status.replace('_', ' ').title()
            await message.answer(f"✅ Order #{order_number} marked as '{status_display}'!")
            
            # Log the action
            logger.info(f"Driver {driver_id} marked order {order_number} as {new_status}")
        else:
            await message.answer(f"❌ Failed to update order status. Order may not exist or you may not be assigned to it.")
            
    except Exception as e:
        logger.error(f"Error updating order status: {e}")
        await message.answer("❌ Error updating order status. Please try again.")

@router.callback_query(F.data.startswith("driver_"))
async def handle_driver_actions(callback: CallbackQuery):
    """Handle driver action callbacks"""
    try:
        data_parts = callback.data.split(":")
        action = data_parts[0]
        
        if action == "driver_refresh":
            await callback.message.delete()
            await view_driver_orders(callback.message)
            
        elif action == "driver_back":
            await callback.message.delete()
            await view_driver_orders(callback.message)
            
        elif action == "driver_order":
            if len(data_parts) > 1:
                order_number = data_parts[1]
                await show_order_details(callback, order_number)
                
        elif action == "driver_start":
            if len(data_parts) > 1:
                order_number = data_parts[1]
                await update_order_status_interactive(callback, order_number, "out_for_delivery")
                
        elif action == "driver_outside":
            if len(data_parts) > 1:
                order_number = data_parts[1]
                await update_order_status_interactive(callback, order_number, "out_for_delivery")
                
        elif action == "driver_complete":
            if len(data_parts) > 1:
                order_number = data_parts[1]
                await update_order_status_interactive(callback, order_number, "delivered")
                
        elif action == "driver_details":
            if len(data_parts) > 1:
                order_number = data_parts[1]
                await show_order_details(callback, order_number)
                
    except Exception as e:
        logger.error(f"Error handling driver action: {e}")
        await callback.answer("❌ Error processing action")

async def show_order_details(callback: CallbackQuery, order_number: str):
    """Show detailed order information for driver"""
    try:
        # Get order from API
        order_response = await api_client.get_order(order_number)
        if not order_response:
            await callback.answer("❌ Order not found")
            return
        
        # Get driver orders to get full order details
        driver_info = await api_client.get_driver_by_telegram_id(callback.from_user.id)
        if not driver_info:
            await callback.answer("❌ Driver not found")
            return
        
        driver_orders = await api_client.get_driver_orders(driver_info['id'])
        order = next((o for o in driver_orders if o['order_number'] == order_number), None)
        
        if not order:
            await callback.answer("❌ Order not assigned to you")
            return
        
        order_text = f"📦 Order #{order_number}\n\n"
        order_text += f"📊 Status: {order.get('status', 'unknown').replace('_', ' ').title()}\n"
        order_text += f"📍 Type: {order.get('delivery_or_pickup', 'delivery').title()}\n"
        payment_label = order.get('payment_type', 'unknown').replace('_', ' ').title()
        payment_state = "Approved" if order.get('payment_confirmed') else "Pending Approval"
        order_text += f"💳 Payment: {payment_label} ({payment_state})\n"
        order_text += f"💰 Total: ${order.get('total_cents', 0) / 100:.2f}\n\n"
        
        # Customer info
        order_text += "👤 Customer Info:\n"
        if order.get('customer_phone'):
            order_text += f"📞 Phone: {order.get('customer_phone')}\n"
        
        # Driver info (show if driver has phone)
        if order.get('driver_phone'):
            order_text += f"🚗 Your Phone: {order.get('driver_phone')}\n\n"
        
        # Address info
        if order.get('delivery_or_pickup') == 'delivery':
            order_text += f"🏠 Delivery Address:\n{order.get('delivery_address', 'Not specified')}\n"
        else:
            order_text += f"🏃 Pickup Location:\n{order.get('pickup_address_text', 'Not specified')}\n"
        
        # Items
        order_text += "\n🛍️ Items:\n"
        for item in order.get('items', []):
            quantity = item.get('quantity', 1)
            order_text += f"• {item.get('name', 'Unknown')} x{quantity}\n"
        
        await callback.message.edit_text(
            order_text,
            reply_markup=get_order_management_keyboard(order_number, order.get('status'))
        )
        
    except Exception as e:
        logger.error(f"Error showing order details: {e}")
        await callback.answer("❌ Error loading order details")

async def update_order_status_interactive(callback: CallbackQuery, order_number: str, new_status: str):
    """Update order status from interactive button"""
    try:
        # Get driver ID
        driver_info = await api_client.get_driver_by_telegram_id(callback.from_user.id)
        if not driver_info:
            await callback.answer("❌ You are not registered as a driver.")
            return
        
        driver_id = driver_info['id']
        status_display = new_status.replace('_', ' ').title()
        
        result = await api_client.update_order_status(order_number, new_status, driver_id)
        
        if result:
            await callback.answer(f"✅ Order status updated to '{status_display}'")
            
            # Refresh the order view
            await show_order_details(callback, order_number)
            
            # Send confirmation message
            await callback.message.answer(
                f"✅ Order #{order_number} status updated to '{status_display}'"
            )
        else:
            await callback.answer("❌ Failed to update order status")
            
    except Exception as e:
        logger.error(f"Error updating order status interactively: {e}")
        await callback.answer("❌ Error updating status")

@router.message(Command("set_phone"))
async def set_driver_phone(message: Message, command: CommandObject):
    """Allow drivers to set their phone number"""
    try:
        phone = command.args
        
        if not phone:
            await message.answer("Usage: /set_phone <your_phone_number>")
            return
        
        # Get driver info
        driver_info = await api_client.get_driver_by_telegram_id(message.from_user.id)
        if not driver_info:
            await message.answer("❌ You are not registered as a driver.")
            return
        
        # Update driver phone via API
        result = await api_client.update_driver_phone(driver_info['id'], phone)
        
        if result:
            await message.answer(f"✅ Your phone number has been updated to: {phone}")
        else:
            await message.answer("❌ Failed to update phone number. Please try again.")
            
    except Exception as e:
        logger.error(f"Error setting driver phone: {e}")
        await message.answer("❌ Error updating phone number.")

def register_driver_handlers(dp):
    dp.include_router(router)
