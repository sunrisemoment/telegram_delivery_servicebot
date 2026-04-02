# customer.py - COMPLETE FIXED VERSION
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import ReplyKeyboardRemove
import json
from datetime import datetime, timedelta
from typing import List, Dict

from ..states import OrderStates
from ..keyboards import *
from ..utils import get_available_slots, validate_phone, order_item_to_dict
from ..api_client import api_client
import logging
import pytz
import os
import time
import asyncio
from ..utils import proxy_image_url

logger = logging.getLogger(__name__)

BASE_URL = os.getenv("API_BASE_URL")

router = Router()

# Simple in-memory storage for customer data
customer_storage = {}

# Cache for menu
_menu_cache = None
_menu_cache_time = 0

async def get_cached_menu():
    """Get menu with caching to reduce API calls"""
    global _menu_cache, _menu_cache_time
    
    current_time = time.time()
    if _menu_cache and (current_time - _menu_cache_time) < 30:  # 30 second cache
        return _menu_cache
    
    menu = await api_client.get_menu_with_availability()
    
    if menu:
        _menu_cache = menu
        _menu_cache_time = current_time
    
    return menu

@router.message(Command("start"))
async def cmd_start(message: Message):

    contact_settings = await api_client.get_welcome_message()
    if not contact_settings:
        await message.answer(
            "Welcome to our delivery service! 🛍️\n\n"
            "Use the Mini App for the invite-only experience, or the chat buttons below for the legacy flow.",
            reply_markup=get_main_menu()
        )
        return
    
    welcome_message = contact_settings.get('welcome_message', "Welcome to our delivery service! 🛍️")
    welcome_photo_url = contact_settings.get('welcome_photo_url', '')
    
    # Send photo with short caption, then full message
    # (Telegram caption limit is 1024 characters)
    try:
        logger.info(f"Attempting to send welcome photo: {welcome_photo_url}")
        if welcome_photo_url:
            photo_url = proxy_image_url(BASE_URL + welcome_photo_url)
            # Send photo with short caption
            await message.answer_photo(
                photo=photo_url,
                caption=""
            )
        
        
        # Send full message separately
        await message.answer(
            welcome_message + "\n\nUse the Mini App for the invite-only experience, or the chat buttons below for the legacy flow.",
            reply_markup=get_main_menu()
        )
        
        logger.info("✅ Welcome photo and message sent successfully!")
        return
    except Exception as e:
        logger.error(f"❌ Failed to send welcome photo: {e}")
        logger.error(f"Error type: {type(e).__name__}")
        # Fall through to text-only message
    
    # Text-only message (no photo or photo failed)
    await message.answer(
        welcome_message + "\n\nUse the Mini App for the invite-only experience, or the chat buttons below for the legacy flow.",
        reply_markup=get_main_menu()
    )

@router.message(F.text == "🛍️ Order")
async def start_order(message: Message):
    # Check if API is available
    if not await api_client.health_check():
        await message.answer("⚠️ Service temporarily unavailable. Please try again later.")
        return
    
    await message.answer(
        "Choose delivery type:",
        reply_markup=get_delivery_type_keyboard()
    )

@router.callback_query(F.data.startswith("order:"))
async def process_delivery_type(callback: CallbackQuery, state: FSMContext):
    delivery_type = callback.data.split(":")[1]
    
    await state.update_data(delivery_type=delivery_type)
    
    # Check if customer exists in API
    customer = await api_client.get_customer(callback.from_user.id)
    
    if customer and customer.get('phone'):
        # Existing customer with phone
        if delivery_type == 'delivery':
            # Check if customer has addresses
            customer_addresses = await get_customer_addresses(callback.from_user.id)
            if customer_addresses:
                # Has addresses, ask to select one
                await state.set_state(OrderStates.waiting_for_address)
                await ask_for_address_selection(callback.message, callback.from_user.id)
            else:
                # No addresses, ask for new address
                await state.set_state(OrderStates.waiting_for_address)
                await ask_for_address(callback.message)
        else:
            # Pickup - show instructions and go to menu
            await state.set_state(OrderStates.waiting_for_menu_selection)
            await show_pickup_instructions(callback.message, state)
    else:
        # New customer or no phone - ask for phone first
        await state.set_state(OrderStates.waiting_for_phone)
        await callback.message.answer(
            "Please share your phone number to continue:",
            reply_markup=get_phone_keyboard()
        )

async def get_customer_addresses(telegram_id: int) -> List[Dict]:
    """Get customer addresses from API with proper error handling"""
    try:
        addresses = await api_client.get_customer_addresses(telegram_id)
        
        if addresses is None:
            logger.warning(f"API returned None for addresses of user {telegram_id}")
            return []
        
        return addresses
        
    except Exception as e:
        logger.error(f"Error getting customer addresses for user {telegram_id}: {e}")
        return []

async def get_pickup_locations() -> List[Dict]:
    try:
        addresses = await api_client.get_pickup_addresses()
        
        if addresses is None:
            logger.warning(f"API returned None for pickup addresses")
            return []
        
        return addresses
        
    except Exception as e:
        logger.error(f"Error getting pickup addresses: {e}")
        return []

async def show_pickup_instructions(message: Message, state: FSMContext):
    """Show instructions for pickup orders"""
    await message.answer(
        "📦 <b>Pickup Order Instructions</b>\n\n"
        "1. Place your order and select payment method\n"
        "2. Once a driver is assigned to your order, you'll receive:\n"
        "   - Pickup location address\n"
        "   - Driver's contact information\n"
        "   - Specific pickup instructions\n\n"
        "Let's proceed with your order! 🛍️",
        reply_markup=get_main_menu(),
        parse_mode="HTML"
    )
    
    # Go directly to menu selection
    await state.set_state(OrderStates.waiting_for_menu_selection)
    await show_menu_categories_handler(message, state)

async def ask_for_address(message: Message):
    """Ask customer for their address"""
    address_keyboard = ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="📍 Share Location", request_location=True)],
            [KeyboardButton(text="📝 Enter Address Manually")],
            [KeyboardButton(text="⬅️ Back")]
        ],
        resize_keyboard=True
    )
    
    await message.answer(
        "📦 <b>Delivery Address Required</b>\n\n"
        "Please provide your delivery address:\n\n"
        "• Use 📍 <b>Share Location</b> to send your current location\n"
        "• Or 📝 <b>Enter Address Manually</b> to type your address\n\n"
        "Your address will be saved for future orders!",
        reply_markup=address_keyboard,
        parse_mode="HTML"
    )

