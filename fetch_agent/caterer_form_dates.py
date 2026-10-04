"""Calendar interpretation for sale dates and deadlines; services validate publication."""
from __future__ import annotations

import os
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from .caterer_dates import MONTH_PATTERN, WEEKDAYS, single_day

DAY_PATTERN = (rf'\d{{4}}-\d{{2}}-\d{{2}}|(?:{MONTH_PATTERN})\.?\s+\d{{1,2}}(?:st|nd|rd|th)?'
               rf'(?:,?\s+\d{{4}})?|(?:(?:this|next|last)\s+)?(?:{"|".join(WEEKDAYS)})|today|tomorrow')
DAY_RE = re.compile(rf'\b(?:{DAY_PATTERN})\b', re.I)


def sale_day(text: str) -> str:
    # A new sale described as "this Saturday" means the upcoming Saturday,
    # including when the conversation happens on Sunday. Reporting keeps its
    # existing calendar-week semantics.
    normalized = text.strip().lower()
    if re.fullmatch(r'this (?:' + '|'.join(WEEKDAYS) + ')', normalized):
        normalized = normalized[5:]
    return single_day(normalized).isoformat()


def closing_time(text: str, fulfillment_date: str | None, previous: str = '') -> str:
    text = text.strip().rstrip('.!?')
    try:
        explicit = datetime.fromisoformat(text.replace('Z', '+00:00'))
    except ValueError:
        explicit = None
    if explicit:
        if explicit.tzinfo is None:
            raise ValueError('Include the deadline time zone, for example Friday at 6pm Eastern.')
        return explicit.isoformat()

    def latest(pattern, value):
        matches = list(re.finditer(pattern, value, re.I))
        return matches[-1] if matches else None

    day_match = latest(DAY_RE.pattern, text) or latest(DAY_RE.pattern, previous)
    if not day_match:
        raise ValueError('What day do orders close? For example Friday at 6pm Eastern.')
    day_text = day_match[0].lower()
    if day_text in WEEKDAYS and fulfillment_date:
        sale = date.fromisoformat(fulfillment_date)
        day = sale - timedelta(days=(sale.weekday() - WEEKDAYS[day_text]) % 7)
    else:
        day = single_day(day_text)

    clock_pattern = r'\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b'
    military_pattern = r'\b([01]?\d|2[0-3]):([0-5]\d)\b'
    clock = latest(clock_pattern, text)
    military = latest(military_pattern, text)
    if not clock and not military and not re.search(r'\b(?:at\s+\d|noon|midnight)\b', text, re.I):
        clock = latest(clock_pattern, previous)
        military = latest(military_pattern, previous)
    if clock:
        hour, minute = int(clock[1]), int(clock[2] or 0)
        if not 1 <= hour <= 12 or minute > 59:
            raise ValueError('Use a valid deadline time, for example 6pm or 18:00.')
        hour = hour % 12 + (12 if clock[3].lower().startswith('p') else 0)
    elif military:
        hour, minute = int(military[1]), int(military[2])
    elif re.search(r'\bnoon\b', text, re.I):
        hour, minute = 12, 0
    elif re.search(r'\bmidnight\b', text, re.I):
        hour, minute = 0, 0
    else:
        raise ValueError('What time should orders close—AM or PM? For example 6pm Eastern.')

    zones = {'eastern': 'America/New_York', 'central': 'America/Chicago',
             'mountain': 'America/Denver', 'pacific': 'America/Los_Angeles', 'utc': 'UTC'}
    zone_pattern = r'\b(eastern|central|mountain|pacific|utc)\b'
    zone_match = latest(zone_pattern, text) or latest(zone_pattern, previous)
    iana_pattern = r'\b[A-Z][A-Za-z_]+/[A-Za-z_]+(?:/[A-Za-z_]+)?\b'
    iana = re.search(iana_pattern, text) or re.search(iana_pattern, previous)
    zone_name = zones[zone_match[1].lower()] if zone_match else iana[0] if iana else os.environ.get('CATERER_TIMEZONE')
    if not zone_name:
        raise ValueError('Which time zone should I use? Repeat the time, for example 6pm Eastern.')
    try:
        zone = ZoneInfo(zone_name)
    except (ValueError, KeyError):
        raise ValueError('Use a recognized time zone, for example Eastern or America/Detroit.') from None
    naive = datetime(day.year, day.month, day.day, hour, minute)
    closing = naive.replace(tzinfo=zone)
    if closing.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) != naive:
        raise ValueError('That local time is skipped by daylight saving time. Choose another time.')
    if closing.utcoffset() != naive.replace(tzinfo=zone, fold=1).utcoffset():
        raise ValueError('That time occurs twice. Supply an ISO deadline with an explicit UTC offset.')
    return closing.isoformat()
