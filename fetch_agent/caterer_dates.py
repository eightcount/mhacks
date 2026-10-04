"""Deterministic, English calendar dates for caterer reporting commands."""
from __future__ import annotations

import os
import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

MONTHS = {name: index for index, names in enumerate((
    ('january', 'jan'), ('february', 'feb'), ('march', 'mar'), ('april', 'apr'),
    ('may',), ('june', 'jun'), ('july', 'jul'), ('august', 'aug'),
    ('september', 'sep', 'sept'), ('october', 'oct'), ('november', 'nov'), ('december', 'dec')
), 1) for name in names}
MONTH_PATTERN = '|'.join(MONTHS)
WEEKDAYS = {name: i for i, name in enumerate(('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'))}
DATE_HINT = "Use a date like 'June 10th', 'June 10, 2030', 'today', or a range like 'June 10–16, 2030'."


def local_today() -> date:
    zone = os.environ.get('CATERER_TIMEZONE')
    return datetime.now(ZoneInfo(zone)).date() if zone else date.today()


def _normalize(text: str) -> str:
    text = re.sub(r'(?<=\d)(st|nd|rd|th)\b', '', text.strip().lower())
    return re.sub(r'\s+', ' ', text).rstrip('.!?')


def _day(text: str, today: date, year: int) -> date:
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', text):
        return date.fromisoformat(text)
    if text in ('today', 'tomorrow', 'yesterday'):
        return today + timedelta(days={'today': 0, 'tomorrow': 1, 'yesterday': -1}[text])
    weekday = re.fullmatch(r'(this |next |last )?(' + '|'.join(WEEKDAYS) + ')', text)
    if weekday:
        number = WEEKDAYS[weekday[2]]
        if weekday[1]:
            return today - timedelta(days=today.weekday()) + timedelta(days=number + {'this ': 0, 'next ': 7, 'last ': -7}[weekday[1]])
        return today + timedelta(days=(number - today.weekday()) % 7)
    match = re.fullmatch(rf'({MONTH_PATTERN})\.?\s+(\d{{1,2}})(?:,?\s*(\d{{4}}))?', text)
    if match:
        return date(int(match[3] or year), MONTHS[match[1]], int(match[2]))
    match = re.fullmatch(rf'(\d{{1,2}})\s+({MONTH_PATTERN})\.?(?:,?\s*(\d{{4}}))?', text)
    if match:
        return date(int(match[3] or year), MONTHS[match[2]], int(match[1]))
    raise ValueError(DATE_HINT)


def single_day(text: str, *, today: date | None = None, year: int | None = None) -> date:
    today = today or local_today()
    try:
        return _day(_normalize(text), today, year or today.year)
    except ValueError as error:
        if str(error) == DATE_HINT:
            raise
        raise ValueError("That isn't a valid calendar date. " + DATE_HINT) from None


def is_date_request(text: str) -> bool:
    value = _normalize(text)
    return bool(re.match(rf'^(?:{MONTH_PATTERN})\b|^\d{{4}}-\d{{2}}-\d{{2}}\b|^\d{{1,2}}\s+(?:{MONTH_PATTERN})\b', value) or
                re.fullmatch(r'(?:today|tomorrow|yesterday|(?:(?:this|next|last) )?(?:week|' + '|'.join(WEEKDAYS) + '))', value))


def period(text: str, *, today: date | None = None, year: int | None = None, fallback: dict | None = None) -> dict:
    today = today or local_today()
    value = _normalize(text)
    value = re.sub(r'^(orders|plan|ingredients|labels|groceries|shopping|deals|sales|notify)\b\s*', '', value)
    value = re.sub(r'^(?:for|on|from)\s+', '', value)
    if not value and fallback:
        # Validate persisted state before using it again.
        value = f"{fallback['start']} {fallback['end']}"
    if not value or value in ('week', 'this week', 'next week', 'last week'):
        start = today - timedelta(days=today.weekday()) + timedelta(days={'next week': 7, 'last week': -7}.get(value, 0))
        return {'start': start.isoformat(), 'end': (start + timedelta(days=6)).isoformat()}
    iso_pair = re.fullmatch(r'(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})', value)
    short_range = re.fullmatch(rf'({MONTH_PATTERN})\.?\s+(\d{{1,2}})\s*[-–—]\s*(\d{{1,2}})(,?\s*\d{{4}})?', value)
    if iso_pair:
        parts = list(iso_pair.groups())
    elif short_range:
        parts = [f'{short_range[1]} {short_range[2]}{short_range[4] or ""}', f'{short_range[1]} {short_range[3]}{short_range[4] or ""}']
    else:
        parts = re.split(r'\s+(?:to|through|until)\s+|\s*[–—]\s*|\s+-\s+', value)
    if len(parts) > 2:
        raise ValueError(DATE_HINT)
    inferred_year = year or today.year
    if len(parts) == 2:
        # A year attached only to the range's end applies to both named dates.
        trailing_year = re.search(r'(?:\s|,)(\d{4})$', parts[1])
        if trailing_year and not re.search(r'\b\d{4}\b', parts[0]):
            inferred_year = int(trailing_year[1])
    start = single_day(parts[0], today=today, year=inferred_year)
    end_text = parts[-1]
    bare_end = re.fullmatch(r'(\d{1,2})(?:,?\s+(\d{4}))?', end_text) if len(parts) == 2 else None
    if bare_end:
        end_text = f'{start.strftime("%B")} {bare_end[1]}, {bare_end[2] or start.year}'
    end = single_day(end_text, today=today, year=start.year)
    if end < start or (end - start).days > 31:
        raise ValueError('Choose dates in order, spanning at most 32 days. Include both years for a New Year range.')
    return {'start': start.isoformat(), 'end': end.isoformat()}


def describe_period(value: dict) -> str:
    def label(day):
        parsed = date.fromisoformat(day)
        return f'{parsed.strftime("%B")} {parsed.day}, {parsed.year}'
    return label(value['start']) if value['start'] == value['end'] else f"{label(value['start'])} – {label(value['end'])}"


def report_request(text: str) -> tuple[str, str] | None:
    value = _normalize(text)
    value = re.sub(r'^(?:can|could|would) you (?:please )?', '', value)
    value = re.sub(r'^please ', '', value)
    value = re.sub(r' please$', '', value)
    question = re.fullmatch(
        r"(?:what|which) (?:orders|requests) (?:do i have|have i (?:got|received)|are (?:there|due))"
        r"(?: (?:for|on) (.+))?", value)
    if question:
        return 'orders', question[1] or ''
    shopping = (
        'mass order everything from instacart', 'order all ingredients from instacart',
        'order everything from instacart', 'order ingredients from instacart',
        'order all the ingredients', 'order all ingredients', 'buy all ingredients',
        'order ingredients', 'buy ingredients', 'shop on instacart', 'instacart',
    )
    for phrase in shopping:
        if value == phrase or value.startswith(phrase + ' '):
            return 'groceries', value[len(phrase):].strip()
    match = re.fullmatch(r'(?:(?:show(?: me)?|list|get)\s+)?(?:(?:my|the)\s+)?(orders|plan|ingredients|labels|groceries|shopping|deals|sales|notify)\b\s*(.*)', value)
    if match:
        return {'ingredients': 'plan', 'shopping': 'groceries', 'sales': 'deals'}.get(match[1], match[1]), match[2]
    if is_date_request(value):
        return 'orders', value
    return None
