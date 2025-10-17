from aiogram import Router, F
from aiogram.types import Message
from aiogram.filters import Command
import os

router = Router()
admin_ids = [int(x) for x in os.getenv("ADMIN_USER_IDS", "").split(",") if x]

@router.message(Command("set_delivery_min"), F.from_user.id.in_(admin_ids))
async def set_delivery_min(message: Message):
    try:
        args = message.text.split()
        if len(args) > 1:
            amount = int(args[1])
            await message.answer(f"Delivery minimum set to ${amount}")
        else:
            await message.answer("Usage: /set_delivery_min <amount>")
    except ValueError:
        await message.answer("Usage: /set_delivery_min <amount>")

@router.message(Command("assign_driver"), F.from_user.id.in_(admin_ids))
async def assign_driver(message: Message):
    args = message.text.split()
    if len(args) >= 3:
        order_number = args[1]
        driver_username = args[2]
        await message.answer(f"Driver {driver_username} assigned to order {order_number}")
    else:
        await message.answer("Usage: /assign_driver <order_number> <@driver_username>")

@router.message(Command("export_csv"), F.from_user.id.in_(admin_ids))
async def export_csv(message: Message):
    args = message.text.split()
    date_str = args[1] if len(args) > 1 else "today"
    await message.answer(f"CSV export for {date_str} initiated")

def register_admin_handlers(dp):
    dp.include_router(router)