# main.py - COMPLETELY FIXED VERSION FOR WINDOWS
import asyncio
import os
import logging
import sys
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.client.session.aiohttp import AiohttpSession
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

load_dotenv()
TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
if not TOKEN:
    raise ValueError("❌ TELEGRAM_BOT_TOKEN environment variable is not set!")

async def main():
    """Main bot function with proper cleanup"""
    session = None
    try:
        # Create session
        session = AiohttpSession(timeout=30.0)
        
        bot = Bot(
            token=TOKEN,
            default=DefaultBotProperties(parse_mode=ParseMode.HTML),
            session=session
        )

        # Test connection
        try:
            me = await bot.get_me()
            logger.info(f"✅ Bot connected: {me.full_name} (@{me.username})")
        except Exception as e:
            logger.error(f"❌ Failed to connect bot: {e}")
            return

        # Setup storage and dispatcher
        storage = MemoryStorage()
        dp = Dispatcher(storage=storage)

        # Import and register handlers
        try:
            from app.handlers.role_selection import register_role_handlers
            from app.handlers.customer import register_customer_handlers
            from app.handlers.admin import register_admin_handlers
            from app.handlers.driver import register_driver_handlers

            register_role_handlers(dp)
            register_customer_handlers(dp)
            register_admin_handlers(dp)
            register_driver_handlers(dp)
            logger.info("✅ All handlers registered successfully")
        except ImportError as e:
            logger.error(f"❌ Handler import error: {e}")
            return

        # Start polling
        logger.info("🤖 Bot started polling...")
        await dp.start_polling(bot)
        
    except Exception as e:
        logger.error(f"Bot error: {e}")
    finally:
        # Proper cleanup
        if session:
            await session.close()
        logger.info("✅ Bot shutdown complete")

def run_bot():
    """Run bot with proper event loop handling for Windows"""
    if sys.platform == 'win32':
        # Windows-specific event loop policy
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("🛑 Bot stopped by user")
    except Exception as e:
        logger.error(f"🛑 Bot crashed: {e}")
    finally:
        # Ensure all tasks are properly cancelled
        tasks = asyncio.all_tasks()
        for task in tasks:
            task.cancel()
        
        # Give tasks a chance to clean up
        try:
            asyncio.run(asyncio.sleep(0.1))
        except:
            pass

if __name__ == "__main__":
    run_bot()