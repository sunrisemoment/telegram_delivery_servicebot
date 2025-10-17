# [file name]: background_tasks.py
import asyncio
import logging
from datetime import datetime
from sqlalchemy.orm import Session
from .database import SessionLocal
from .inventory_service import get_inventory_service

logger = logging.getLogger(__name__)

async def cleanup_expired_reservations_task():
    """Background task to clean up expired reservations periodically"""
    while True:
        try:
            db = SessionLocal()
            try:
                inventory_service = get_inventory_service(db)
                cleaned_count = inventory_service.cleanup_expired_reservations()
                if cleaned_count > 0:
                    logger.info(f"Background task cleaned up {cleaned_count} expired reservations")
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Error in background cleanup task: {e}")
        
        # Run every 5 minutes
        await asyncio.sleep(300)  # 300 seconds = 5 minutes

# Start the background task when the application starts
async def start_background_tasks():
    asyncio.create_task(cleanup_expired_reservations_task())