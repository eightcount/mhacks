"""Interactive owner cards for the Photon/iMessage workflow."""
from __future__ import annotations

import json
import re
import time
from uuid import uuid4


def parse_card_selection(text, state):
    """Accept direct ACP JSON; planner prose must preserve explicit card/action IDs."""
    stripped = text.strip()
    if stripped.startswith('{'):
        try:
            value = json.loads(stripped)
        except json.JSONDecodeError:
            raise ValueError('That card response is incomplete. Open the latest card again.') from None
        if not isinstance(value, dict) or 'card_id' not in value:
            raise ValueError('Use a card from this conversation.')
        return value
    card = state.get('card', {}).get('view', {})
    if not card.get('id') or card['id'] not in text:
        return None
    # Planners may quote the complete JSON in narration or a fenced block.
    decoder = json.JSONDecoder()
    for match in re.finditer(r'\{', text):
        try:
            value, _ = decoder.raw_decode(text[match.start():])
            if isinstance(value, dict) and 'card_id' in value:
                return value
        except json.JSONDecodeError:
            pass
    action = re.search(r'\baction[\s"\']*(?::|=|is)\s*["\']?([a-z_]+)\b', text, re.I)
    if not action:
        raise ValueError('Open the card in a direct @mention conversation so its exact selection can be sent.')
    selection = {'card_id': card['id'], 'action': action[1].lower()}
    for field in card['fields']:
        if field['kind'] == 'choice':
            if field['name'] == 'selected':
                capture = re.search(r'\b(?:selected|picked)\s*[:=]?\s*(\[[^\]]*\]|[\w-]+(?:\s*,\s*[\w-]+)*)', text, re.I)
            else:
                capture = re.search(re.escape(field['name']) + r'\s*[:=]\s*"?([\w-]+)', text)
            captured = capture[1] if capture else ''
            values = [c['value'] for c in field['choices'] if re.search(r'(?<![\w-])' + re.escape(c['value']) + r'(?![\w-])', captured)]
            if values:
                selection[field['name']] = values if field.get('multi') else values[0] if len(values) == 1 else values
        elif field['kind'] == 'number':
            value = re.search(re.escape(field['name']) + r'[\s"\']*[:=]\s*["\']?(\d+)\b', text)
            if value:
                selection[field['name']] = value[1]
        else:
            value = re.search(re.escape(field['name']) + r'\s*[:=]\s*"([^"\n]{1,4000})"', text)
            if value:
                selection[field['name']] = value[1]
    return selection


def choice_field(choices, *, multi=True):
    return {"name": "selected", "kind": "choice", "label": "Select items", "multi": multi,
            "choices": [{"value": str(value), "label": label[:500]} for value, label in choices][:50]}


def card_reply(state, text, title, fields, actions):
    card = {"id": str(uuid4()), "title": title, "fields": fields,
            "actions": [{"id": action, "label": label} for action, label in actions]}
    state['card'] = {"view": card, "expires": int(time.time()) + 3600}
    return {"text": text, "card": card}


def wizard_card(state, text):
    flow, step = state.get('flow'), state.get('step')
    if flow == 'form' and step == 'review' and state.get('reviewedForm'):
        return card_reply(state, text, 'Review order form', [],
                          [('publish_form', 'Publish form'), ('cancel', 'Cancel setup')])
    if flow == 'form' and step == 'products':
        products = state['choices'][:50]
        fields = [choice_field((p['id'], f"{i+1}. {p['productName']} — {p['spec']['container']['name']}") for i, p in enumerate(products))]
        fields += [{"name": f"qty_{p['id']}", "kind": "number", "label": f"Max packages: {p['productName']}"[:200]} for p in products]
        return card_reply(state, text, 'Choose products and package limits', fields, [('products', 'Use selected products')])
    if flow == 'recipe' and step == 'product':
        return card_reply(state, text, 'Choose a product', [choice_field(
            ((p['id'], f"{i+1}. {p['name']} · ${p['price']}") for i, p in enumerate(state['choices'])), multi=False)], [('recipe', 'Define recipe')])
    if flow and step:
        field = {"name": "answer", "kind": "text", "label": text[:200]}
        if flow == 'form' and step == 'fulfillmentMethod':
            field = {"name": "answer", "kind": "choice", "label": "Fulfillment", "multi": False,
                     "choices": [{"value": method, "label": method.title()}
                                 for method in state.get('supportedFulfillmentMethods', ['PICKUP', 'DELIVERY'])]}
        return card_reply(state, text, 'Order form' if flow == 'form' else 'Recipe setup' if flow == 'recipe' else 'Customer update',
                          [field], [('answer', 'Continue'), ('cancel', 'Cancel setup')])
    return {"text": text}


def validate_selection(state, selection):
    current = state.get('card', {})
    card = current.get('view', {})
    if selection.get('card_id') != card.get('id') or current.get('expires', 0) < time.time():
        raise ValueError("This card is out of date. Use the latest card or ask for orders/menu again.")
    if selection.get('action') not in [a['id'] for a in card['actions']]:
        raise ValueError('Choose an action shown on this card.')
    fields = {f['name']: f for f in card['fields']}
    if set(selection) - {'card_id', 'action'} - set(fields):
        raise ValueError('This card contains an unknown field.')
    for name, field in fields.items():
        value = selection.get(name)
        if value is None:
            continue
        if field['kind'] == 'choice':
            values = value if isinstance(value, list) else [value]
            if (any(not isinstance(v, str) for v in values) or len(values) != len(set(values)) or
                    any(v not in [c['value'] for c in field['choices']] for v in values) or
                    (not field.get('multi') and len(values) > 1)):
                raise ValueError('Choose only the items shown on this card.')
        elif field['kind'] == 'number':
            if value not in ('', None) and (isinstance(value, bool) or not str(value).isdigit() or not 1 <= int(value) <= 10000):
                raise ValueError('Choose a whole package limit between 1 and 10,000.')
        elif not isinstance(value, str) or len(value) > 4000:
            raise ValueError('Please shorten that answer.')
    return selection


def selected_ids(selection):
    values = selection.get('selected', [])
    values = values if isinstance(values, list) else [values]
    if not values:
        raise ValueError('Tap at least one item first.')
    return values
