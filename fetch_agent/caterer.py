from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from .models import normalize_budget
from .caterer_dates import period, report_request, describe_period, single_day
from .caterer_forms import (NaturalFormConversation, check_form_fulfillment,
                            fulfillment_instructions, fulfillment_question, publish_form, review_form)
from .caterer_intents import CONFIRMATIONS, default_interpreter, starts_form
from .caterer_cards import card_reply, choice_field, parse_card_selection, selected_ids, validate_selection, wizard_card


class CatererBackend:
    async def tool(self, name: str, payload: dict) -> dict:
        return await asyncio.to_thread(self._call, name, payload)

    def _call(self, name: str, payload: dict) -> dict:
        token = os.environ.get("CATERER_INTERNAL_TOKEN")
        if not token:
            raise ValueError("Run caterer:configure before starting the caterer agent.")
        request = Request(f"http://127.0.0.1:{os.environ.get('CATERER_BACKEND_PORT') or '4002'}/tools/{name}",
                          data=json.dumps(payload).encode(), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=30) as response:
                return json.load(response)
        except HTTPError as error:
            raise ValueError(json.load(error).get("error", "The caterer backend could not complete that action.")) from None


HELP = ("I can help you collect and prepare this week's orders.\n"
        "• 'menu' — see your products and prices\n• 'new recipe' — define a container and recipe yield\n"
        "• 'new form' — create a shareable order form\n• 'forms' / 'close form 1' — list or close forms\n• 'orders' — review this week's requests\n"
        "• 'accept 1' / 'decline 1' — respond to a listed request\n• 'plan' — packages, batches, ingredients\n"
        "• 'plan order 1' / 'order ingredients for order 1' — prepare just that accepted order\n"
        "• 'order ingredients for the order I accepted' — shop for your last accepted order\n"
        "• 'receipt 1' — itemized receipt for a listed order\n"
        "• 'labels' — printable distribution labels\n• 'order ingredients' — shop all batch ingredients on Instacart\n"
        "• 'deals' — current ingredient promotions at your configured store\n"
        "• 'notify' — draft a fulfillment update for accepted orders\n"
        "• 'notification 1 to +12025550143' — set a draft's phone number (use your number)\n"
        "• 'send notification' — send the current draft to its saved recipient\n"
        "Say 'June 10th' or 'orders June 10, 2030' for one day's orders; date ranges also work. "
        "You can also ask 'What orders do I have for Saturday?' or 'Create an order form for dumplings this Saturday.' "
        "After viewing orders or a plan, 'order ingredients' uses those dates. "
        "Say 'cancel' to leave a setup conversation.")


def measure(text: str) -> dict:
    match = re.fullmatch(r"\s*(\d+(?:\.\d{1,3})?)\s*(g|kg|ml|l|each)\s*", text, re.I)
    if not match:
        raise ValueError("Use an amount and unit, such as 12 each, 500 g, or 750 ml.")
    return {"amount": match[1], "unit": match[2].lower()}


def focused_production_request(text: str) -> tuple[str, int | None] | None:
    match = re.fullmatch(r"(plan|order ingredients|groceries|instacart|deals)\s+(?:for\s+)?(.+)", text.lower())
    if not match:
        return None
    number = re.fullmatch(r"(?:order\s+)?#?(\d+)", match[2])
    recent = match[2] in ('the order i accepted', 'the order i just accepted',
                          'my last accepted order', 'last accepted order', 'the last accepted order')
    if not number and not recent:
        return None
    command = 'groceries' if match[1] in ('order ingredients', 'groceries', 'instacart') else match[1]
    return command, int(number[1]) if number else None


