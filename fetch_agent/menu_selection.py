from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class MenuSelection:
    name: str
    quantity: int


def parse_menu_selections(message: str) -> list[MenuSelection]:
    """Recognize explicit order lines, without treating guest counts as quantities."""
    text = message.strip().replace("’", "'")
    text = re.sub(r"^(?:please\s+)?(?:i(?:'d| would) like|i want|i'll (?:have|take)|can i have|order|add|select|make that)\s+", "", text, flags=re.I)
    text = re.sub(r"^please\s+|[,\s]+please[.!?]?$", "", text, flags=re.I).strip(" .!?")
    text = re.sub(r"\s+for (?:the )?(?:(?:first|second|third|fourth) (?:request|event)|(?:request|event)\s*#?\d+)$", "", text, flags=re.I)
    text = re.sub(r",\s*(?:quantity|qty)\s*:?\s*", " x ", text, flags=re.I)
    text = re.sub(r"(?<=[A-Za-z])\s*,\s*(?=[+-]?\d+(?:\.\d+)?(?:\s*(?:$|[;,]|\band\b)))", ": ", text, flags=re.I)
    # Keep names such as 'Mac and Cheese' together.
    parts = re.split(r"\s*(?:;|\n|,|\band\b)\s*(?=[+-]?\d|[A-Za-z][^,;\n]*?\s+[x×:]\s*\d)", text, flags=re.I)
    selections = []
    number = r"[+-]?\d+(?:\.\d+)?"
    for part in parts:
        match = re.fullmatch(rf"(?P<quantity>{number})(?:\s*[x×]\s*|\s+)(?:(?:(?:servings?|portions?|orders?|plates?)\s+)?of\s+)?(?P<name>[A-Za-z][A-Za-z '&()/-]*)", part, re.I)
        if match is None:
            match = re.fullmatch(rf"(?P<name>[A-Za-z][A-Za-z '&()/-]*?)(?:\s*[x×:]\s*|\s+(?:(?:quantity|qty)\s*:?\s*)?)(?P<quantity>{number})", part, re.I)
        if match is None:
            return []
        name = match['name'].strip()
        if re.search(r"\b(?:people|guests|attendees|persons|ppl|budget|dollars|headcount)\b", name, re.I):
            return []
        quantity = match['quantity']
        selections.append(MenuSelection(name, int(quantity) if re.fullmatch(r"[+-]?\d+", quantity) else 0))
    return selections


def normalized_menu_name(name: str) -> str:
    words = re.findall(r"\w+", name.casefold())
    # Accept the singular form customers commonly use for a plural menu label.
    if words and len(words[-1]) > 3 and words[-1].endswith("s") and not words[-1].endswith(("ss", "us")):
        words[-1] = words[-1][:-1]
    return " ".join(words)
