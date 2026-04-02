from datetime import datetime, timedelta, time
import pytz
import phonenumbers

ET = pytz.timezone("America/New_York")
# Updated delivery slots with last slot at 9 PM
DEFAULT_SLOTS = [time(11, 0), time(13, 0), time(15, 0), time(17, 0), time(19, 0), time(21, 0)]  # Added 9 PM

def get_available_slots(now_utc=None, lead_minutes=15):  # Changed from 20 to 15 minutes lead time
    now_utc = now_utc or datetime.utcnow().replace(tzinfo=pytz.utc)
    now_et = now_utc.astimezone(ET)
    today_et = now_et.date()
    slots = []
    
    for day_offset in (0, 1):  # today and tomorrow
        day = today_et + timedelta(days=day_offset)
        for t in DEFAULT_SLOTS:
            dt_et = ET.localize(datetime.combine(day, t))
            dt_utc = dt_et.astimezone(pytz.utc)
            
            # Calculate cutoff time (8:45 PM for 9 PM slot)
            cutoff_time = dt_et - timedelta(minutes=15)
            
            # Skip if current time is past the cutoff for this slot
            if now_et >= cutoff_time:
                continue
                
            # Skip if this is a past slot for today
            if day_offset == 0 and dt_et <= now_et:
                continue
            
            # Windows-compatible time formatting
            hour_12 = dt_et.hour % 12
            if hour_12 == 0:
                hour_12 = 12
            am_pm = "AM" if dt_et.hour < 12 else "PM"
            time_label = f"{hour_12}:{dt_et.minute:02d} {am_pm} ET"
            
            # Add day prefix for tomorrow's slots
            if day_offset == 1:
                time_label = f"Tomorrow {time_label}"
            
            slots.append({
                "et": dt_et.isoformat(),
                "utc": dt_utc.isoformat(),
                "label": time_label
            })
    
    return slots

def validate_phone(raw, default_region='US'):
    try:
        p = phonenumbers.parse(raw, default_region)
        return phonenumbers.is_possible_number(p) and phonenumbers.is_valid_number(p), phonenumbers.format_number(p, phonenumbers.PhoneNumberFormat.E164)
    except:
        return False, None
    
def order_item_to_dict(order_item):
    return {
        "menu_id": order_item.id,
        "name": order_item.name,
        "quantity": order_item.quantity,
        "price_cents": order_item.price_cents,
        # "options": order_item.options,
    }

def proxy_image_url(original_url):
    # This service adds proper headers and converts to HTTPS
    if original_url.endswith('.png'):
        return f"https://images.weserv.nl/?url={original_url}&output=png"
    elif original_url.endswith('.jpg'):
        return f"https://images.weserv.nl/?url={original_url}&output=jpg"
    elif original_url.endswith('.jpeg'):
        return f"https://images.weserv.nl/?url={original_url}&output=jpeg"
    elif original_url.endswith('.gif'):
        return f"https://images.weserv.nl/?url={original_url}&output=gif"
    elif original_url.endswith('.webp'):
        return f"https://images.weserv.nl/?url={original_url}&output=webp"
    return f"https://images.weserv.nl/?url={original_url}&output=jpg"