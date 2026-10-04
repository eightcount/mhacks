"""Persisted form drafting and review, backed by the existing caterer tools."""
from __future__ import annotations

import re
from datetime import datetime

from .caterer_form_dates import closing_time, sale_day
from .caterer_intents import CONFIRMATIONS, CatererInterpreter


def fulfillment_question(state: dict) -> str:
    methods = state['supportedFulfillmentMethods']
    if len(methods) == 1:
        method = methods[0].lower()
        return f"Your business is configured for {method} only. Reply '{method}' to continue, or 'cancel'."
    return 'Will customers use pickup or delivery?'


def fulfillment_instructions(state: dict) -> str:
    if state['data'].get('fulfillmentMethod') == 'PICKUP':
        return 'What pickup location should customers see?'
    return 'What delivery area and delivery instructions should customers see?'


async def check_form_fulfillment(backend, state: dict) -> str | None:
    # Capabilities are read from the owned business, including on draft resume.
    # Preview/publication still enforce these rules in the backend.
    methods = (await backend.tool('form_options', {}))['supportedFulfillmentMethods']
    state['supportedFulfillmentMethods'] = methods
    data = state['data']
    if data.get('fulfillmentMethod') and data['fulfillmentMethod'] not in methods:
        for key in ('fulfillmentMethod', 'fulfillmentInstructions', 'deliveryFee'):
            data.pop(key, None)
        state.pop('reviewedForm', None)
        state['step'] = 'fulfillmentMethod'
        return fulfillment_question(state) + ' Your other draft details are saved.'
    return None


async def review_form(backend, state: dict) -> str:
    correction = await check_form_fulfillment(backend, state)
    if correction:
        return correction
    data = state['data']
    # A new review always reads current prices; expected prices are a guard on
    # publication, never a way for the conversation to set a selling price.
    payload = {**data, 'products': [
        {key: item[key] for key in ('productSpecId', 'maxPackages')} for item in data['products']]}
    form = (await backend.tool('preview_form', payload))['form']
    state['reviewedForm'] = {**payload, 'products': [
        {'productSpecId': item['productSpecId'], 'maxPackages': item['maxPackages'],
         'expectedUnitPrice': item['unitPrice']} for item in form['products']]}
    state['step'] = 'review'
    closing = datetime.fromisoformat(data['closesAt'].replace('Z', '+00:00'))
    lines = ['Review your order form:', form['title']]
    lines.extend(f"• {p['name']} — ${p['unitPrice']} per {p['container']}; up to {p['maxPackages']} packages"
                 for p in form['products'])
    lines.extend([
        f"{form['fulfillmentMethod'].title()}: {form['fulfillmentDate']}",
        form['fulfillmentInstructions'],
        f"Orders close: {closing.strftime('%A, %B %d, %Y at %I:%M %p')} (UTC{closing.strftime('%z')})",
        f"Minimum food order: ${form['minimumOrder']}. Delivery fee: ${form['deliveryFee']}.",
        "Reply 'publish' to create the link, send a correction, or 'cancel' to discard this draft.",
    ])
    return '\n'.join(lines)


async def publish_form(backend, state: dict) -> str:
    correction = await check_form_fulfillment(backend, state)
    if correction:
        return correction
    if not state.get('reviewedForm'):
        return await review_form(backend, state)
    try:
        result = await backend.tool('create_form', state['reviewedForm'])
    except ValueError as error:
        state.pop('reviewedForm', None)
        if 'menu price changed' in str(error).lower():
            return 'The menu price changed; nothing was published.\n' + await review_form(backend, state)
        return f'Nothing was published. {error} Send a correction or say cancel.'
    for key in ('flow', 'naturalForm', 'step', 'data', 'choices', 'selectedProduct',
                'deadlineText', 'deadlineError', 'priceQuestion', 'reviewedForm', 'packageLimit', 'customTitle',
                'supportedFulfillmentMethods'):
        state.pop(key, None)
    return f"Your order form is ready: {result['url']}\n{result['message']}"


def product_matches(query: str, products: list[dict]) -> list[dict]:
    query = query.strip().lower()
    if query.isdigit():
        index = int(query) - 1
        return products[index:index + 1] if 0 <= index < len(products) else []
    exact = [p for p in products if p['productName'].lower() == query]
    if exact:
        return exact
    def words(value):
        return {w.rstrip('s') for w in re.findall(r'[a-z0-9]+', value.lower()) if w not in {'the', 'my', 'please'}}
    wanted = words(query)
    return [p for p in products if wanted and wanted <= words(p['productName'])]


