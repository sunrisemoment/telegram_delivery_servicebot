from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from . import models


def log_audit_event(
    db: Session,
    *,
    action: str,
    actor_type: str = "system",
    actor_username: str | None = None,
    actor_customer_id: int | None = None,
    entity_type: str | None = None,
    entity_id: str | int | None = None,
    payload: dict[str, Any] | None = None,
) -> models.AuditLog:
    event = models.AuditLog(
        actor_type=actor_type,
        actor_username=actor_username,
        actor_customer_id=actor_customer_id,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        payload=payload or {},
    )
    db.add(event)
    return event