async def ask_for_address_selection(message: Message, telegram_id: int):
    """Ask customer to select from existing addresses or add new"""
    try:
        addresses = await get_customer_addresses(telegram_id)
        
        if not addresses:
            await message.answer(
                "📦 <b>No saved addresses found</b>\n\n"
                "Let's add your first delivery address:",
                parse_mode="HTML"
            )
            await ask_for_address(message)
            return
        
        keyboard = []
        for addr in addresses:
            # Truncate address for button text
            short_address = addr['address_text']
            if len(short_address) > 30:
                short_address = short_address[:27] + "..."
            
            # Add default indicator
            default_indicator = " ✅" if addr.get('is_default') else ""
            button_text = f"📍 {addr['label']}{default_indicator}: {short_address}"
            
            keyboard.append([KeyboardButton(text=button_text)])
        
        keyboard.append([KeyboardButton(text="➕ Add New Address")])
        
        address_keyboard = ReplyKeyboardMarkup(keyboard=keyboard, resize_keyboard=True)
        
        address_list = "\n".join([
            f"• <b>{addr['label']}</b>{' (Default)' if addr.get('is_default') else ''}: {addr['address_text']}"
            for addr in addresses
        ])
        
        await message.answer(
            f"📦 <b>Select Delivery Address</b>\n\n"
            f"Your saved addresses:\n{address_list}\n\n"
            "Choose an address or add a new one:",
            reply_markup=address_keyboard,
            parse_mode="HTML"
        )
        
    except Exception as e:
        logger.error(f"Error in address selection for user {telegram_id}: {e}")
        await message.answer(
            "❌ <b>Error loading addresses</b>\n\n"
            "Please enter your delivery address:",
            parse_mode="HTML",
            reply_markup=ReplyKeyboardRemove()
        )
        await ask_for_address(message)

# Remove the pickup address selection handler since we're not showing pickup locations initially

# 1. Handle back button first
@router.message(OrderStates.waiting_for_address, F.text == "⬅️ Back")
async def handle_back_from_address(message: Message, state: FSMContext):
    """Handle back button from address collection"""
    data = await state.get_data()
    
    # If we came from phone collection, go back there
    if data.get('phone'):
        # Customer has phone but no address selected
        await state.set_state(OrderStates.waiting_for_address)
        await ask_for_address_selection(message, message.from_user.id)
    else:
        # New customer without phone
        await state.set_state(OrderStates.waiting_for_phone)
        await message.answer(
            "Please share your phone number to continue:",
            reply_markup=get_phone_keyboard()
        )

# 2. Handle address selection (starts with 📍)
@router.message(OrderStates.waiting_for_address, F.text.startswith("📍"))
async def handle_address_selection(message: Message, state: FSMContext):
    """Handle selection of existing address"""
    selected_text = message.text
    
    try:
        addresses = await get_customer_addresses(message.from_user.id)
        
        if not addresses:
            await message.answer("❌ No addresses found. Please add a new address.")
            await ask_for_address(message)
            return
        
        # Find the selected address
        selected_address = None
        for addr in addresses:
            short_address = addr['address_text']
            if len(short_address) > 30:
                short_address = addr['address_text'][:27] + "..."
            
            default_indicator = " ✅" if addr.get('is_default') else ""
            button_text = f"📍 {addr['label']}{default_indicator}: {short_address}"
            
            if button_text == selected_text:
                selected_address = addr
                break
        
        if selected_address:
            # Set as default address if not already
            if not selected_address.get('is_default'):
                try:
                    await api_client.set_default_address(message.from_user.id, selected_address['id'])
                except Exception as e:
                    logger.warning(f"Could not set default address: {e}")
                    # Continue anyway
            
            await state.update_data(
                delivery_address=selected_address['address_text'],
                delivery_address_label=selected_address['label'],
                delivery_address_id=selected_address['id']
            )
            
            await state.set_state(OrderStates.waiting_for_menu_selection)
            await message.answer(
                f"✅ <b>Address selected:</b>\n"
                f"<b>{selected_address['label']}</b>\n"
                f"{selected_address['address_text']}\n\n"
                "Now let's browse the menu and add items to your order!",
                reply_markup=get_main_menu(),
                parse_mode="HTML"
            )
            await show_menu_categories_handler(message, state)
        else:
            await message.answer("❌ Address not found. Please try again.")
            
    except Exception as e:
        logger.error(f"Error selecting address: {e}")
        await message.answer(
            "❌ Error selecting address. Please try again or add a new address.",
            reply_markup=ReplyKeyboardRemove()
        )

# 3. Handle "Add New Address" button
@router.message(OrderStates.waiting_for_address, F.text == "➕ Add New Address")
async def handle_add_new_address(message: Message, state: FSMContext):
    """Handle request to add new address"""
    await ask_for_address(message)

# 4. Handle address label selection (Home, Work, Custom Label)
@router.message(OrderStates.waiting_for_address, F.text.in_(["🏠 Home", "🏢 Work", "📝 Custom Label"]))
async def handle_address_label_selection(message: Message, state: FSMContext):
    """Handle address label selection"""
    data = await state.get_data()
    address_text = data.get('new_address_text')
    
    if not address_text:
        await message.answer("❌ Please enter your address first.")
        # Go back to address input
        await ask_for_address(message)
        return
    
    if message.text == "📝 Custom Label":
        await message.answer(
            "📝 <b>Please enter a custom label for this address:</b>\n\n"
            "Examples: Mom's House, Gym, University",
            reply_markup=ReplyKeyboardRemove(),
            parse_mode="HTML"
        )
        return
    
    label = "Home" if message.text == "🏠 Home" else "Work"
    
    # Save address and continue
    await save_address_and_continue(message, state, address_text, label)

