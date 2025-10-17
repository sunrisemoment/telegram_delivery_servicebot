from aiogram import Router
from aiogram.types import Message
from aiogram.filters import Command

router = Router()

@router.message(Command("start_driver"))
async def start_driver(message: Message):
    await message.answer("Driver mode activated. You'll receive order assignments here.")

@router.message(Command("outside"))
async def driver_outside(message: Message):
    await message.answer("Status updated: I'm outside the delivery location")

def register_driver_handlers(dp):
    dp.include_router(router)