class NaturalFormConversation:
    def __init__(self, backend, interpreter: CatererInterpreter):
        self.backend, self.interpreter = backend, interpreter

    async def start(self, state: dict, text: str, turn: dict | None = None) -> str:
        recipes = (await self.backend.tool('recipes', {}))['products']
        menu = {item['id']: item for item in (await self.backend.tool('menu', {}))['items']}
        choices, seen = [], set()
        for recipe in recipes:  # Backend returns newest recipe revisions first.
            menu_id = recipe.get('menuItemId') or recipe.get('spec', {}).get('menuItemId')
            if menu_id not in menu or menu_id in seen:
                continue
            seen.add(menu_id)
            choices.append({'id': recipe['id'], 'productName': menu[menu_id]['name'],
                            'price': menu[menu_id]['price'], 'container': recipe['spec']['container']['name']})
        if not choices:
            return "Start with 'new recipe' to define a container for an active menu item, then create your form."
        state.update(flow='form', naturalForm=True, step='product', choices=choices,
                     data={'minimumOrder': '0.00'})
        turn = turn or await self.interpreter.extract(text, state)
        return await self.respond(state, text, turn)

    async def respond(self, state: dict, text: str, turn: dict | None = None) -> str:
        lower = text.strip().lower().rstrip('.!')
        if lower in CONFIRMATIONS:
            if state.get('reviewedForm'):
                return await publish_form(self.backend, state)
            return await self.next_question(state)
        if lower in {'review', 'review form'}:
            return await self.next_question(state)
        if state.get('priceQuestion') and lower in {'use menu price', 'keep menu price', 'use the saved price'}:
            state.pop('priceQuestion', None)
            return await self.next_question(state)
        turn = turn or await self.interpreter.extract(text, state)
        if turn['intent'] not in {'CREATE_FORM', 'UPDATE_FORM'}:
            return "Your form draft is saved. Send its missing details or a correction, or say 'cancel' to leave setup."
        patch = turn['patch']
        if not patch:
            return 'I could not identify a form detail in that message.\n' + await self.next_question(state)
        state.pop('reviewedForm', None)
        data = state['data']
        notice = ''
        if 'product' in patch:
            if not state.get('customTitle'):
                data.pop('title', None)
            matches = product_matches(patch['product'], state['choices'])
            if len(matches) != 1:
                state.pop('selectedProduct', None)
                data.pop('products', None)
                notice = ('More than one product matches. Choose its full name or listed number.' if matches
                          else 'I could not find that product in your prepared menu. Choose a listed product.')
            else:
                state['selectedProduct'] = matches[0]['id']
                data.pop('products', None)
        if 'maxPackages' in patch:
            state['packageLimit'] = patch['maxPackages']
        if 'fulfillmentDate' in patch:
            data['fulfillmentDate'] = sale_day(patch['fulfillmentDate'])
            if not state.get('customTitle'):
                data.pop('title', None)
            # Re-resolve a weekday deadline relative to an edited fulfillment date.
            if state.get('deadlineText'):
                patch = {**patch, 'closesAt': patch.get('closesAt', state['deadlineText'])}
        if ('fulfillmentMethod' in patch and data.get('fulfillmentMethod')
                and patch['fulfillmentMethod'] != data['fulfillmentMethod']
                and 'fulfillmentInstructions' not in patch):
            data.pop('fulfillmentInstructions', None)
        prior_method = data.get('fulfillmentMethod')
        for field in ('fulfillmentMethod', 'fulfillmentInstructions', 'title', 'minimumOrder', 'deliveryFee'):
            if field in patch:
                data[field] = patch[field]
        if 'title' in patch:
            state['customTitle'] = True
        if 'fulfillmentMethod' in patch and patch['fulfillmentMethod'] == 'PICKUP':
            data['deliveryFee'] = '0.00'
        elif patch.get('fulfillmentMethod') == 'DELIVERY' and prior_method != 'DELIVERY' and 'deliveryFee' not in patch:
            data.pop('deliveryFee', None)
        if 'closesAt' in patch:
            previous = state.get('deadlineText', '')
            try:
                data['closesAt'] = closing_time(patch['closesAt'], data.get('fulfillmentDate'), previous)
                state.pop('deadlineError', None)
            except ValueError as error:
                data.pop('closesAt', None)
                state['deadlineError'] = str(error)
            # Keep the initial day when a follow-up supplies just the time/zone.
            state['deadlineText'] = patch['closesAt'] if not previous else previous + '; ' + patch['closesAt']
            state['deadlineText'] = state['deadlineText'][-1000:]
        selected = next((p for p in state['choices'] if p['id'] == state.get('selectedProduct')), None)
        if 'quotedPrice' in patch:
            if not selected or patch['quotedPrice'] != selected['price']:
                state['priceQuestion'] = True
            else:
                state.pop('priceQuestion', None)
        if selected and state.get('packageLimit'):
            data['products'] = [{'productSpecId': selected['id'], 'maxPackages': state['packageLimit']}]
        response = await self.next_question(state)
        return notice + '\n' + response if notice else response

    async def next_question(self, state: dict) -> str:
        correction = await check_form_fulfillment(self.backend, state)
        if correction:
            return correction
        data = state['data']
        selected = next((p for p in state['choices'] if p['id'] == state.get('selectedProduct')), None)
        if not selected:
            state['step'] = 'product'
            return 'Which product are you selling?\n' + '\n'.join(
                f"{i + 1}. {p['productName']} — ${p['price']} per {p['container']}"
                for i, p in enumerate(state['choices']))
        price = f"{selected['productName']} uses the saved menu price of ${selected['price']} per {selected['container']}."
        if state.get('priceQuestion'):
            state['step'] = 'price'
            return price + " Update the menu price first, or reply 'use menu price' to continue with this price."
        questions = {
            'products': ('maxPackages', price + ' How many packages would you like to sell?'),
            'fulfillmentDate': ('fulfillmentDate', 'What date is pickup or delivery?'),
            'fulfillmentMethod': ('fulfillmentMethod', fulfillment_question(state)),
            'fulfillmentInstructions': ('fulfillmentInstructions', fulfillment_instructions(state)),
            'closesAt': ('closesAt', state.get('deadlineError') or 'When should orders close? For example Friday at 6pm Eastern.'),
            'deliveryFee': ('deliveryFee', 'What is the delivery fee in dollars? Say 0 for free delivery.'),
        }
        for field, (step, question) in questions.items():
            if field not in data:
                state['step'] = step
                known = f"Sale date: {data['fulfillmentDate']}. " if field == 'products' and data.get('fulfillmentDate') else ''
                return known + question
        if 'title' not in data:
            data['title'] = f"{selected['productName']} — {data['fulfillmentDate']}"[:150]
        try:
            return await review_form(self.backend, state)
        except ValueError as error:
            return f'Your draft is saved, but it needs a correction: {error}'
