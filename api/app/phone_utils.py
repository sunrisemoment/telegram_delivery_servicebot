from __future__ import annotations

import phonenumbers


def normalize_phone_number(raw: str | None, default_region: str = "US") -> str | None:
    if not raw:
        return None

    candidate = raw.strip()
    if not candidate:
        return None

    try:
        parsed = phonenumbers.parse(candidate, default_region)
    except phonenumbers.NumberParseException:
        return None

    if not (phonenumbers.is_possible_number(parsed) and phonenumbers.is_valid_number(parsed)):
        return None

    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


def phone_numbers_match(left: str | None, right: str | None, default_region: str = "US") -> bool:
    normalized_left = normalize_phone_number(left, default_region=default_region)
    normalized_right = normalize_phone_number(right, default_region=default_region)
    return bool(normalized_left and normalized_right and normalized_left == normalized_right)


def mask_phone_number(phone: str | None) -> str | None:
    normalized = normalize_phone_number(phone)
    if not normalized:
        return None

    if len(normalized) <= 6:
        return normalized

    return f"{normalized[:3]}***{normalized[-4:]}"
