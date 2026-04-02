import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl

from dotenv import load_dotenv
from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from . import models
from .database import get_db

load_dotenv()

SESSION_TTL_HOURS = int(os.getenv("MINI_APP_SESSION_TTL_HOURS", "24"))
INIT_DATA_MAX_AGE_SECONDS = int(os.getenv("MINI_APP_INIT_DATA_MAX_AGE_SECONDS", "86400"))


def normalize_invite_code(code: str | None) -> str | None:
    if not code:
        return None
    normalized = "".join(char for char in code.upper().strip() if char.isalnum())
    return normalized or None


def build_customer_display_name(user: dict) -> str:
    first_name = (user.get("first_name") or "").strip()
    last_name = (user.get("last_name") or "").strip()
    full_name = " ".join(part for part in [first_name, last_name] if part).strip()
    if full_name:
        return full_name
    username = (user.get("username") or "").strip()
    if username:
        return f"@{username}"
    return f"Telegram User {user.get('id')}"


def validate_telegram_init_data(init_data: str, bot_token: str | None = None) -> dict:
    if not init_data:
        raise HTTPException(status_code=400, detail="init_data is required")

    token = bot_token or os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        raise HTTPException(status_code=500, detail="Telegram bot token is not configured")

    parsed = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = parsed.pop("hash", None)
    if not received_hash:
        raise HTTPException(status_code=400, detail="Telegram init_data hash is missing")

    auth_date = int(parsed.get("auth_date", "0") or 0)
    current_timestamp = int(datetime.now(timezone.utc).timestamp())
    if auth_date and current_timestamp - auth_date > INIT_DATA_MAX_AGE_SECONDS:
        raise HTTPException(status_code=401, detail="Telegram Mini App auth data has expired")

    data_check_string = "\n".join(
        f"{key}={parsed[key]}"
        for key in sorted(parsed.keys())
    )
    secret_key = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    calculated_hash = hmac.new(
        secret_key,
        data_check_string.encode(),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(calculated_hash, received_hash):
        raise HTTPException(status_code=401, detail="Telegram Mini App auth validation failed")

    user_payload = parsed.get("user")
    if not user_payload:
        raise HTTPException(status_code=400, detail="Telegram Mini App user payload is missing")

    try:
        parsed["user"] = json.loads(user_payload)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Telegram Mini App user payload is invalid") from exc

    parsed["hash"] = received_hash
    return parsed


def issue_miniapp_session(
    db: Session,
    customer: models.Customer,
    telegram_id: int,
    init_data_hash: str,
    start_param: str | None = None,
) -> models.MiniAppSession:
    now = datetime.now(timezone.utc)
    session = models.MiniAppSession(
        customer_id=customer.id,
        telegram_id=telegram_id,
        session_token=secrets.token_urlsafe(32),
        init_data_hash=init_data_hash,
        start_param=start_param,
        expires_at=now + timedelta(hours=SESSION_TTL_HOURS),
        last_seen_at=now,
    )
    customer.last_login_at = now
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def extract_miniapp_session_token(
    authorization: str | None = Header(default=None),
    x_miniapp_session: str | None = Header(default=None),
) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        if token:
            return token
    if x_miniapp_session:
        return x_miniapp_session.strip()
    raise HTTPException(status_code=401, detail="Mini App session token is required")


def get_current_miniapp_session(
    session_token: str = Depends(extract_miniapp_session_token),
    db: Session = Depends(get_db),
) -> models.MiniAppSession:
    now = datetime.now(timezone.utc)
    session = db.query(models.MiniAppSession).filter(
        models.MiniAppSession.session_token == session_token,
        models.MiniAppSession.revoked_at.is_(None),
        models.MiniAppSession.expires_at > now,
    ).first()
    if not session:
        raise HTTPException(status_code=401, detail="Mini App session is invalid or expired")

    session.last_seen_at = now
    if session.customer:
        session.customer.last_login_at = now
    db.commit()
    return session


def get_current_miniapp_customer(
    session: models.MiniAppSession = Depends(get_current_miniapp_session),
) -> models.Customer:
    if not session.customer:
        raise HTTPException(status_code=401, detail="Mini App customer session is invalid")
    return session.customer
