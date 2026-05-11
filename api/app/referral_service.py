from __future__ import annotations

import os
import random
import csv
from datetime import datetime, timezone
from io import StringIO
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models

REFERRAL_INVITE_KIND = "referral"
BULK_REFERRAL_INVITE_KIND = "bulk_referral"
FRIEND_DISCOUNT_CENTS = 2500
REFERRER_CREDIT_CENTS = 1500
REFERRAL_BONUS_THRESHOLD = 3
REFERRAL_BONUS_CENTS = 2500
REFERRAL_QUALIFYING_SUBTOTAL_CENTS = 10000

_INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def normalize_invite_kind(invite_kind: str | None) -> str:
    normalized = (invite_kind or "").strip().lower().replace("-", "_")
    if normalized in {REFERRAL_INVITE_KIND, BULK_REFERRAL_INVITE_KIND}:
        return normalized
    return "direct"


def is_referral_invite(invite: models.CustomerInvite | None) -> bool:
    return bool(invite and normalize_invite_kind(getattr(invite, "invite_kind", None)) in {REFERRAL_INVITE_KIND, BULK_REFERRAL_INVITE_KIND})


def generate_referral_code(db: Session, *, length: int = 8) -> str:
    while True:
        code = "".join(random.choice(_INVITE_ALPHABET) for _ in range(length))
        existing = db.query(models.CustomerInvite).filter(models.CustomerInvite.code == code).first()
        if not existing:
            return code


def build_invite_link(code: str | None) -> str | None:
    normalized_code = (code or "").strip()
    if not normalized_code:
        return None

    base_url = (os.getenv("MINI_APP_URL") or "").strip()
    if not base_url:
        api_base_url = (os.getenv("API_BASE_URL") or "").strip().rstrip("/")
        if api_base_url:
            base_url = f"{api_base_url}/miniapp"
    if not base_url:
        return None

    parts = urlsplit(base_url)
    query_items = dict(parse_qsl(parts.query, keep_blank_values=True))
    query_items["startapp"] = normalized_code
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query_items), parts.fragment))


def get_referral_by_invite(db: Session, invite_id: int | None) -> models.Referral | None:
    if not invite_id:
        return None
    return db.query(models.Referral).filter(models.Referral.invite_id == invite_id).first()


def get_customer_referral(db: Session, customer: models.Customer | None) -> models.Referral | None:
    if not customer:
        return None
    return db.query(models.Referral).filter(
        models.Referral.referred_customer_id == customer.id,
    ).order_by(models.Referral.created_at.desc()).first()


def ensure_referral_for_invite(
    db: Session,
    invite: models.CustomerInvite,
    *,
    referrer_customer_id: int | None = None,
    note: str | None = None,
) -> models.Referral:
    referral = get_referral_by_invite(db, invite.id)
    if referral:
        if referrer_customer_id and not referral.referrer_customer_id:
            referral.referrer_customer_id = referrer_customer_id
        if note and not referral.notes:
            referral.notes = note
        return referral

    referral = models.Referral(
        referrer_customer_id=referrer_customer_id,
        invite_id=invite.id,
        status="created",
        reward_status="pending" if referrer_customer_id else "not_applicable",
        notes=note or invite.notes,
        friend_discount_cents=FRIEND_DISCOUNT_CENTS,
        referrer_credit_cents=REFERRER_CREDIT_CENTS,
    )
    db.add(referral)
    db.flush()
    return referral


def mark_referral_signed_up(
    db: Session,
    invite: models.CustomerInvite,
    customer: models.Customer,
) -> models.Referral | None:
    if not is_referral_invite(invite):
        customer.approval_status = "approved"
        return None

    referral = ensure_referral_for_invite(
        db,
        invite,
        referrer_customer_id=invite.created_by if normalize_invite_kind(invite.invite_kind) == REFERRAL_INVITE_KIND else None,
        note=invite.notes,
    )
    referral.referred_customer_id = customer.id
    referral.claimed_at = utcnow()
    referral.signed_up_at = referral.signed_up_at or referral.claimed_at
    referral.status = "signed_up"
    customer.approval_status = "pending"
    return referral