# 5. Handle custom label input (after selecting "Custom Label")
@router.message(OrderStates.waiting_for_address)
async def handle_all_address_messages(message: Message, state: FSMContext):
    """Comprehensive handler for all address state messages - prevents conflicts"""
    logger.info(f"📍 Address state - Content type: {message.content_type}, Text: {getattr(message, 'text', 'No text')}")
    
    # Handle location first
    if message.location:
        logger.info("📍 Handling location")
        location = message.location
        await state.update_data(
            address_lat=location.latitude,
            address_lng=location.longitude,
            location_flow=True
        )
        await message.answer(
            "📍 <b>Location received!</b>\n\n"
            "Please type your full address (street, building, apartment, etc.):\n\n"
            "<i>Example: 123 Main Street, Apt 4B, New York, NY 10001</i>",
            reply_markup=ReplyKeyboardRemove(),
            parse_mode="HTML"
        )
        return
    
    # Handle text messages
    if message.text:
        data = await state.get_data()
        
        # If in location flow, process address text
        if data.get('location_flow'):
            logger.info("📍 Processing address text after location sharing")
            address_text = message.text.strip()
            
            # Skip if this is a button
            if message.text in ["📍 Share Location", "📝 Enter Address Manually", "⬅️ Back", "➕ Add New Address"]:
                return
                
            if len(address_text) < 10:
                await message.answer(
                    "❌ <b>Address too short.</b> Please provide a complete address with street, city, and ZIP code.",
                    parse_mode="HTML"
                )
                return
            
            # Store the address and continue with label selection
            await state.update_data(
                new_address_text=address_text,
                location_flow=False  # Clear the flag
            )
            
            await message.answer(
                "🏷️ <b>What would you like to call this address?</b>\n\n"
                "Examples: Home, Work, Office, Apartment\n\n"
                "This will help you identify it for future orders.",
                reply_markup=ReplyKeyboardMarkup(
                    keyboard=[
                        [KeyboardButton(text="🏠 Home")],
                        [KeyboardButton(text="🏢 Work")],
                        [KeyboardButton(text="📝 Custom Label")]
                    ],
                    resize_keyboard=True
                ),
                parse_mode="HTML"
            )
            return
        
        # Handle custom label input (after selecting "Custom Label")
        address_text = data.get('new_address_text')
        if address_text and message.text not in ["🏠 Home", "🏢 Work", "📝 Custom Label"]:
            # We have stored address text but user didn't select Home/Work - treat as custom label
            label = message.text.strip()
            if len(label) < 2:
                await message.answer("❌ Label too short. Please enter a meaningful label.")
                return
            
            # Save address and continue
            await save_address_and_continue(message, state, address_text, label)
            return
        
        # Handle other text buttons and inputs
        if message.text == "⬅️ Back":
            await handle_back_from_address(message, state)
        elif message.text.startswith("📍"):
            await handle_address_selection(message, state)
        elif message.text == "➕ Add New Address":
            await handle_add_new_address(message, state)
        elif message.text in ["🏠 Home", "🏢 Work"]:
            await handle_address_label_selection(message, state)
        elif message.text == "📝 Custom Label":
            await message.answer(
                "📝 <b>Please enter a custom label for this address:</b>\n\n"
                "Examples: Mom's House, Gym, University",
                reply_markup=ReplyKeyboardRemove(),
                parse_mode="HTML"
            )
        elif message.text == "📝 Enter Address Manually":
            await handle_manual_address_request(message, state)
        elif message.text == "📍 Share Location":
            await message.answer("Please use the location button in the keyboard to share your location.")
        else:
            # Treat as new address text input
            await handle_new_address_text(message, state)

# 6. Handle new address text input (separate function)
async def handle_new_address_text(message: Message, state: FSMContext):
    """Handle new address text input"""
    address_text = message.text.strip()
    
    # Skip if this is a command button that should be handled by other handlers
    if message.text in ["📍 Share Location", "📝 Enter Address Manually", "⬅️ Back", "➕ Add New Address"]:
        return
    
    if len(address_text) < 10:
        await message.answer(
            "❌ <b>Address too short.</b> Please provide a complete address with street, city, and ZIP code.",
            parse_mode="HTML"
        )
        return
    
    # Store the address text and ask for label
    await state.update_data(new_address_text=address_text)
    await message.answer(
        "🏷️ <b>What would you like to call this address?</b>\n\n"
        "Examples: Home, Work, Office, Apartment\n\n"
        "This will help you identify it for future orders.",
        reply_markup=ReplyKeyboardMarkup(
            keyboard=[
                [KeyboardButton(text="🏠 Home")],
                [KeyboardButton(text="🏢 Work")],
                [KeyboardButton(text="📝 Custom Label")]
            ],
            resize_keyboard=True
        ),
        parse_mode="HTML"
    )

@router.message(OrderStates.waiting_for_address, F.location)
async def handle_location_address(message: Message, state: FSMContext):
    """Handle location-based address"""
    location = message.location
    lat = location.latitude
    lng = location.longitude
    
    # You can use a geocoding service here to get address from coordinates
    # For now, we'll ask for manual address entry
    await state.update_data(
        address_lat=lat,
        address_lng=lng,
        location_flow=True
    )
    
    await message.answer(
        "📍 <b>Location received!</b>\n\n"
        "Please type your full address (street, building, apartment, etc.):\n\n"
        "<i>Example: 123 Main Street, Apt 4B, New York, NY 10001</i>",
        reply_markup=ReplyKeyboardRemove(),
        parse_mode="HTML"
    )

@router.message(OrderStates.waiting_for_address, F.text == "📝 Enter Address Manually")
async def handle_manual_address_request(message: Message, state: FSMContext):
    """Handle manual address entry request"""
    await message.answer(
        "📝 <b>Please type your full delivery address:</b>\n\n"
        "<i>Example: 123 Main Street, Apt 4B, New York, NY 10001</i>\n\n"
        "Include:\n"
        "• Street address and number\n"
        "• Apartment/Unit number (if applicable)\n"
        "• City and ZIP code\n"
        "• Any special delivery instructions",
        reply_markup=ReplyKeyboardRemove(),
        parse_mode="HTML"
    )

