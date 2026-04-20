from __future__ import annotations

from sqlalchemy.orm import Session

from . import models


def normalize_photo_urls(photo_urls: list[str] | None, fallback_photo_url: str | None = None) -> list[str]:
    normalized: list[str] = []
    for raw_url in photo_urls or []:
        value = (raw_url or "").strip()
        if value and value not in normalized:
            normalized.append(value)

    fallback = (fallback_photo_url or "").strip()
    if not normalized and fallback:
        normalized.append(fallback)

    return normalized


def get_menu_item_photo_urls(menu_item: models.MenuItem) -> list[str]:
    ordered_photos = sorted(
        list(getattr(menu_item, "photos", []) or []),
        key=lambda photo: ((photo.sort_order or 0), photo.id or 0),
    )
    photo_urls = normalize_photo_urls([photo.photo_url for photo in ordered_photos], menu_item.photo_url)
    return photo_urls


def sync_menu_item_photo_gallery(
    db: Session,
    menu_item: models.MenuItem,
    photo_urls: list[str] | None,
    *,
    fallback_photo_url: str | None = None,
) -> list[str]:
    normalized = normalize_photo_urls(photo_urls, fallback_photo_url or menu_item.photo_url)
    menu_item.photo_url = normalized[0] if normalized else None

    db.query(models.MenuItemPhoto).filter(
        models.MenuItemPhoto.menu_item_id == menu_item.id
    ).delete(synchronize_session=False)
    db.flush()

    for index, photo_url in enumerate(normalized):
        db.add(
            models.MenuItemPhoto(
                menu_item_id=menu_item.id,
                photo_url=photo_url,
                sort_order=index,
            )
        )

    return normalized