def mark_referral_awaiting_approval(referral: models.Referral | None) -> models.Referral | None:
    if not referral:
        return None
    if referral.status in {"created", "signed_up"}:
        referral.status = "awaiting_admin_approval"
    return referral


def approve_referral(
    referral: models.Referral,
    customer: models.Customer | None,
    *,
    admin_username: str,
    note: str | None = None,
) -> models.Referral:
    referral.status = "approved"
    referral.approved_at = utcnow()
    referral.approved_by = admin_username
    referral.rejected_at = None
    referral.rejected_by = None
    if note is not None:
        referral.approval_note = note
    if referral.referrer_customer_id:
        referral.reward_status = "pending"
    elif referral.reward_status == "rejected":
        referral.reward_status = "not_applicable"

    if customer:
        customer.approval_status = "approved"
        if customer.account_status == "rejected":
            customer.account_status = "active"
    return referral


def reject_referral(
    referral: models.Referral,
    customer: models.Customer | None,
    *,
    admin_username: str,
    note: str | None = None,
) -> models.Referral:
    referral.status = "rejected"
    referral.rejected_at = utcnow()
    referral.rejected_by = admin_username
    if note is not None:
        referral.approval_note = note
    referral.reward_status = "rejected"
    if customer:
        customer.approval_status = "rejected"
        customer.account_status = "rejected"
    return referral


def _reward_statuses_for_balance() -> tuple[str, ...]:
    return ("available", "issued")