async def save_address_and_continue(message: Message, state: FSMContext, address_text: str, label: str):
    """Save address to API and continue to menu"""
    try:
        # Save address to API
        address_data = {
            'telegram_id': message.from_user.id,
            'address_text': address_text,
            'label': label,
            'is_default': True
        }
        
        result = await api_client.save_customer_address(address_data)
        
        if result:
            await state.update_data(
                delivery_address=address_text,
                delivery_address_label=label,
                delivery_address_id=result.get('address_id')
            )
            
            await state.set_state(OrderStates.waiting_for_menu_selection)
            await message.answer(
                f"✅ <b>Address saved as '{label}':</b>\n{address_text}\n\n"
                "Now let's browse the menu and add items to your order!",
                reply_markup=get_main_menu(),
                parse_mode="HTML"
            )
            await show_menu_categories_handler(message, state)
        else:
            raise Exception("Failed to save address to API")
            
    except Exception as e:
        logger.error(f"Error saving address: {e}")
        # Continue even if saving fails, but store in state
        await state.update_data(
            delivery_address=address_text,
            delivery_address_label=label
        )
        
        await state.set_state(OrderStates.waiting_for_menu_selection)
        await message.answer(
            f"⚠️ <b>Address saved locally:</b>\n{address_text}\n\n"
            "Now let's browse the menu and add items to your order!",
            reply_markup=get_main_menu(),
            parse_mode="HTML"
        )
        await show_menu_categories_handler(message, state)

async def show_menu_categories_handler(message: Message, state: FSMContext):
    """Show menu categories with inventory availability"""
    menu_items = await get_cached_menu()
    
    if not menu_items:
        await message.answer("⚠️ Menu temporarily unavailable. Please try again later.")
        return
    
    # Group items by category with availability status
    categories = {}
    for item in menu_items:
        if item['category'] not in categories:
            categories[item['category']] = []
        
        # Add availability status to item
        item_status = item.get('status', 'in_stock')
        status_emoji = {
            'in_stock': '🟢',
            'low_stock': '🟡', 
            'out_of_stock': '🔴'
        }.get(item_status, '⚪')
        
        categories[item['category']].append({
            **item,
            'status_emoji': status_emoji,
            'available_qty': item.get('available_qty', 0)
        })
    
    # Create category keyboard
    keyboard = []
    for category in sorted(categories.keys()):
        # Count available items in category
        available_items = [item for item in categories[category] if item['status'] != 'out_of_stock']
        item_count = len(available_items)
        
        keyboard.append([InlineKeyboardButton(
            text=f"📋 {category} ({item_count} available)", 
            callback_data=f"category:{category}"
        )])
    
    keyboard.append([InlineKeyboardButton(text="✅ Finish Order", callback_data="category:finish")])
    
    # Add back button to delivery type selection
    keyboard.append([InlineKeyboardButton(text="↩️ Back to Delivery Type", callback_data="category:back_to_delivery")])
    
    await message.answer(
        "Please choose a category:\n\n"
        "🟢 In Stock  🟡 Low Stock  🔴 Out of Stock",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=keyboard)
    )

@router.callback_query(F.data.startswith("category:"))
async def process_category_selection(callback: CallbackQuery, state: FSMContext):
    category = callback.data.split(":")[1]
    
    if category == "finish":
        # Show cart review instead of directly processing order
        await show_cart_review(callback, state)
    elif category == "back":
        await show_menu_categories_handler(callback.message, state)
    elif category == "back_to_delivery":
        # Go back to delivery type selection
        await callback.message.answer(
            "Choose delivery type:",
            reply_markup=get_delivery_type_keyboard()
        )
    else:
        await show_category_items(callback, category)

async def show_category_items(callback: CallbackQuery, category: str):
    """Show items for a specific category with inventory status"""
    menu_items = await get_cached_menu()
    
    if not menu_items:
        await callback.message.answer("⚠️ Menu temporarily unavailable.")
        return
    
    category_items = [item for item in menu_items if item['category'] == category]
    
    if not category_items:
        await callback.answer("No items in this category")
        return
    
    # Edit the original message to show category header
    await callback.message.edit_text(
        f"🍽️ {category}:\n\nChoose an item to add to your cart:"
    )
    
    # Send each item as a separate photo message with add button
    for item in category_items:
        price = f"${item['price_cents'] / 100:.2f}"
        status_emoji = {
            'in_stock': '🟢',
            'low_stock': '🟡', 
            'out_of_stock': '🔴'
        }.get(item.get('status', 'in_stock'), '⚪')
        
        # Create caption with item name, price, and description
        caption = f"<b>{item['name']}</b>\n\n"
        caption += f"💰 <b>Price:</b> {price}\n"
        caption += f"📝 {item['description']}"
        
        # Add stock info to caption
        if item.get('status') == 'out_of_stock':
            caption += "\n🔴 Out of Stock"
        elif item.get('status') == 'low_stock':
            caption += f"\n🟡 Only {item.get('available_qty', 0)} left"
        
        # Create inline keyboard
        keyboard = []
        if item.get('status') != 'out_of_stock':
            # Clean the item name for callback data (remove special chars, limit length)
            clean_item_name = "".join(c for c in item['name'] if c.isalnum() or c in (' ', '-', '_')).strip()
            clean_item_name = clean_item_name[:20]  # Limit length
            
            keyboard.append([
                InlineKeyboardButton(
                    text="🛒 Add to Cart",
                    callback_data=f"item:{item['id']}"  # Only use ID, not name
                )
            ])
        else:
            keyboard.append([
                InlineKeyboardButton(
                    text="🔴 Out of Stock", 
                    callback_data="out_of_stock"
                )
            ])
        
        reply_markup = InlineKeyboardMarkup(inline_keyboard=keyboard)
        
        # Send photo if available
        photo_url = item.get('photo_url')
        if photo_url:
            try:
                # Clean the URL and ensure it's properly formatted
                clean_photo_url = photo_url.strip()
                logger.info(f"Sending photo: {proxy_image_url(BASE_URL + clean_photo_url)}")
                # Send photo inline without link in caption
                await callback.message.answer_photo(
                    photo=proxy_image_url(BASE_URL + clean_photo_url),
                    caption=caption,
                    reply_markup=reply_markup,
                    parse_mode="HTML"
                )
                continue  # Skip text version if photo sent successfully
            except Exception as e:
                logger.warning(f"Failed to send photo for {item['name']}: {e}")
                # Fall through to text version
        
        # Fallback: send text message if no photo or photo failed
        await callback.message.answer(
            caption,
            reply_markup=reply_markup,
            parse_mode="HTML"
        )
    
    # Add navigation buttons at the end
    navigation_keyboard = [
        [InlineKeyboardButton(text="⬅️ Back to Categories", callback_data="category:back")],
        [InlineKeyboardButton(text="↩️ Back to Delivery Type", callback_data="category:back_to_delivery")]
    ]
    
    await callback.message.answer(
        "Browse items above and use the buttons to add to cart:",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=navigation_keyboard)
    )

