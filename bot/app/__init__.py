# app/__init__.py
import asyncio
import logging

logger = logging.getLogger(__name__)

async def startup():
    """Initialize components on startup"""
    from .api_client import api_client
    # Pre-warm the API client session
    await api_client.ensure_session()
    logger.info("✅ API client pre-warmed")

async def shutdown():
    """Cleanup on shutdown"""
    from .api_client import api_client
    await api_client.close()
    logger.info("✅ API client closed")