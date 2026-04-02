from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, ReplyKeyboardMarkup, KeyboardButton
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
import logging

from ..api_client import api_client

logger = logging.getLogger(__name__)

router = Router()

class RoleSelection(StatesGroup):
    waiting_for_role = State()

def get_role_selection_keyboard():
    """Keyboard for selecting customer or driver role"""
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="👤 I'm a Customer"), KeyboardButton(text="🚗 I'm a Driver")],
            [KeyboardButton(text="ℹ️ Help")]
        ],
        resize_keyboard=True,
        one_time_keyboard=True
    )

def get_driver_main_keyboard():
    """Main keyboard for drivers"""
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="📦 My Orders"), KeyboardButton(text="🔄 Refresh")],
            [KeyboardButton(text="🟢 Go Online"), KeyboardButton(text="⚪ Go Offline")],
            [KeyboardButton(text="ℹ️ Driver Help"), KeyboardButton(text="👤 Switch to Customer")]
        ],
        resize_keyboard=True
    )

def get_customer_main_keyboard():
    """Main keyboard for customers (existing one)"""
    from ..keyboards import get_main_menu
    return get_main_menu()

@router.message(Command("start"))
async def cmd_start(message: Message, state: FSMContext):
    """Start command with role selection"""
    await state.clear()
    
    await message.answer(
        "👋 Welcome to Delivery Service!\n\n"
        "Please select your role to continue:",
        reply_markup=get_role_selection_keyboard()
    )
    await state.set_state(RoleSelection.waiting_for_role)

@router.message(RoleSelection.waiting_for_role, F.text == "👤 I'm a Customer")
async def select_customer_role(message: Message, state: FSMContext):
    """User selects customer role"""
    await state.clear()
    
    # Import customer start handler
    from .customer import cmd_start as customer_start
    await customer_start(message)

@router.message(RoleSelection.waiting_for_role, F.text == "🚗 I'm a Driver")
async def select_driver_role(message: Message, state: FSMContext):
    """User selects driver role"""
    await state.clear()
    
    # Register driver if not already registered
    driver_data = {
        'telegram_id': message.from_user.id,
        'name': f"{message.from_user.first_name} {message.from_user.last_name or ''}".strip()
    }
    
    result = await api_client.register_driver(driver_data)
    
    if result:
        await message.answer(
            "🚗 Driver mode activated!\n\n"
            "You can now:\n"
            "• View assigned orders\n"
            "• Update order status\n"
            "• Receive order notifications\n\n"
            "Use the buttons below to get started:",
            reply_markup=get_driver_main_keyboard()
        )
    else:
        await message.answer(
            "❌ Failed to activate driver mode. Please try again or contact support.",
            reply_markup=get_role_selection_keyboard()
        )

@router.message(F.text == "👤 Switch to Customer")
async def switch_to_customer(message: Message, state: FSMContext):
    """Switch from driver to customer mode"""
    await state.clear()
    await select_customer_role(message, state)

@router.message(F.text == "ℹ️ Help")
async def show_help(message: Message):
    """Show help information"""
    await message.answer(
        "🤖 Delivery Bot Help\n\n"
        "Select your role:\n"
        "• 👤 Customer - Place orders and track deliveries\n"
        "• 🚗 Driver - Manage assigned orders and updates\n\n"
        "Use /start to change your role at any time."
    )

@router.message(F.text == "ℹ️ Driver Help")
async def show_driver_help(message: Message):
    """Show driver-specific help"""
    await message.answer(
        "🚗 Driver Help\n\n"
        "Available Commands:\n"
        "• /start - Change role\n"
        "• /orders - View assigned orders\n"
        "• /outside_ORDER# - Mark order as out for delivery\n"
        "• /complete_ORDER# - Mark order as delivered\n"
        "• /status_ORDER# - Check order status\n\n"
        "You'll receive notifications when new orders are assigned to you.\n"
        "Click the commands in notifications to quickly update status."
    )

@router.message(F.text == "📦 My Orders")
async def driver_my_orders(message: Message):
    """Driver clicks 'My Orders' button"""
    from .driver import view_driver_orders
    await view_driver_orders(message)

@router.message(F.text == "🔄 Refresh")
async def driver_refresh(message: Message):
    """Driver clicks 'Refresh' button"""
    from .driver import view_driver_orders
    await view_driver_orders(message)


@router.message(F.text == "🟢 Go Online")
async def go_online(message: Message):
    driver = await api_client.get_driver_by_telegram_id(message.from_user.id)
    if not driver:
        await message.answer("❌ You are not registered as a driver.")
        return

    result = await api_client.update_driver_availability(driver['id'], True)
    if result:
        await message.answer("🟢 You are now online and can receive dispatches.")
    else:
        await message.answer("❌ Failed to update your availability.")


@router.message(F.text == "⚪ Go Offline")
async def go_offline(message: Message):
    driver = await api_client.get_driver_by_telegram_id(message.from_user.id)
    if not driver:
        await message.answer("❌ You are not registered as a driver.")
        return

    result = await api_client.update_driver_availability(driver['id'], False)
    if result:
        await message.answer("⚪ You are now offline and will be skipped for new dispatches.")
    else:
        await message.answer("❌ Failed to update your availability.")

def register_role_handlers(dp):
    dp.include_router(router)