@router.callback_query(F.data == "out_of_stock")
async def handle_out_of_stock(callback: CallbackQuery):
    """Handle clicks on out of stock items"""
    await callback.answer("❌ This item is currently out of stock. Please choose another item.")

@router.callback_query(F.data.startswith("item:"))
async def process_item_selection(callback: CallbackQuery, state: FSMContext):
    """Handle item selection with inventory validation"""
    try:
        item_data = callback.data.split(":")
        item_id = item_data[1]
        item_name = item_data[2] if len(item_data) > 2 else "Item"
        
        # Check current inventory availability
        menu_items = await get_cached_menu()
        item_details = next((item for item in menu_items if str(item['id']) == item_id), None)
        
        if not item_details:
            await callback.answer("❌ Item not found")
            return
            
        # Check if item is available
        if item_details.get('status') == 'out_of_stock':
            await callback.answer("❌ This item is now out of stock")
            return
            
        if item_details.get('available_qty', 0) <= 0:
            await callback.answer("❌ This item is now out of stock")
            return
        
        # Add item to cart in state
        current_data = await state.get_data()
        cart_items = current_data.get('items', [])
        
        # Check if we're already at the available quantity
        current_quantity_in_cart = sum(
            item.get('quantity', 1) 
            for item in cart_items 
            if str(item.get('menu_id')) == item_id
        )
        
        available_qty = item_details.get('available_qty', 0)
        if current_quantity_in_cart >= available_qty:
            await callback.answer(f"❌ Only {available_qty} available, already in cart")
            return
        
        cart_item = {
            'menu_id': item_id,
            'name': item_details['name'],
            'price_cents': item_details['price_cents'],
            'quantity': 1
        }
        cart_items.append(cart_item)
        await state.update_data(items=cart_items)
        
        # Calculate new total
        subtotal = sum(item['price_cents'] for item in cart_items)
        await state.update_data(subtotal_cents=subtotal)
        
        await callback.answer(f"✅ Added {item_details['name']} to cart!")
        
    except Exception as e:
        logger.error(f"Error adding item to cart: {e}")
        await callback.answer("❌ Error adding item to cart")

async def process_order_finish(callback: CallbackQuery, state: FSMContext):
    """Process order completion with actual delivery fee calculation via API"""
    data = await state.get_data()
    delivery_type = data.get('delivery_type')
    cart_items = data.get('items', [])
    
    if not cart_items:
        await callback.message.answer("🛒 Your cart is empty! Please add some items first.")
        return
    
    # Check if we have delivery address for delivery orders
    if delivery_type == 'delivery':
        delivery_address = data.get('delivery_address')
        delivery_address_id = data.get('delivery_address_id')
        
        if not delivery_address and not delivery_address_id:
            # No address found, ask for address
            await state.set_state(OrderStates.waiting_for_address)
            await ask_for_address_selection(callback.message, callback.from_user.id)
            return
    
    # Final inventory availability check before order creation
    try:
        availability_result = await api_client.check_inventory_availability(cart_items)
        
        # Handle None result gracefully
        if availability_result is None:
            availability_result = {"available": True, "unavailable_items": []}
        
        if not availability_result.get('available', True):
            unavailable_items = availability_result.get('unavailable_items', [])
            
            if unavailable_items:
                # Remove unavailable items from cart and notify user
                available_items = []
                unavailable_names = []
                
                for item in cart_items:
                    if any(str(unavailable.get('menu_id')) == str(item['menu_id']) for unavailable in unavailable_items):
                        unavailable_names.append(item['name'])
                    else:
                        available_items.append(item)
                
                if available_items:
                    # Update cart with only available items
                    await state.update_data(items=available_items)
                    
                    unavailable_text = "\n".join([f"• {name}" for name in unavailable_names])
                    await callback.message.answer(
                        f"⚠️ Some items are no longer available and were removed from your cart:\n\n"
                        f"{unavailable_text}\n\n"
                        f"Your cart has been updated with available items only."
                    )
                    # Recursively call this function with updated cart
                    await process_order_finish(callback, state)
                    return
                else:
                    await callback.message.answer(
                        "❌ All items in your cart are now out of stock. Please add different items."
                    )
                    return
            else:
                await callback.message.answer(
                    "❌ Some items are no longer available. Please review your cart and try again."
                )
                return
                
    except Exception as e:
        logger.error(f"Error checking inventory: {e}")
        # Continue with order if inventory check fails
        # This ensures the bot doesn't break if inventory service is down
    
    # Calculate subtotal
    subtotal_cents = sum(item['price_cents'] * item.get('quantity', 1) for item in cart_items)
    
    if delivery_type == 'delivery' and subtotal_cents < 10000:
        await callback.message.answer(
            "Delivery requires minimum $100 order. Your cart is only "
            f"${subtotal_cents/100:.2f}. Please add more items or choose pickup."
        )
        return
    
    # For delivery orders, we'll calculate the actual delivery fee via API
    # For now, show estimated summary
    estimated_delivery_fee = 0
    if delivery_type == 'delivery':
        estimated_delivery_fee = 1500  # Base estimate for display
    
    total_estimate = subtotal_cents + estimated_delivery_fee
    
    # Show cart summary with estimated delivery fee
    cart_text = "🛒 Your Order Summary:\n\n"
    for item in cart_items:
        quantity = item.get('quantity', 1)
        item_total = item['price_cents'] * quantity
        cart_text += f"• {item['name']} x{quantity} - ${item_total / 100:.2f}\n"
    
    cart_text += f"\n💰 Subtotal: ${subtotal_cents / 100:.2f}"
    if delivery_type == 'delivery':
        cart_text += f"\n🚚 Delivery Fee: ~${estimated_delivery_fee / 100:.2f} (final calculated at checkout)"
    cart_text += f"\n💵 Total Estimate: ${total_estimate / 100:.2f}"
    
    await callback.message.answer(cart_text)
    
    # Calculate final delivery fee for delivery orders
    final_delivery_fee = 0
    delivery_zone = 'Pickup'
    
    if delivery_type == 'delivery':
        # Prepare order data for delivery fee calculation
        order_data = {
            'customer_id': callback.from_user.id,
            'items': cart_items,
            'subtotal_cents': subtotal_cents,
            'delivery_or_pickup': delivery_type,
            'delivery_address_text': data.get('delivery_address'),
            'delivery_address_id': data.get('delivery_address_id'),
            'calculate_delivery_fee_only': True
        }
        
        try:
            # Call API to calculate actual delivery fee
            fee_result = await api_client.calculate_delivery_fee(order_data)
            
            if fee_result and 'delivery_fee_cents' in fee_result:
                final_delivery_fee = fee_result['delivery_fee_cents']
                delivery_zone = fee_result.get('delivery_zone', 'Standard')
            else:
                final_delivery_fee = 1500
                delivery_zone = 'Standard'
                logger.warning("Failed to get delivery fee from API, using fallback")
        except Exception as e:
            logger.error(f"Error calculating delivery fee: {e}")
            final_delivery_fee = 1500
            delivery_zone = 'Standard'
    
    total_cents = subtotal_cents + final_delivery_fee
    
    # Store final amounts in state
    await state.update_data(
        subtotal_cents=subtotal_cents,
        delivery_fee_cents=final_delivery_fee,
        total_cents=total_cents,
        delivery_zone=delivery_zone
    )
    
    # Show final summary
    summary_text = "📋 Final Order Summary:\n\n"
    for item in cart_items:
        quantity = item.get('quantity', 1)
        item_total = item['price_cents'] * quantity
        summary_text += f"• {item['name']} x{quantity} - ${item_total / 100:.2f}\n"
        
    summary_text += f"\n💰 Subtotal: ${subtotal_cents / 100:.2f}"
    if delivery_type == 'delivery':
        summary_text += f"\n🚚 Delivery Fee (Flat Rate): ${final_delivery_fee / 100:.2f}"
    summary_text += f"\n💵 Total: ${total_cents / 100:.2f}"
    
    await callback.message.answer(summary_text, parse_mode="HTML")
    
    # Skip time slot selection and go directly to payment method
    await state.set_state(OrderStates.waiting_for_payment_method)
    
    # Get BTC discount percentage if available
    btc_discount = 0
    settings = await api_client.get_btc_discount()
    if settings:
        btc_discount = settings.get('btc_discount_percent', 0)

    payment_message = "Select payment method:"
    if btc_discount > 0:
        discounted_total = total_cents * (100 - btc_discount) / 100
        payment_message = (
            f"💡 <b>Bitcoin Payment Discount Available!</b>\n"
            f"Pay with BTC and get {btc_discount}% off!\n"
            f"Regular price: ${total_cents/100:.2f}\n"
            f"BTC price: ${discounted_total/100:.2f}\n"
            f"You save: ${(total_cents - discounted_total)/100:.2f}\n\n"
            "Select payment method:"
        )

    # Show payment methods
    await callback.message.answer(
        payment_message,
        reply_markup=get_payment_methods_keyboard(),
        parse_mode="HTML"
    )