def get_referral_progress(db: Session, customer_id: int) -> dict:
    successful_referrals = db.query(models.Referral).filter(
        models.Referral.referrer_customer_id == customer_id,
        models.Referral.reward_status == "issued",
    ).count()

    available_credit_cents = db.query(func.coalesce(func.sum(models.ReferralReward.amount_cents), 0)).filter(
        models.ReferralReward.recipient_customer_id == customer_id,
        models.ReferralReward.status.in_(_reward_statuses_for_balance()),
    ).scalar() or 0

    if successful_referrals < REFERRAL_BONUS_THRESHOLD:
        next_bonus_target = REFERRAL_BONUS_THRESHOLD
    else:
        next_bonus_target = ((successful_referrals // REFERRAL_BONUS_THRESHOLD) + 1) * REFERRAL_BONUS_THRESHOLD

    return {
        "successful_referrals": successful_referrals,
        "available_credit_cents": int(available_credit_cents),
        "next_bonus_target": next_bonus_target,
        "next_bonus_remaining": max(next_bonus_target - successful_referrals, 0),
        "next_bonus_amount_cents": REFERRAL_BONUS_CENTS,
    }


def serialize_referral(referral: models.Referral) -> dict:
    invite = referral.invite
    referred_customer = referral.referred_customer
    referrer_customer = referral.referrer_customer
    batch = invite.referral_batch if invite else None
    qualifying_order = referral.qualifying_order
    reward_total_cents = sum((reward.amount_cents or 0) for reward in (referral.rewards or []))

    return {
        "id": referral.id,
        "invite_id": referral.invite_id,
        "invite_code": invite.code if invite else None,
        "invite_kind": normalize_invite_kind(invite.invite_kind if invite else None),
        "invite_link": build_invite_link(invite.code if invite else None),
        "campaign_tag": invite.campaign_tag if invite else None,
        "source_tag": invite.source_tag if invite else None,
        "batch_id": batch.id if batch else None,
        "batch_name": batch.name if batch else None,
        "referrer_customer_id": referral.referrer_customer_id,
        "referrer_name": referrer_customer.display_name if referrer_customer else None,
        "referred_customer_id": referral.referred_customer_id,
        "referred_name": referred_customer.display_name if referred_customer else None,
        "referred_phone": referred_customer.phone if referred_customer else None,
        "approval_status": referred_customer.approval_status if referred_customer else None,
        "status": referral.status,
        "reward_status": referral.reward_status,
        "notes": referral.notes,
        "approval_note": referral.approval_note,
        "qualifying_order_number": qualifying_order.order_number if qualifying_order else None,
        "friend_discount_cents": referral.friend_discount_cents,
        "referrer_credit_cents": referral.referrer_credit_cents,
        "reward_total_cents": reward_total_cents,
        "created_at": referral.created_at.isoformat() if referral.created_at else None,
        "signed_up_at": referral.signed_up_at.isoformat() if referral.signed_up_at else None,
        "claimed_at": referral.claimed_at.isoformat() if referral.claimed_at else None,
        "approved_at": referral.approved_at.isoformat() if referral.approved_at else None,
        "rejected_at": referral.rejected_at.isoformat() if referral.rejected_at else None,
        "qualifying_order_placed_at": referral.qualifying_order_placed_at.isoformat() if referral.qualifying_order_placed_at else None,
        "friend_discount_applied_at": referral.friend_discount_applied_at.isoformat() if referral.friend_discount_applied_at else None,
        "reward_issued_at": referral.reward_issued_at.isoformat() if referral.reward_issued_at else None,
    }


def serialize_referral_reward(reward: models.ReferralReward) -> dict:
    return {
        "id": reward.id,
        "recipient_customer_id": reward.recipient_customer_id,
        "recipient_name": reward.recipient_customer.display_name if reward.recipient_customer else None,
        "referral_id": reward.referral_id,
        "order_number": reward.order.order_number if reward.order else None,
        "reward_type": reward.reward_type,
        "milestone_number": reward.milestone_number,
        "amount_cents": reward.amount_cents,
        "status": reward.status,
        "notes": reward.notes,
        "issued_by": reward.issued_by,
        "issued_at": reward.issued_at.isoformat() if reward.issued_at else None,
        "created_at": reward.created_at.isoformat() if reward.created_at else None,
    }


def serialize_referral_batch(batch: models.ReferralBatch) -> dict:
    invites = list(getattr(batch, "invites", []) or [])
    claimed_count = sum(1 for invite in invites if invite.status == "claimed")
    return {
        "id": batch.id,
        "name": batch.name,
        "campaign_tag": batch.campaign_tag,
        "source_tag": batch.source_tag,
        "code_count": batch.code_count,
        "created_code_count": len(invites) or batch.code_count,
        "claimed_count": claimed_count,
        "notes": batch.notes,
        "created_by": batch.created_by,
        "created_by_name": batch.created_by_customer.display_name if batch.created_by_customer else None,
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
    }


def get_referral_discount_for_customer(
    db: Session,
    customer: models.Customer,
    *,
    subtotal_cents: int,
) -> dict | None:
    if subtotal_cents < REFERRAL_QUALIFYING_SUBTOTAL_CENTS:
        return None

    referral = get_customer_referral(db, customer)
    if not referral:
        return None
    if customer.approval_status != "approved":
        return None
    if referral.status not in {"approved", "qualified_order_placed", "reward_issued"}:
        return None
    if referral.friend_discount_order_id:
        return None

    discount_cents = min(int(referral.friend_discount_cents or FRIEND_DISCOUNT_CENTS), subtotal_cents)
    if discount_cents <= 0:
        return None

    return {
        "referral": referral,
        "discount_cents": discount_cents,
        "invite_code": referral.invite.code if referral.invite else None,
    }


def mark_qualifying_order_placed(referral: models.Referral, order: models.Order) -> models.Referral:
    now = utcnow()
    referral.friend_discount_order_id = referral.friend_discount_order_id or order.id
    referral.friend_discount_applied_at = referral.friend_discount_applied_at or now
    if not referral.qualifying_order_id:
        referral.qualifying_order_id = order.id
        referral.qualifying_order_placed_at = now
    referral.status = "qualified_order_placed"
    if referral.referrer_customer_id:
        referral.reward_status = "pending"
    return referral


def _successful_referral_reward_count(db: Session, recipient_customer_id: int) -> int:
    return db.query(models.ReferralReward).filter(
        models.ReferralReward.recipient_customer_id == recipient_customer_id,
        models.ReferralReward.reward_type == "referrer_credit",
        models.ReferralReward.status.in_(_reward_statuses_for_balance()),
    ).count()


def _ensure_milestone_bonus(
    db: Session,
    *,
    recipient_customer_id: int,
    successful_referral_count: int,
    issued_by: str | None,
) -> models.ReferralReward | None:
    if successful_referral_count <= 0 or successful_referral_count % REFERRAL_BONUS_THRESHOLD != 0:
        return None

    milestone_number = successful_referral_count // REFERRAL_BONUS_THRESHOLD
    existing = db.query(models.ReferralReward).filter(
        models.ReferralReward.recipient_customer_id == recipient_customer_id,
        models.ReferralReward.reward_type == "milestone_bonus",
        models.ReferralReward.milestone_number == milestone_number,
    ).first()
    if existing:
        return existing

    reward = models.ReferralReward(
        recipient_customer_id=recipient_customer_id,
        reward_type="milestone_bonus",
        milestone_number=milestone_number,
        amount_cents=REFERRAL_BONUS_CENTS,
        status="available",
        notes=f"Referral milestone bonus for {successful_referral_count} successful referrals",
        issued_by=issued_by,
        issued_at=utcnow(),
    )
    db.add(reward)
    db.flush()
    return reward


def evaluate_referral_rewards_for_order(
    db: Session,
    order: models.Order,
    *,
    actor_username: str | None = None,
) -> dict | None:
    customer = order.customer or db.query(models.Customer).filter(models.Customer.id == order.customer_id).first()
    if not customer:
        return None

    referral = get_customer_referral(db, customer)
    if not referral:
        return None
    if referral.status == "rejected" or customer.approval_status != "approved":
        return None
    if not order.payment_confirmed or order.status != "delivered":
        return None
    if order.subtotal_cents < REFERRAL_QUALIFYING_SUBTOTAL_CENTS:
        return None

    if not referral.qualifying_order_id:
        referral.qualifying_order_id = order.id
        referral.qualifying_order_placed_at = utcnow()

    created_rewards: list[models.ReferralReward] = []
    if referral.referrer_customer_id:
        reward = db.query(models.ReferralReward).filter(
            models.ReferralReward.referral_id == referral.id,
            models.ReferralReward.reward_type == "referrer_credit",
        ).first()
        if not reward:
            reward = models.ReferralReward(
                recipient_customer_id=referral.referrer_customer_id,
                referral_id=referral.id,
                order_id=order.id,
                reward_type="referrer_credit",
                amount_cents=int(referral.referrer_credit_cents or REFERRER_CREDIT_CENTS),
                status="available",
                notes=f"Referral reward for order {order.order_number}",
                issued_by=actor_username,
                issued_at=utcnow(),
            )
            db.add(reward)
            db.flush()
            created_rewards.append(reward)

        successful_referral_count = _successful_referral_reward_count(db, referral.referrer_customer_id)
        milestone_reward = _ensure_milestone_bonus(
            db,
            recipient_customer_id=referral.referrer_customer_id,
            successful_referral_count=successful_referral_count,
            issued_by=actor_username,
        )
        if milestone_reward and milestone_reward not in created_rewards:
            created_rewards.append(milestone_reward)

        referral.reward_status = "issued"
        referral.reward_issued_at = referral.reward_issued_at or utcnow()
        referral.status = "reward_issued"
    else:
        referral.reward_status = "not_applicable"
        if referral.status != "reward_issued":
            referral.status = "qualified_order_placed"

    return {
        "referral": referral,
        "rewards": [serialize_referral_reward(reward) for reward in created_rewards],
    }


def build_referral_batch_csv(batch: models.ReferralBatch) -> str:
    buffer = StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["batch_name", "campaign_tag", "source_tag", "invite_code", "invite_link", "status", "created_at", "claimed_at"])
    for invite in sorted(list(getattr(batch, "invites", []) or []), key=lambda item: item.created_at.isoformat() if item.created_at else ""):
        writer.writerow([
            batch.name,
            batch.campaign_tag or "",
            batch.source_tag or "",
            invite.code,
            build_invite_link(invite.code) or "",
            invite.status,
            invite.created_at.isoformat() if invite.created_at else "",
            invite.claimed_at.isoformat() if invite.claimed_at else "",
        ])
    return buffer.getvalue()
