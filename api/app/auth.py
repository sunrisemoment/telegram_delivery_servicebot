from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import struct
import time
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import (
    HTTPAuthorizationCredentials,
    HTTPBasic,
    HTTPBasicCredentials,
    HTTPBearer,
)
from sqlalchemy.orm import Session

from . import models
from .database import get_db

basic_security = HTTPBasic(auto_error=False)
bearer_security = HTTPBearer(auto_error=False)

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
ADMIN_TOTP_SECRET = os.getenv("ADMIN_TOTP_SECRET", "").strip()
ADMIN_SESSION_HOURS = int(os.getenv("ADMIN_SESSION_HOURS", "12") or "12")


def _normalize_totp_secret(secret: str) -> bytes:
    normalized = secret.replace(" ", "").upper()
    padding = "=" * ((8 - len(normalized) % 8) % 8)
    return base64.b32decode(normalized + padding, casefold=True)


def verify_totp_code(secret: str, code: str, *, window: int = 1) -> bool:
    normalized_code = "".join(char for char in str(code or "") if char.isdigit())
    if len(normalized_code) != 6:
        return False

    key = _normalize_totp_secret(secret)
    current_counter = int(time.time() // 30)
    for offset in range(-window, window + 1):
        counter = current_counter + offset
        message = struct.pack(">Q", counter)
        digest = hmac.new(key, message, hashlib.sha1).digest()
        index = digest[-1] & 0x0F
        binary = struct.unpack(">I", digest[index:index + 4])[0] & 0x7FFFFFFF
        candidate = str(binary % 1_000_000).zfill(6)
        if secrets.compare_digest(candidate, normalized_code):
            return True
    return False


def authenticate_admin_credentials(username: str, password: str, totp_code: str | None = None) -> str:
    correct_username = secrets.compare_digest(username, ADMIN_USERNAME)
    correct_password = secrets.compare_digest(password, ADMIN_PASSWORD)
    if not (correct_username and correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )

    if ADMIN_TOTP_SECRET and not verify_totp_code(ADMIN_TOTP_SECRET, totp_code or ""):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid TOTP code is required",
        )

    return username


def verify_admin_credentials(credentials: HTTPBasicCredentials = Depends(HTTPBasic())):
    return authenticate_admin_credentials(credentials.username, credentials.password)


def _resolve_admin_session_hours(db: Session) -> int:
    settings = db.query(models.Settings).first()
    configured_hours = getattr(settings, "admin_session_hours", None) if settings else None
    hours = int(configured_hours or ADMIN_SESSION_HOURS or 12)
    return max(hours, 1)


def create_admin_session(
    db: Session,
    username: str,
    request: Request | None = None,
) -> models.AdminSession:
    now = datetime.now(timezone.utc)
    session = models.AdminSession(
        username=username,
        session_token=secrets.token_urlsafe(48),
        ip_address=request.client.host if request and request.client else None,
        user_agent=request.headers.get("user-agent") if request else None,
        expires_at=now + timedelta(hours=_resolve_admin_session_hours(db)),
        last_seen_at=now,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def revoke_admin_session(db: Session, session: models.AdminSession) -> None:
    session.revoked_at = datetime.now(timezone.utc)
    db.commit()


def _resolve_bearer_session(
    db: Session,
    token: str,
) -> models.AdminSession | None:
    now = datetime.now(timezone.utc)
    session = db.query(models.AdminSession).filter(
        models.AdminSession.session_token == token,
        models.AdminSession.revoked_at.is_(None),
    ).first()
    if not session:
        return None
    if session.expires_at <= now:
        session.revoked_at = now
        db.commit()
        return None
    session.last_seen_at = now
    db.commit()
    db.refresh(session)
    return session


def get_current_admin_actor(
    request: Request,
    db: Session = Depends(get_db),
    bearer_credentials: HTTPAuthorizationCredentials | None = Depends(bearer_security),
    basic_credentials: HTTPBasicCredentials | None = Depends(basic_security),
) -> dict:
    if bearer_credentials and bearer_credentials.credentials:
        session = _resolve_bearer_session(db, bearer_credentials.credentials)
        if not session:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Admin session is invalid or expired",
            )
        return {
            "username": session.username,
            "auth_type": "session",
            "session_id": session.id,
            "session": session,
            "ip_address": request.client.host if request.client else None,
            "user_agent": request.headers.get("user-agent"),
        }

    if basic_credentials:
        username = authenticate_admin_credentials(
            basic_credentials.username,
            basic_credentials.password,
        )
        return {
            "username": username,
            "auth_type": "basic",
            "session_id": None,
            "session": None,
            "ip_address": request.client.host if request.client else None,
            "user_agent": request.headers.get("user-agent"),
        }

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Admin authentication required",
    )


def get_current_admin(
    actor: dict = Depends(get_current_admin_actor),
) -> str:
    return actor["username"]