# Slot selection removed - orders are now processed immediately

@router.callback_query(OrderStates.waiting_for_payment_method, F.data.startswith("payment:"))
async def process_payment_method(callback: CallbackQuery, state: FSMContext):
    """Process payment method and create final order with actual delivery fee"""
    payment_method = callback.data.split(":")[1]
    
    if payment_method == "back":
        # Go back to cart review
        await show_cart_review(callback, state)
        return
    
    data = await state.get_data()
    delivery_type = data.get('delivery_type')

    # Verify we have all required data
    if delivery_type == 'delivery' and not data.get('delivery_address'):
        await callback.message.answer(
            "❌ <b>Delivery address required!</b>\n\n"
            "Please provide your delivery address before completing the order.",
            parse_mode="HTML"
        )
        await state.set_state(OrderStates.waiting_for_address)
        await ask_for_address_selection(callback.message, callback.from_user.id)
        return
    
    if delivery_type == 'pickup':
        # Skip pickup location check since it will be assigned with driver
        pass
    
    # Create final order via API with actual delivery fee
    order_data = {
        'customer_id': callback.from_user.id,
        'items': data.get('items', []),
        'subtotal_cents': data.get('subtotal_cents', 0),
        'delivery_fee_cents': data.get('delivery_fee_cents', 0),
        'total_cents': data.get('total_cents', 0),
        'delivery_or_pickup': delivery_type,
        'payment_type': payment_method
    }
    
    # Add address information for delivery orders
    if data.get('delivery_type') == 'delivery':
        order_data['delivery_address_text'] = data.get('delivery_address')
        if data.get('delivery_address_id'):
            order_data['delivery_address_id'] = data.get('delivery_address_id')
    else: # pickup
        order_data['pickup_address_id'] = data.get('pickup_address_id')
        order_data['pickup_address_text'] = data.get('pickup_address_text')
    
    # Add customer phone if available
    if data.get('phone'):
        order_data['phone'] = data.get('phone')
    
    # Add notes if any
    if data.get('notes'):
        order_data['notes'] = data.get('notes')
    
    try:
        # Ensure customer exists
        customer_data = {
            'telegram_id': callback.from_user.id,
            'phone': data.get('phone', '')
        }
        await api_client.create_customer(customer_data)
        
        # Create final order with actual delivery fee
        result = await api_client.create_order(order_data)
    
        if result:
            order_number = result['order_number']
            payment_url = result.get('payment_url')
            needs_confirmation = result.get('needs_confirmation', False)
            
            # Generate appropriate confirmation message
            message_text = await generate_order_confirmation(data, order_number, payment_method, 
                                                           result.get('delivery_fee', 0), 
                                                           payment_url, needs_confirmation)
            await callback.message.answer(message_text)
            
            # If BTC payment, show additional instructions
            if payment_method == 'btc' and payment_url:
                await callback.message.answer(
                    f"🔗 <b>BTC Payment URL:</b>\n"
                    f"<code>{payment_url}</code>\n\n"
                    f"Please complete your payment using the link above. "
                    f"Your order will be processed once payment is confirmed.",
                    parse_mode="HTML"
                )
        else:
            await callback.message.answer(
                "❌ Failed to create order. This may be due to inventory changes or system error. "
                "Please try again or contact support."
            )
        
        await state.clear()
        
    except Exception as e:
        logger.error(f"Error creating order: {e}")
        await callback.message.answer(
            f"❌ Error creating order: {str(e)}\n\n"
            "Please try again or contact support."
        )