class CatererConversation:
    def __init__(self, backend=None, interpreter=None, *, interactive_cards=True):
        self.backend = backend or CatererBackend()
        self.interactive_cards = interactive_cards
        self.interpreter = interpreter or default_interpreter()
        self.forms = NaturalFormConversation(self.backend, self.interpreter)
        self.locks: dict[str, asyncio.Lock] = {}

    async def handle(self, session: str, text: str) -> dict:
        async with self.locks.setdefault(session, asyncio.Lock()):
            state = (await self.backend.tool("session", {"sessionId": session}))["draft"]
            if not self.interactive_cards:
                old_card_id = state.pop('card', {}).get('view', {}).get('id')
                if re.search(r'\bcard_id\b', text) or (old_card_id and old_card_id in text):
                    await self.backend.tool('session', {'sessionId': session, 'draft': state})
                    return {'text': "Interactive cards are disabled in this chat. Type 'menu' or 'new form' to continue. If setup is already in progress, answer its question or say 'cancel'."}
            try:
                selection = parse_card_selection(text, state) if self.interactive_cards else None
                if selection is not None:
                    validate_selection(state, selection)
                state.pop('card', None)
                if selection:
                    # Consume before business actions. An uncertain result must never
                    # repeat an order update or notification after a process restart.
                    await self.backend.tool('session', {'sessionId': session, 'draft': state})
                    reply = await self._card_action(state, selection)
                else:
                    reply = await self._respond(state, text.strip())
                reply = self._present(state, reply)
                await self.backend.tool("session", {"sessionId": session, "draft": state})
                return reply
            except (ValueError, KeyError, IndexError) as error:
                message = str(error) or "Please check that value and try again."
                if state.get('flow') and not state.get('card'):
                    # Restore the saved wizard after invalid input, never partial work.
                    saved = (await self.backend.tool('session', {'sessionId': session}))['draft']
                    reply = self._present(saved, message)
                    await self.backend.tool('session', {'sessionId': session, 'draft': saved})
                    return reply
                return {"text": message}

    def _present(self, state: dict, reply):
        if self.interactive_cards:
            return reply if isinstance(reply, dict) else wizard_card(state, reply)
        state.pop('card', None)
        return {key: value for key, value in reply.items() if key != 'card'} if isinstance(reply, dict) else {'text': reply}

    async def _card_action(self, state: dict, selection: dict):
        action = selection['action']
        if action == 'cancel':
            return await self._respond(state, 'cancel')
        if action == 'publish_form':
            return await publish_form(self.backend, state)
        if action == 'answer':
            answer = selection.get('answer', '')
            if isinstance(answer, list):
                answer = answer[0] if len(answer) == 1 else ''
            if not str(answer).strip():
                raise ValueError('Enter an answer, then continue. You can also reply in the conversation.')
            return await self._wizard(state, str(answer).strip())
        ids = selected_ids(selection)
        if action in ('accept', 'decline', 'complete'):
            status = {'accept': 'ACCEPTED', 'decline': 'DECLINED', 'complete': 'COMPLETED'}[action]
            result = await self.backend.tool('change_orders', {'orderIds': ids, 'status': status})
            if status == 'ACCEPTED':
                state['lastAcceptedOrderId'] = ids[-1]
            refreshed = await self._respond(state, 'orders ' + state['period']['start'] + ' ' + state['period']['end'])
            prefix = f"{len(result['orders'])} order(s) now {status}.\n\n"
            if isinstance(refreshed, dict):
                refreshed['text'] = prefix + refreshed['text']
                return refreshed
            return prefix + refreshed
        if action in ('receipt', 'recipe') and len(ids) != 1:
            raise ValueError('Select one item for this action.')
        if action == 'receipt':
            return await self.backend.tool('order_receipt', {'orderId': ids[0]})
        if action == 'recipe':
            if not state.get('flow'):
                items = (await self.backend.tool('menu', {}))['items']
                state.update(flow='recipe', step='product', data={}, choices=items)
            index = next((i for i, p in enumerate(state['choices']) if p['id'] == ids[0]), None)
            if index is None:
                raise ValueError('That product is no longer available. Ask for menu again.')
            return await self._wizard(state, str(index + 1))
        if action == 'choose_products':
            recipes = (await self.backend.tool('recipes', {}))['products']
            # listProductSpecs is newest first; one current recipe per menu item.
            latest = {}
            for product in recipes:
                latest.setdefault(product['menuItemId'], product)
            if any(item not in latest for item in ids):
                raise ValueError('Define a recipe and container for each selected product first (new recipe).')
            state.update(flow='form', step='products', data={}, choices=[latest[item] for item in ids])
            return 'Set the maximum packages for each selected product.'
        if action == 'products':
            products = []
            for product_id in ids:
                amount = selection.get(f'qty_{product_id}', '')
                if not str(amount).isdigit() or not 1 <= int(amount) <= 10000:
                    raise ValueError('Enter a whole package limit (1–10,000) for every selected product.')
                products.append({'productSpecId': product_id, 'maxPackages': int(amount)})
            state['data']['products'] = products
            state['step'] = 'title'
            return 'What title should customers see on this order form?'
        if action == 'send_notification':
            if len(ids) != 1:
                raise ValueError('Select one notification to review and send.')
            result = await self.backend.tool('send_notification', {'notificationId': ids[0], 'confirm': True})
            state['selectedNotification'] = ids[0]
            return result.get('message', f"Notification status: {result['status']}.")
        raise ValueError('Use an action shown on the latest card.')

    async def _respond(self, state: dict, text: str):
        lower = text.lower()
        receipt = re.fullmatch(r"(?:(?:get|request)\s+)?receipt(?:\s+(?:for\s+)?(?:order\s+)?#?(\d+))?", lower)
        focused = focused_production_request(text)
        if lower == "cancel":
            state.clear()
            return "Setup cancelled. " + HELP
        if state.get("flow"):
            if focused or receipt or lower in ("new form", "new recipe", "orders", "menu", "plan", "labels") or re.match(r"(?:set )?notification\s+\d+\s+to\b|send\s+notification\b", lower):
                return f"You're still setting up a {state['flow']}. Answer the current question, or say 'cancel' before starting '{text}'."
            return await self._wizard(state, text)
        if lower in ("new recipe", "create recipe", "add recipe"):
            items = (await self.backend.tool("menu", {}))["items"]
            if not items:
                return "Add a menu item before defining its recipe and container."
            state.update(flow="recipe", step="product", data={}, choices=items)
            return "Which product? Reply with its number.\n" + "\n".join(f"{i+1}. {item['name']} (${item['price']} per selling unit)" for i, item in enumerate(items))
        if lower in ("new form", "create form", "create order form"):
            products = (await self.backend.tool("recipes", {}))["products"]
            if not products:
                return "Start with 'new recipe' to define what each selling unit contains."
            state.update(flow="form", step="products", data={}, choices=products)
            return "Choose products and the maximum packages to sell, e.g. 1:50, 2:30.\n" + "\n".join(f"{i+1}. {p['productName']} — {p['spec']['container']['name']}" for i, p in enumerate(products))
        if starts_form(text):
            return await self.forms.start(state, text)
        if lower == "menu":
            items = (await self.backend.tool("menu", {}))["items"]
            text = "\n".join(f"{i+1}. {item['name']} — ${item['price']}" for i, item in enumerate(items)) or "No active menu items."
            if not items: return text
            return card_reply(state, text, 'Choose menu items', [choice_field((item['id'], f"{i+1}. {item['name']} · ${item['price']}") for i, item in enumerate(items))],
                              [('choose_products', 'Create form with selected items'), ('recipe', 'Define one recipe')])
        if lower == "forms":
            forms = (await self.backend.tool("forms", {}))["forms"]
            state['forms'] = [form['id'] for form in forms]
            base = (os.environ.get('CATERER_PUBLIC_BASE_URL') or 'http://127.0.0.1:4002').rstrip('/')
            return '\n'.join(f"{i+1}. {form['title']} · {form['fulfillmentDate']} · {'enabled' if form['active'] else 'closed'} · closes {form['closesAt']}\n{base}/forms/{form['id']}" for i, form in enumerate(forms)) or 'No order forms yet.'
        close = re.fullmatch(r"close form (\d+)", lower)
        if close:
            index = int(close[1]) - 1
            if index < 0 or index >= len(state.get('forms', [])):
                return "Ask for 'forms' first, then choose a listed form number."
            await self.backend.tool('close_form', {'formId': state['forms'][index]})
            return 'That order form is now closed to new requests.'
        if receipt:
            orders = state.get('orders', [])
            if not orders:
                return "Ask for 'orders' or an order date first, then say 'receipt 1' using the listed order number."
            if not receipt[1] and len(orders) != 1:
                return "Choose a listed order, e.g. 'receipt 1' or 'receipt 2'."
            index = int(receipt[1]) - 1 if receipt[1] else 0
            if index < 0 or index >= len(orders):
                return "Choose a listed order number, e.g. 'receipt 1'."
            return await self.backend.tool('order_receipt', {'orderId': orders[index]})
        report = report_request(text)
        selection = None
        if focused:
            lower, number = focused
            if number is None:
                order_id = state.get('lastAcceptedOrderId')
                if not order_id:
                    return "Choose a listed order, e.g. 'order ingredients for order 1', or accept an order in this chat first."
            else:
                listed = state.get('orders', [])
                if not 1 <= number <= len(listed):
                    return "Ask for 'orders' first, then choose a listed order number, e.g. 'plan order 1'."
                order_id = listed[number - 1]
            state['productionOrderId'] = order_id
            selection = period('', fallback=state.get('period'))
        elif report:
            command, expression = report
            prior = state.get('period')
            # A newly supplied date uses the local current year unless explicit.
            # Only undated follow-ups reuse the saved period; an old test year
            # must not silently change "orders October 10" into a future search.
            selection = period(expression, fallback=prior if command != 'orders' else None)
            lower = command
            state['period'] = selection
            if expression or command == 'orders':
                state.pop('productionOrderId', None)
        production_order = state.get('productionOrderId')
        production_selection = {'orderId': production_order} if production_order else selection
        listed = state.get('orders', [])
        order_caption = (f"order {listed.index(production_order) + 1} only" if production_order in listed
                         else 'your last accepted order only')
        if lower == "orders":
            rows = (await self.backend.tool("orders", selection))["orders"]
            state["orders"] = [row["id"] for row in rows]
            heading = f"Orders for {describe_period(selection)}:\n"
            labels = [(row['id'], f"{i+1}. {row['customerName']} · {row['fulfillmentDate']} · {row['status']} · " + ", ".join(f"{item['quantity']} × {item['name']}" for item in row['items']) + f" · ${row['total']}") for i, row in enumerate(rows)]
            text = heading + ('\n'.join(label for _, label in labels) + "\nTap orders and an action, or say 'accept 1', 'decline 1', or 'receipt 1'." if rows else 'No order-form requests for these dates.')
            if not rows: return text
            if len(rows) > 50: text += '\nThe card shows the first 50 orders. Choose a smaller date range for more.'
            return card_reply(state, text, 'Manage orders', [choice_field(labels)],
                              [('accept', 'Accept selected'), ('decline', 'Decline selected'), ('complete', 'Complete selected'), ('receipt', 'View one receipt')])
        if lower.isdigit() and state.get('orders'):
            return f"What would you like to do with order {lower}? Say 'accept {lower}', 'decline {lower}', 'complete {lower}', or 'receipt {lower}'."
        action = re.fullmatch(r"(accept|decline|complete)\s+(\d+)", lower)
        if action:
            index = int(action[2]) - 1
            if index < 0 or index >= len(state.get("orders", [])):
                return "Ask for 'orders' first, then choose a listed order number."
            result = await self.backend.tool("change_order", {"orderId": state["orders"][index], "status": {"accept": "ACCEPTED", "decline": "DECLINED", "complete": "COMPLETED"}[action[1]]})
            if result['order']['status'] == 'ACCEPTED':
                state['lastAcceptedOrderId'] = state['orders'][index]
            return f"Order is now {result['order']['status']}."
        if lower == "plan":
            plan = await self.backend.tool("production_plan", production_selection)
            selected_dates = plan.get('period', selection)
            state['period'] = selected_dates
            scope = f"{order_caption} ({describe_period(selected_dates)})" if production_order else describe_period(selected_dates)
            return (f"Production for {scope}:\n{plan['acceptedOrders']} accepted form orders; {plan['pendingRequests']} requests still await acceptance.\n" +
                "\n".join(f"{p['productName']}: {p['packages']} {p['container']}, {p['batches']} batches, surplus {p['surplus']['amount']} {p['surplus']['unit']}" for p in plan['products']) +
                "\nIngredients:\n" + "\n".join(f"{i['name']}: {i['amount']} {i['unit']}" for i in plan['ingredients']) + "\n" + plan['calculation'] +
                "\nSay 'order ingredients' to shop all of these ingredients together on Instacart.")
        if lower == "labels":
            result = await self.backend.tool("labels", selection)
            return {"text": f"Created {result['labelCount']} printable labels for {describe_period(selection)} from the caterer's saved product details.", "html": result["html"]}
        if lower == "groceries":
            result = await self.backend.tool("grocery_list", production_selection)
            selected_dates = result.get('period', selection)
            state['period'] = selected_dates
            scope = f"{order_caption} ({describe_period(selected_dates)})" if production_order else describe_period(selected_dates)
            reply = {"text": f"Ingredients for {scope}:\n" + result["message"] + ("\n" + result["url"] if result.get("url") else "") + "\n\nRecipe requirements:\n" + "\n".join(f"{i['name']}: {i['amount']} {i['unit']}" for i in result['ingredients'])}
            if result.get('html'):
                reply.update(html=result['html'], documentKind=result['documentKind'])
            return reply
        if lower == "deals":
            result = await self.backend.tool('grocery_offers', production_selection)
            selected_dates = result.get('period', selection)
            state['period'] = selected_dates
            scope = f"{order_caption} ({describe_period(selected_dates)})" if production_order else describe_period(selected_dates)
            rows = [f"Ingredient deals for {scope}:", result['message']]
            if result.get('checkedAt'):
                rows.append(f"Store {result['locationId']} · checked {result['checkedAt']}")
            for offer in result['offers']:
                rows.append(f"{offer['ingredient']} — need {offer['requiredAmount']} {offer['requiredUnit']}")
                rows.extend(f"  {p['name']} ({p['packSize']}): ${p['salePrice']}, regularly ${p['regularPrice']}" for p in offer['candidates'])
                if not offer['candidates']: rows.append('  No current promotion returned among the searched matches.')
            return '\n'.join(rows)
        if lower == "notify":
            rows = (await self.backend.tool("orders", selection))["orders"]
            ids = [row['id'] for row in rows if row['status'] in ('ACCEPTED', 'COMPLETED')]
            if not ids:
                return "There are no accepted or completed orders to notify in that date range."
            state.update(flow="notify", step="window", data={"orderIds": ids})
            return f"What delivery/pickup window should I tell these {len(ids)} customers? Include the date and local time."
        recipient = re.fullmatch(r"(?:set )?notification\s+(\d+)\s+to\s+(.+)", text, re.I)
        if recipient:
            index = int(recipient[1]) - 1
            if index < 0 or index >= len(state.get('notifications', [])):
                return "Create drafts with 'notify' first, then use a listed notification number."
            result = await self.backend.tool('update_notification_recipient', {
                'notificationId': state['notifications'][index], 'recipient': recipient[2].strip()})
            draft = result['notification']
            state['selectedNotification'] = state['notifications'][index]
            return (f"Notification {index + 1} is now addressed to {draft['recipient']}:\n{draft['body']}\n"
                    "Only this draft's recipient changed. Nothing has been sent. Say 'send notification' to send it to this saved number.")
        if lower.startswith(('notification ', 'set notification ')):
            return "Use 'notification 1 to +12025550143', replacing the example with your number including its country code."
        send = re.fullmatch(r"send\s+notification(?:\s+(\d+))?(?:\s+confirm)?", lower)
        if send:
            notifications = state.get('notifications', [])
            if not notifications:
                return "Create notification drafts with 'notify' first."
            if send[1]:
                index = int(send[1]) - 1
                if index < 0 or index >= len(notifications):
                    return "Choose a listed notification number, e.g. 'send notification 1'."
                notification_id = notifications[index]
            elif len(notifications) == 1:
                notification_id = notifications[0]
            elif state.get('selectedNotification') in notifications:
                notification_id = state['selectedNotification']
            else:
                return f"There are {len(notifications)} notification drafts. Choose one, e.g. 'send notification 1'. I'll use its saved recipient."
            result = await self.backend.tool("send_notification", {"notificationId": notification_id, "confirm": True})
            state['selectedNotification'] = notification_id
            return result.get("message", f"Notification status: {result['status']}.")
        turn = await self.interpreter.extract(text, {})
        if turn['intent'] == 'CREATE_FORM':
            return await self.forms.start(state, text, turn)
        if turn['intent'] == 'ORDERS':
            return await self._respond(state, 'orders ' + turn['dateExpression'])
        return HELP

    async def _wizard(self, state: dict, text: str):
        if state.get('naturalForm'):
            return await self.forms.respond(state, text)
        flow, step, data = state['flow'], state['step'], state['data']
        if flow == "recipe":
            if step == "product":
                index = int(text) - 1
                if index < 0 or index >= len(state['choices']): raise ValueError("Choose a listed product number.")
                product = state['choices'][index]
                data.update(menuItemId=product['id'], container={}, recipe={"name": product['name']})
                state['step'] = 'container'
                return "What do you call the selling container, e.g. a dumpling box or a soup tub?"
            if step == 'container':
                data['container']['name'] = text; state['step'] = 'capacity'
                return "What is the measured container capacity? Use units, e.g. 12 each, 500 g, or 750 ml."
            if step == 'capacity':
                data['container']['capacity'] = measure(text); state['step'] = 'fill'
                return "How much product will you actually put in each container? Use the same measurement dimension."
            if step == 'fill':
                data['container']['fill'] = measure(text); state['step'] = 'yield'
                return "What is the measured finished yield of one recipe batch? For example, 60 each or 3 kg."
            if step == 'yield':
                data['recipe']['yield'] = measure(text); state['step'] = 'ingredients'
                return "List ingredients for ONE batch, separated by semicolons: flour: 500 g; water: 300 ml; wrappers: 60 each."
            if step == 'ingredients':
                ingredients = []
                for line in text.split(';'):
                    name, separator, amount = line.partition(':')
                    if not separator or not name.strip(): raise ValueError("Use ingredient: amount unit, separated by semicolons.")
                    ingredients.append({"name": name.strip(), "measure": measure(amount)})
                data['recipe']['ingredients'] = ingredients; state['step'] = 'allergens'
                return "Which allergens should the labels declare? Separate them with commas, or say 'none listed'."
            if step == 'allergens':
                data['recipe']['allergens'] = [] if text.lower() in ('none', 'none listed') else [part.strip() for part in text.split(',')]
                state['step'] = 'storage'; return "What storage instructions should appear on the labels?"
            if step == 'storage':
                data['recipe']['storageInstructions'] = text
                result = await self.backend.tool('save_recipe', data)
                state.clear()
                return f"Saved the recipe and container for {result['product']['productName']}. Say 'new form' to collect orders."
        if flow == 'form':
            correction = await check_form_fulfillment(self.backend, state)
            if correction:
                if text.upper() not in state['supportedFulfillmentMethods']:
                    return correction
                step = state['step']
            if step == 'review':
                if text.lower().rstrip('.!') in CONFIRMATIONS:
                    return await publish_form(self.backend, state)
                if text.lower() == 'review':
                    return await review_form(self.backend, state)
                correction = re.fullmatch(r'(title|fulfillmentDate|closesAt|fulfillmentMethod|fulfillmentInstructions|minimumOrder|deliveryFee):\s*(.+)', text, re.I)
                if not correction:
                    return "Reply 'publish', 'cancel', or a correction such as 'title: Saturday dumplings'."
                field = next(key for key in data if key.lower() == correction[1].lower())
                value = correction[2]
                if field in ('minimumOrder', 'deliveryFee'): value = normalize_budget(value.lstrip('$'))
                if field == 'fulfillmentDate': value = single_day(value).isoformat()
                if field == 'fulfillmentMethod': value = value.upper()
                data[field] = value
                state.pop('reviewedForm', None)
                if field == 'fulfillmentMethod':
                    correction = await check_form_fulfillment(self.backend, state)
                    if correction:
                        return correction
                    data.pop('fulfillmentInstructions', None)
                    data.pop('deliveryFee', None)
                    state['step'] = 'fulfillmentInstructions'
                    return fulfillment_instructions(state)
                return await review_form(self.backend, state)
            if step == 'products':
                products = []
                for part in text.split(','):
                    match = re.fullmatch(r"\s*(\d+)\s*:\s*(\d+)\s*", part)
                    if not match:
                        raise ValueError("Choose product:number of packages, e.g. 1:50 for up to 50 packages of product 1. I'll ask for the form title next.")
                    number, count = match.groups()
                    index = int(number) - 1
                    if index < 0 or index >= len(state['choices']): raise ValueError("Choose a listed product number.")
                    if not 1 <= int(count) <= 10000: raise ValueError("Choose a package limit between 1 and 10,000.")
                    if any(p['productSpecId'] == state['choices'][index]['id'] for p in products): raise ValueError("List each product once, e.g. 1:50, 2:30.")
                    products.append({"productSpecId": state['choices'][index]['id'], "maxPackages": int(count)})
                data['products'] = products; state['step'] = 'title'; return "What title should customers see on this order form?"
            prompts = {'title': ('fulfillmentDate', 'What is the pickup/delivery date? For example, June 15, 2030 or tomorrow. Include a year for a future year.'),
                       'fulfillmentDate': ('closesAt', 'When do orders close? Include a time zone, e.g. 2030-06-10T18:00:00-04:00.'),
                       'closesAt': ('fulfillmentMethod', fulfillment_question(state)),
                       'fulfillmentMethod': ('fulfillmentInstructions', ''),
                       'fulfillmentInstructions': ('minimumOrder', 'What is the minimum food subtotal for this form, in dollars? Enter 0 for none.'),
                       'minimumOrder': ('deliveryFee', 'What delivery fee applies, in dollars? Enter 0 for pickup or free delivery.')}
            if step in prompts:
                if step == 'closesAt': datetime.fromisoformat(text.replace('Z', '+00:00'))
                if step == 'fulfillmentDate': text = single_day(text).isoformat()
                data[step] = normalize_budget(text.lstrip('$')) if step == 'minimumOrder' else text.upper() if step == 'fulfillmentMethod' else text
                if step == 'fulfillmentMethod':
                    correction = await check_form_fulfillment(self.backend, state)
                    if correction:
                        return correction
                    prompts[step] = ('fulfillmentInstructions', fulfillment_instructions(state))
                state['step'], prompt = prompts[step]; return prompt
            if step == 'deliveryFee':
                data[step] = normalize_budget(text.lstrip('$'))
                return await review_form(self.backend, state)
        if flow == 'notify':
            data['deliveryWindow'] = text
            result = await self.backend.tool('draft_notifications', data)
            state.clear(); state['notifications'] = [item['id'] for item in result['notifications']]
            command = 'send notification' if len(state['notifications']) == 1 else 'send notification 1'
            text = '\n\n'.join(f"{i+1}. To {item['recipient']}: {item['body']}" for i, item in enumerate(result['notifications'])) + f"\nSay '{command}' to send to the saved recipient. To change a number, say 'notification 1 to +12025550143' with your own number."
            if not result['notifications']: return text
            return card_reply(state, text, 'Review customer updates', [choice_field(
                ((item['id'], f"{i+1}. To {item['recipient']}: {item['body']}") for i, item in enumerate(result['notifications'])), multi=False)],
                [('send_notification', 'Send selected notification')])
        raise ValueError("Say 'cancel' to restart this setup.")


async def cli():
    agent = CatererConversation()
    print(HELP)
    while True:
        text = await asyncio.to_thread(input, "Caterer: ")
        if text.lower() in ("exit", "quit"): return
        try:
            reply = await agent.handle('local-caterer', text)
            print(reply['text'])
            if reply.get('html'):
                if reply.get('documentKind') == 'receipt':
                    filename = f"caterer-receipt-{reply['orderId']}.html"
                else:
                    filename = 'caterer-groceries.html' if reply.get('documentKind') == 'grocery_demo' else 'caterer-labels.html'
                path = Path('artifacts') / filename; path.parent.mkdir(exist_ok=True)
                path.write_text(reply['html']); print(f"Open or print your document: {path.resolve()}")
        except Exception:
            print("The caterer backend is unavailable. Check that caterer:backend is running and its migration is applied.")


if __name__ == '__main__':
    asyncio.run(cli())
