import copy
import unittest
from datetime import date
from unittest.mock import patch, AsyncMock

from .caterer import CatererConversation, measure, period


class FakeBackend:
    def __init__(self):
        self.sessions = {}
        self.calls = []
        self.orders = [{"id": "order-one", "customerName": "Fictional Customer", "fulfillmentDate": "2030-06-15", "status": "ACCEPTED", "items": [{"name": "Dumplings", "quantity": 2}], "total": "23.00"}]

    async def tool(self, name, payload):
        self.calls.append((name, copy.deepcopy(payload)))
        if name == "session":
            if "draft" in payload:
                self.sessions[payload["sessionId"]] = copy.deepcopy(payload["draft"])
            return {"draft": copy.deepcopy(self.sessions.get(payload["sessionId"], {}))}
        return {
            "menu": {"items": [{"id": "menu-one", "name": "Dumplings", "price": "11.50"}]},
            "save_recipe": {"product": {"productName": "Dumplings"}},
            "recipes": {"products": [{"id": "spec-one", "productName": "Dumplings", "spec": {"container": {"name": "box"}}}]},
            "create_form": {"url": "http://localhost/forms/demo", "message": "Share this form link."},
            "orders": {"orders": self.orders},
            "production_plan": {"acceptedOrders": 1, "pendingRequests": 0, "products": [],
                                "ingredients": [{"name": "Flour", "amount": "1000", "unit": "g"}], "calculation": "Whole batches."},
            "grocery_list": {"message": "Review the full ingredient list on Instacart; no order placed.",
                             "url": "https://www.instacart.com/store/shopping_lists/test", "ingredients": [{"name": "Flour", "amount": "1000", "unit": "g"}]},
            "change_order": {"order": {"status": payload.get("status")}},
            "draft_notifications": {"notifications": [{"id": "notice-one", "recipient": "fictional@example.invalid", "body": "Delivery between 2 and 3 pm."}]},
            "send_notification": {"status": "NOT_CONNECTED", "message": "No transport configured."},
        }[name]


class CatererConversationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.backend = FakeBackend()
        self.agent = CatererConversation(self.backend)

    async def say(self, text):
        return (await self.agent.handle("owner", text))["text"]

    async def test_recipe_wizard_survives_agent_restart(self):
        await self.say("new recipe")
        await self.say("1")
        self.agent = CatererConversation(self.backend)
        for value in ("box", "12 each", "12 each", "60 each", "flour: 500 g; water: 300 ml", "wheat", "Refrigerate"):
            reply = await self.say(value)
        self.assertIn("Saved", reply)
        saved = [payload for name, payload in self.backend.calls if name == "save_recipe"][0]
        self.assertEqual(saved["container"]["fill"], {"amount": "12", "unit": "each"})
        self.assertEqual(saved["recipe"]["yield"]["amount"], "60")
        self.assertEqual(len(saved["recipe"]["ingredients"]), 2)
        self.assertEqual(self.backend.sessions["owner"], {})

    async def test_form_collects_capacity_fulfillment_minimum_and_fee(self):
        await self.say("new form")
        for value in ("1:50", "Friday dumplings", "2030-06-15", "2030-06-10T18:00:00-04:00", "delivery", "Fictional test area", "$20", "$3.25"):
            reply = await self.say(value)
        self.assertIn("http://localhost/forms/demo", reply)
        saved = [payload for name, payload in self.backend.calls if name == "create_form"][0]
        self.assertEqual(saved["products"], [{"productSpecId": "spec-one", "maxPackages": 50}])
        self.assertEqual(saved["minimumOrder"], "20.00")
        self.assertEqual(saved["deliveryFee"], "3.25")
        self.assertEqual(saved["fulfillmentMethod"], "DELIVERY")

    async def test_order_numbers_use_persisted_owner_session(self):
        self.assertIn("first", await self.say("accept 1"))
        await self.say("orders 2030-06-10 2030-06-16")
        self.agent = CatererConversation(self.backend)
        self.assertIn("ACCEPTED", await self.say("accept 1"))
        self.assertIn(("change_order", {"orderId": "order-one", "status": "ACCEPTED"}), self.backend.calls)
        other = await self.agent.handle("other-owner-session", "accept 1")
        self.assertIn("first", other["text"])

    async def test_notifications_require_review_and_explicit_send(self):
        await self.say("notify 2030-06-10 2030-06-16")
        draft = await self.say("June 15, 2–3pm local time")
        self.assertIn("fictional@example.invalid", draft)
        await self.say("send notification 1")
        self.assertFalse(any(name == "send_notification" for name, _ in self.backend.calls))
        await self.say("send notification 1 confirm")
        self.assertIn(("send_notification", {"notificationId": "notice-one", "confirm": True}), self.backend.calls)

    async def test_bad_measurement_keeps_current_step_and_cancel_clears_state(self):
        for value in ("new recipe", "1", "box"):
            await self.say(value)
        self.assertIn("amount and unit", await self.say("medium sized"))
        self.assertEqual(self.backend.sessions["owner"]["step"], "capacity")
        await self.say("cancel")
        self.assertEqual(self.backend.sessions["owner"], {})

    async def test_form_bad_selection_gives_actionable_prompt_without_losing_step(self):
        await self.say('new form')
        for text in ('test catering orders', '1', '1:-1', '1:0', '1:50,1:10'):
            response = await self.say(text)
            self.assertNotIn('unpack', response)
            self.assertEqual(self.backend.sessions['owner']['step'], 'products')
        self.assertIn('listed product', await self.say('2:50'))
        self.assertIn('title', await self.say('1:50'))

    async def test_command_during_recipe_explains_cancel(self):
        for value in ('new recipe', '1', 'box', '12 each', '12 each', '60 each'):
            await self.say(value)
        self.assertIn('ingredient: amount unit', await self.say('wheat'))
        self.assertIn('cancel', await self.say('new form'))
        self.assertEqual(self.backend.sessions['owner']['step'], 'ingredients')
        await self.say('cancel')
        self.assertIn('maximum packages', await self.say('new form'))

    async def test_bare_order_number_does_not_accept_order(self):
        self.assertIn('accept 1', await self.say('orders'))
        self.assertIn('accept 1', await self.say('1'))
        self.assertFalse(any(name == 'change_order' for name, _ in self.backend.calls))

    def test_units_and_explicit_date_ranges(self):
        self.assertEqual(measure("0.125 kg"), {"amount": "0.125", "unit": "kg"})
        self.assertEqual(period("orders 2030-06-10 2030-06-16"), {"start": "2030-06-10", "end": "2030-06-16"})
        self.assertEqual(period("orders 2030-06-10"), {"start": "2030-06-10", "end": "2030-06-10"})

    async def test_named_day_alone_uses_one_day_and_shows_assumed_year(self):
        with patch('fetch_agent.caterer_dates.local_today', return_value=date(2026, 10, 4)):
            reply = await self.say('June 10th')
        self.assertIn('June 10, 2026', reply)
        self.assertIn(('orders', {'start': '2026-06-10', 'end': '2026-06-10'}), self.backend.calls)

    async def test_followup_plan_and_instacart_keep_the_selected_date_after_restart(self):
        await self.say('orders June 10, 2030')
        self.agent = CatererConversation(self.backend)
        self.assertIn('June 10, 2030', await self.say('June 10th'))
        self.assertIn('order ingredients', await self.say('plan'))
        self.agent = CatererConversation(self.backend)
        reply = await self.say('order all ingredients from instacart')
        self.assertIn('June 10, 2030', reply)
        self.assertIn('instacart.com', reply)
        self.assertIn('no order placed', reply)
        selected = {'start': '2030-06-10', 'end': '2030-06-10'}
        self.assertIn(('production_plan', selected), self.backend.calls)
        self.assertIn(('grocery_list', selected), self.backend.calls)
        self.assertFalse(any(name == 'change_order' for name, _ in self.backend.calls))

    async def test_invalid_day_does_not_query_orders_or_replace_date_selection(self):
        await self.say('orders June 10, 2030')
        self.backend.calls.clear()
        self.assertIn('valid calendar date', await self.say('orders February 30'))
        self.assertFalse(any(name == 'orders' for name, _ in self.backend.calls))
        self.assertEqual(self.backend.sessions['owner']['period']['start'], '2030-06-10')

    async def test_demo_shopping_document_is_forwarded_without_claiming_a_purchase(self):
        real_tool = self.backend.tool
        async def tool(name, payload):
            if name == 'grocery_list':
                return {'message': 'DEMO ONLY — no order has been placed.', 'ingredients': [],
                        'html': '<p>Sample basket</p>', 'documentKind': 'grocery_demo'}
            return await real_tool(name, payload)
        self.backend.tool = AsyncMock(side_effect=tool)
        reply = await self.agent.handle('owner', 'order ingredients June 10, 2030')
        self.assertEqual(reply['documentKind'], 'grocery_demo')
        self.assertEqual(reply['html'], '<p>Sample basket</p>')
        self.assertIn('DEMO ONLY', reply['text'])
        self.assertIn('no order has been placed', reply['text'])
        self.assertNotIn('instacart.com', reply['text'])

    async def test_form_accepts_a_named_fulfillment_date(self):
        for value in ('new form', '1:50', 'Test menu', 'June 15th, 2030'):
            await self.say(value)
        self.assertEqual(self.backend.sessions['owner']['data']['fulfillmentDate'], '2030-06-15')


if __name__ == "__main__":
    unittest.main()