async def handle_pickup_notification(order_number: str, driver_id: int, message: Message):
    """Handle pickup address notification when driver is assigned"""
    try:
        # Get driver's pickup address from API
        driver_data = await api_client.get_driver_pickup_address(driver_id)
        if not driver_data or 'pickup_address' not in driver_data:
            return
            
        pickup_address = driver_data['pickup_address']
        driver_name = driver_data.get('name', 'Your driver')
        
        # Send notification with pickup details
        await message.answer(
            f"🎉 <b>Pickup Details Updated!</b>\n\n"
            f"Order #{order_number} has been assigned to {driver_name}.\n\n"
            f"📍 <b>Pickup Location:</b>\n"
            f"<b>{pickup_address['name']}</b>\n"
            f"{pickup_address['address']}\n\n"
            f"🕐 Please come to this location at your selected pickup time.\n"
            f"📱 {driver_name} will be your pickup contact.\n\n"
            f"ℹ️ <b>Additional Instructions:</b>\n"
            f"{pickup_address.get('instructions', 'No special instructions')}",
            parse_mode="HTML"
        )
    except Exception as e:
        logger.error(f"Error sending pickup notification: {e}")

async def generate_order_confirmation(data: dict, order_number: str, payment_method: str, 
                                   actual_delivery_fee: float, payment_url: str = None, 
                                   needs_confirmation: bool = False) -> str:
    """Generate order confirmation message with new format"""
    delivery_type = data.get('delivery_type', 'delivery')
    address = data.get('delivery_address', 'Not specified')
    subtotal = data.get('subtotal_cents', 0) / 100
    delivery_fee = actual_delivery_fee
    total = data.get('total_cents', 0) / 100
    
    # Format payment method name
    payment_method_name = {
        'btc': 'Bitcoin',
        'cash': 'Cash',
        'apple_cash': 'Apple Cash',
        'cashapp': 'Cash App'
    }.get(payment_method, payment_method.upper())
    
    # Build the message in the new format
    message = f"🎉 <b>Order #{order_number} Placed Successfully!</b>\n\n"
    message += f"📦 <b>Type:</b> {delivery_type.capitalize()}\n"
    message += f"💰 <b>Subtotal:</b> ${subtotal:.2f}\n"
    
    if delivery_type == 'delivery':
        message += f"🚚 <b>Delivery Fee (Flat Rate):</b> ${delivery_fee:.2f}\n"
        message += f"📍 <b>Delivery Address:</b>\n{address}\n\n"
    
    message += f"💵 <b>Total Amount:</b> ${total:.2f}\n"
    message += f"💳 <b>Payment Method:</b> {payment_method_name}\n"
    
    if delivery_type == 'delivery':
        message += f"📍 <b>Delivery Address:</b>\n{address}\n\n"
    
    message += "⏳ <b>Payment Status:</b> Awaiting payment approval\n\n"
    message += "Your order has been placed! \n\n"
    message += "<b>ORDER WILL NOT BE HANDED OVER OR DROPPED OFF WITHOUT PAYMENT CONFIRMATION UNLESS PAYING CASH OR YOU ASKED @HWCUSTOMERSERVICE DIRECTLY FOR A FRONT ! NO EXCEPTIONS! YOU WILL RECEIVE A NOTIFICATION WHEN THE PAYMENT HAS BEEN RECEIVED!</b> \n\n"
    message += "CONTACT @HWDISPATCH for questions regarding delivery.\n\n"
    message += "We'll notify you when your order is assigned to a driver! 🚀"
    
    return message

@router.message(OrderStates.waiting_for_phone, F.contact)
async def process_phone_contact(message: Message, state: FSMContext):
    """Process phone contact sharing"""
    phone = message.contact.phone_number
    is_valid, formatted_phone = validate_phone(phone)
    
    if not is_valid:
        await message.answer("Please provide a valid phone number:")
        return
    
    # Save customer to API
    await api_client.create_customer({
        'telegram_id': message.from_user.id,
        'phone': formatted_phone
    })
    
    await state.update_data(phone=formatted_phone)
    
    # Check delivery type and handle next step
    data = await state.get_data()
    delivery_type = data.get('delivery_type')
    
    if delivery_type == 'delivery':
        await state.set_state(OrderStates.waiting_for_address)
        await ask_for_address_selection(message, message.from_user.id)
    else:
        # For pickup, show instructions and go to menu
        await show_pickup_instructions(message, state)

@router.message(OrderStates.waiting_for_phone)
async def process_phone_text(message: Message, state: FSMContext):
    """Handle manual phone input"""
    phone = message.text
    is_valid, formatted_phone = validate_phone(phone)
    
    if not is_valid:
        await message.answer("Please provide a valid phone number or use the share button:")
        return
    
    # Save customer to API
    await api_client.create_customer({
        'telegram_id': message.from_user.id,
        'phone': formatted_phone
    })
    
    await state.update_data(phone=formatted_phone)
    
    # Check delivery type and handle next step
    data = await state.get_data()
    delivery_type = data.get('delivery_type')
    
    if delivery_type == 'delivery':
        await state.set_state(OrderStates.waiting_for_address)
        await ask_for_address_selection(message, message.from_user.id)
    else:
        # For pickup, show instructions and go to menu
        await show_pickup_instructions(message, state)

async def show_cart_review(callback: CallbackQuery, state: FSMContext):
    """Show cart review with management options"""
    data = await state.get_data()
    cart_items = data.get('items', [])
    
    if not cart_items:
        await callback.message.answer(
            "🛒 Your cart is empty!\n\n"
            "Please add some items before finishing your order.",
            reply_markup=get_main_menu()
        )
        return
    
    # Display cart summary with management options
    cart_text = await generate_cart_summary(cart_items)
    await callback.message.answer(
        f"🛒 Review Your Order:\n\n{cart_text}\n\n"
        "You can remove items or proceed to checkout:",
        reply_markup=get_cart_keyboard(cart_items)
    )

