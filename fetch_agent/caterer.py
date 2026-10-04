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
        "• 'labels' — printable distribution labels\n• 'order ingredients' — shop all batch ingredients on Instacart\n"
        "• 'deals' — current ingredient promotions at your configured store\n"
        "• 'notify' — draft a fulfillment update for accepted orders\n"
        "Say 'June 10th' or 'orders June 10, 2030' for one day's orders; date ranges also work. "
        "After viewing orders or a plan, 'order ingredients' uses those dates. "
        "Say 'cancel' to leave a setup conversation.")


def measure(text: str) -> dict:
    match = re.fullmatch(r"\s*(\d+(?:\.\d{1,3})?)\s*(g|kg|ml|l|each)\s*", text, re.I)
    if not match:
        raise ValueError("Use an amount and unit, such as 12 each, 500 g, or 750 ml.")
    return {"amount": match[1], "unit": match[2].lower()}


class CatererConversation:
    def __init__(self, backend=None):
        self.backend = backend or CatererBackend()
        self.locks: dict[str, asyncio.Lock] = {}

    async def handle(self, session: str, text: str) -> dict:
        async with self.locks.setdefault(session, asyncio.Lock()):
            state = (await self.backend.tool("session", {"sessionId": session}))["draft"]
            try:
                reply = await self._respond(state, text.strip())
                await self.backend.tool("session", {"sessionId": session, "draft": state})
                return reply if isinstance(reply, dict) else {"text": reply}
            except (ValueError, KeyError, IndexError) as error:
                return {"text": str(error) or "Please check that value and try again."}

    async def _respond(self, state: dict, text: str):
        lower = text.lower()
        if lower == "cancel":
            state.clear()
            return "Setup cancelled. " + HELP
        if state.get("flow"):
            if lower in ("new form", "new recipe", "orders", "menu", "plan", "labels"):
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
        if lower == "menu":
            items = (await self.backend.tool("menu", {}))["items"]
            return "\n".join(f"{i+1}. {item['name']} — ${item['price']}" for i, item in enumerate(items)) or "No active menu items."
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
        report = report_request(text)
        selection = None
        if report:
            command, expression = report
            prior = state.get('period')
            selection = period(expression, year=int(prior['start'][:4]) if prior else None,
                               fallback=prior if command != 'orders' else None)
            lower = command
            state['period'] = selection
        if lower == "orders":
            rows = (await self.backend.tool("orders", selection))["orders"]
            state["orders"] = [row["id"] for row in rows]
            heading = f"Orders for {describe_period(selection)}:\n"
            return heading + (("\n".join(f"{i+1}. {row['customerName']} · {row['fulfillmentDate']} · {row['status']} · " + ", ".join(f"{item['quantity']} × {item['name']}" for item in row['items']) + f" · ${row['total']}" for i, row in enumerate(rows)) + "\nTo respond, say 'accept 1' or 'decline 1' using the listed number.") if rows else "No order-form requests for these dates.")
        if lower.isdigit() and state.get('orders'):
            return f"What would you like to do with order {lower}? Say 'accept {lower}', 'decline {lower}', or 'complete {lower}'."
        action = re.fullmatch(r"(accept|decline|complete)\s+(\d+)", lower)
        if action:
            index = int(action[2]) - 1
            if index < 0 or index >= len(state.get("orders", [])):
                return "Ask for 'orders' first, then choose a listed order number."
            result = await self.backend.tool("change_order", {"orderId": state["orders"][index], "status": {"accept": "ACCEPTED", "decline": "DECLINED", "complete": "COMPLETED"}[action[1]]})
            return f"Order is now {result['order']['status']}."
        if lower == "plan":
            plan = await self.backend.tool("production_plan", selection)
            return (f"Production for {describe_period(selection)}:\n{plan['acceptedOrders']} accepted form orders; {plan['pendingRequests']} requests still await acceptance.\n" +
                "\n".join(f"{p['productName']}: {p['packages']} {p['container']}, {p['batches']} batches, surplus {p['surplus']['amount']} {p['surplus']['unit']}" for p in plan['products']) +
                "\nIngredients:\n" + "\n".join(f"{i['name']}: {i['amount']} {i['unit']}" for i in plan['ingredients']) + "\n" + plan['calculation'] +
                "\nSay 'order ingredients' to shop all of these ingredients together on Instacart.")
        if lower == "labels":
            result = await self.backend.tool("labels", selection)
            return {"text": f"Created {result['labelCount']} printable labels for {describe_period(selection)} from the caterer's saved product details.", "html": result["html"]}
        if lower == "groceries":
            result = await self.backend.tool("grocery_list", selection)
            reply = {"text": f"Ingredients for {describe_period(selection)}:\n" + result["message"] + ("\n" + result["url"] if result.get("url") else "") + "\n\nRecipe requirements:\n" + "\n".join(f"{i['name']}: {i['amount']} {i['unit']}" for i in result['ingredients'])}
            if result.get('html'):
                reply.update(html=result['html'], documentKind=result['documentKind'])
            return reply
        if lower == "deals":
            result = await self.backend.tool('grocery_offers', selection)
            rows = [f"Ingredient deals for {describe_period(selection)}:", result['message']]
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
        send = re.fullmatch(r"send notification (\d+) confirm", lower)
        if send:
            index = int(send[1]) - 1
            if index < 0 or index >= len(state.get("notifications", [])):
                return "Create notification drafts with 'notify' first."
            result = await self.backend.tool("send_notification", {"notificationId": state['notifications'][index], "confirm": True})
            return result.get("message", f"Notification status: {result['status']}.")
        return HELP

    async def _wizard(self, state: dict, text: str):
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
                       'closesAt': ('fulfillmentMethod', 'Will customers use pickup or delivery?'),
                       'fulfillmentMethod': ('fulfillmentInstructions', 'What pickup location or delivery instructions should appear on the form?'),
                       'fulfillmentInstructions': ('minimumOrder', 'What is the minimum food subtotal for this form, in dollars? Enter 0 for none.'),
                       'minimumOrder': ('deliveryFee', 'What delivery fee applies, in dollars? Enter 0 for pickup or free delivery.')}
            if step in prompts:
                if step == 'closesAt': datetime.fromisoformat(text.replace('Z', '+00:00'))
                if step == 'fulfillmentDate': text = single_day(text).isoformat()
                data[step] = normalize_budget(text.lstrip('$')) if step == 'minimumOrder' else text.upper() if step == 'fulfillmentMethod' else text
                state['step'], prompt = prompts[step]; return prompt
            if step == 'deliveryFee':
                data[step] = normalize_budget(text.lstrip('$'))
                result = await self.backend.tool('create_form', data)
                state.clear(); return f"Your order form is ready: {result['url']}\n{result['message']}"
        if flow == 'notify':
            data['deliveryWindow'] = text
            result = await self.backend.tool('draft_notifications', data)
            state.clear(); state['notifications'] = [item['id'] for item in result['notifications']]
            return '\n\n'.join(f"{i+1}. To {item['recipient']}: {item['body']}" for i, item in enumerate(result['notifications'])) + "\nReview these drafts. To send one, say 'send notification 1 confirm'. A messaging provider must be connected."
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
                filename = 'caterer-groceries.html' if reply.get('documentKind') == 'grocery_demo' else 'caterer-labels.html'
                path = Path('artifacts') / filename; path.parent.mkdir(exist_ok=True)
                path.write_text(reply['html']); print(f"Open or print your document: {path.resolve()}")
        except Exception:
            print("The caterer backend is unavailable. Check that caterer:backend is running and its migration is applied.")


if __name__ == '__main__':
    asyncio.run(cli())
