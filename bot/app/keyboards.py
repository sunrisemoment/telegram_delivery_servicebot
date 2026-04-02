import os

from aiogram.types import ReplyKeyboardMarkup, KeyboardButton, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo


def _get_mini_app_url():
    mini_app_url = os.getenv("MINI_APP_URL")
    if mini_app_url:
        return mini_app_url.rstrip("/")

    api_base_url = os.getenv("API_BASE_URL", "http://localhost:8000").rstrip("/")
    return f"{api_base_url}/miniapp"

def get_main_menu():
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="📱 Open Mini App", web_app=WebAppInfo(url=_get_mini_app_url()))],
            [KeyboardButton(text="🛍️ Order"), KeyboardButton(text="🛒 Review Cart")],
            [KeyboardButton(text="📞 Contact Support")]
        ],
        resize_keyboard=True
    )

def get_delivery_type_keyboard():
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="🚚 Delivery", callback_data="order:delivery"),
                InlineKeyboardButton(text="🏃 Pickup", callback_data="order:pickup")
            ]
        ]
    )

def get_phone_keyboard():
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="📱 Share Phone", request_contact=True)]
        ],
        resize_keyboard=True
    )

def get_payment_methods_keyboard():
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="₿ Bitcoin", callback_data="payment:btc"),
                InlineKeyboardButton(text="💵 Cash", callback_data="payment:cash"),
            ],
            [
                InlineKeyboardButton(text="🍎 Apple Cash", callback_data="payment:apple_cash"),
                InlineKeyboardButton(text="💚 Cash App", callback_data="payment:cashapp"),
            ],
            [InlineKeyboardButton(text="⬅️ Back", callback_data="payment:back")]
        ]
    )

def get_slots_keyboard(slots):
    keyboard = []
    for slot in slots:
        keyboard.append([InlineKeyboardButton(text=slot["label"], callback_data=f"slot:{slot['utc']}")])
    
    # Add back button to timeslot selection
    keyboard.append([InlineKeyboardButton(text="⬅️ Back to Cart", callback_data="slot:back")])
    
    return InlineKeyboardMarkup(inline_keyboard=keyboard)

def get_category_items_keyboard(category: str):
    """Keyboard for category items with back button"""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="⬅️ Back to Categories", callback_data="category:back")],
            [InlineKeyboardButton(text="↩️ Back to Delivery Type", callback_data="category:back_to_delivery")]
        ]
    )

def get_cart_keyboard(cart_items):
    """Generate keyboard for cart management"""
    keyboard = []
    
    for index, item in enumerate(cart_items):
        item_text = f"❌ {item['name']} x{item.get('quantity', 1)}"
        keyboard.append([
            InlineKeyboardButton(
                text=item_text,
                callback_data=f"remove:{index}"
            )
        ])
    
    # Add action buttons
    keyboard.append([
        InlineKeyboardButton(text="➕ Continue Shopping", callback_data="cart:continue"),
        InlineKeyboardButton(text="✅ Checkout", callback_data="cart:checkout")
    ])
    
    keyboard.append([
        InlineKeyboardButton(text="🗑️ Clear Cart", callback_data="cart:clear")
    ])
    
    return InlineKeyboardMarkup(inline_keyboard=keyboard)

def get_cart_confirmation_keyboard():
    """Keyboard for confirming cart clearance"""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="✅ Yes, Clear Cart", callback_data="clear:confirm"),
                InlineKeyboardButton(text="❌ No, Keep Items", callback_data="clear:cancel")
            ]
        ]
    )

def get_menu_categories_keyboard():
    """Keyboard for menu categories with back button"""
    # This will be generated dynamically in show_menu_categories_handler
    # We'll add the back button there
    pass

def get_pickup_addresses_keyboard(pickup_addresses):
    """Keyboard for selecting pickup addresses"""
    keyboard = []
    for address in pickup_addresses:
        keyboard.append([
            InlineKeyboardButton(
                text=f"📍 {address['name']}: {address['address']}",
                callback_data=f"pickup_address:{address['id']}"
            )
        ])
    
    keyboard.append([InlineKeyboardButton(text="⬅️ Back", callback_data="pickup_address:back")])
    
    return InlineKeyboardMarkup(inline_keyboard=keyboard)