@router.message(F.text == "🛒 Review Cart")
async def review_cart(message: Message, state: FSMContext):
    """Show current cart contents with management options"""
    data = await state.get_data()
    cart_items = data.get('items', [])
    
    if not cart_items:
        await message.answer(
            "🛒 Your cart is empty!\n\n"
            "Use the 🛍️ Order button to start adding items.",
            reply_markup=get_main_menu()
        )
        return
    
    # Display cart summary
    cart_text = await generate_cart_summary(cart_items)
    await message.answer(
        f"🛒 Your Cart:\n\n{cart_text}\n\n"
        "You can remove items or continue shopping:",
        reply_markup=get_cart_keyboard(cart_items)
    )

async def generate_cart_summary(cart_items):
    """Generate formatted cart summary text"""
    if not cart_items:
        return "🛒 Your cart is empty!"
    
    summary = "🛒 Your Cart:\n\n"
    total = 0

    for item in cart_items:
        quantity = item.get('quantity', 1)
        item_total = item['price_cents'] * quantity
        total += item_total
        summary += f"• {item['name']} x{quantity} - ${item_total / 100:.2f}\n"
    
    summary += f"\n💰 Total: ${total / 100:.2f}"
    return summary

@router.callback_query(F.data.startswith("remove:"))
async def remove_cart_item(callback: CallbackQuery, state: FSMContext):
    """Remove specific item from cart"""
    try:
        item_index = int(callback.data.split(":")[1])
        data = await state.get_data()
        cart_items = data.get('items', [])
        
        if 0 <= item_index < len(cart_items):
            removed_item = cart_items.pop(item_index)
            await state.update_data(items=cart_items)
            
            await callback.answer(f"✅ Removed {removed_item['name']} from cart")
            
            # Update the cart display
            if cart_items:
                cart_text = await generate_cart_summary(cart_items)
                await callback.message.edit_text(
                    cart_text,
                    reply_markup=get_cart_keyboard(cart_items)
                )
            else:
                await callback.message.edit_text(
                    "🛒 Your cart is now empty!\n\n"
                    "Use the 🛍️ Order button to start adding items."
                )
        else:
            await callback.answer("❌ Item not found in cart")
            
    except Exception as e:
        logger.error(f"Error removing cart item: {e}")
        await callback.answer("❌ Error removing item")

@router.callback_query(F.data.startswith("cart:"))
async def handle_cart_actions(callback: CallbackQuery, state: FSMContext):
    """Handle cart action buttons"""
    action = callback.data.split(":")[1]
    
    if action == "continue":
        # Continue shopping - show categories
        await callback.message.delete()
        await show_menu_categories_handler(callback.message, state)
        
    elif action == "checkout":
        # Proceed to checkout (original order finish flow)
        await callback.message.delete()
        await process_order_finish(callback, state)
        
    elif action == "clear":
        # Ask for confirmation to clear cart
        await callback.message.answer(
            "🗑️ Are you sure you want to clear your entire cart?",
            reply_markup=get_cart_confirmation_keyboard()
        )

@router.callback_query(F.data.startswith("clear:"))
async def handle_clear_confirmation(callback: CallbackQuery, state: FSMContext):
    """Handle cart clearance confirmation"""
    action = callback.data.split(":")[1]
    
    if action == "confirm":
        # Clear the cart
        await state.update_data(items=[])
        await callback.message.edit_text(
            "🗑️ Your cart has been cleared!\n\n"
            "Use the 🛍️ Order button to start adding new items."
        )
    else:
        # Cancel clearance - show cart again
        data = await state.get_data()
        cart_items = data.get('items', [])
        
        if cart_items:
            cart_text = await generate_cart_summary(cart_items)
            await callback.message.edit_text(
                cart_text,
                reply_markup=get_cart_keyboard(cart_items)
            )
        else:
            await callback.message.edit_text(
                "🛒 Your cart is empty!\n\n"
                "Use the 🛍️ Order button to start adding items."
            )

@router.message(F.text == "📞 Contact Support")
async def contact_support(message: Message):
    """Handle contact support button - provide admin contact info"""
    # Check if customer exists in API
    contact_settings = await api_client.get_welcome_message()

    if not contact_settings:
        await message.answer(
            "⚠️ <b>Contact support is currently disabled.</b>\n\n"
            "Please try again later or check back soon.",
            parse_mode="HTML"
        )
        return
    admin_user_id = contact_settings.get('telegram_id', '')
    admin_username = contact_settings.get('telegram_username', '')
    admin_phone = contact_settings.get('phone_number', '')
    admin_email = contact_settings.get('email_address', '')
    admin_additional_info = contact_settings.get('additional_info', '')
    
    contact_message = "📞 <b>Contact Support</b>\n\n"
    
    if admin_username:
        # If admin has a username, provide a direct link
        contact_message += f"💬 <b>Direct Message:</b>\n"
        contact_message += f"👉 <a href='https://t.me/{admin_username}'>Message Admin</a>\n\n"
        contact_message += f"📱 <b>Username:</b> @{admin_username}\n\n"
    elif admin_user_id:
        # If only user ID is available
        contact_message += f"📱 <b>Admin User ID:</b> {admin_user_id}\n\n"
        contact_message += "Please send a message directly to the admin.\n\n"
    else:
        # Fallback if no admin contact info is configured
        contact_message += "⚠️ <b>Admin contact information not configured.</b>\n\n"
        contact_message += "Please try again later or check back soon.\n\n"
        await message.answer(contact_message, parse_mode="HTML")
        return
    
    contact_message += f"📞 <b>Phone:</b> {admin_phone if admin_phone else 'Not provided'}\n"
    contact_message += f"📧 <b>Email:</b> {admin_email if admin_email else 'Not provided'}\n"
    contact_message += f"ℹ️ <b>Additional Info:</b>\n{admin_additional_info if admin_additional_info else 'N/A'}\n\n"
    
    contact_message += "💡 <i>Click the link above to start a conversation with our support team.</i>"
    
    await message.answer(contact_message, parse_mode="HTML", disable_web_page_preview=True)

def register_customer_handlers(dp):
    dp.include_router(router)
