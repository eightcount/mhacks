import copy
import unittest
from datetime import date
from unittest.mock import patch, AsyncMock

from .caterer import CatererConversation, measure, period


class FakeBackend:
    def __init__(self):
        self.sessions = {}
        self.calls = []
        self.supported_fulfillment_methods = ['PICKUP', 'DELIVERY']
        self.orders = [{"id": "order-one", "customerName": "Fictional Customer", "fulfillmentDate": "2030-06-15", "status": "ACCEPTED", "items": [{"name": "Dumplings", "quantity": 2}], "total": "23.00"}]

    async def tool(self, name, payload):
        self.calls.append((name, copy.deepcopy(payload)))
        if name == "session":
            if "draft" in payload:
                self.sessions[payload["sessionId"]] = copy.deepcopy(payload["draft"])
            return {"draft": copy.deepcopy(self.sessions.get(payload["sessionId"], {}))}
        if name == 'preview_form':
            return {'form': {**payload, 'products': [{**p, 'name': 'Dumplings', 'unitPrice': '11.50',
                            'container': 'box (12 each)'} for p in payload['products']]}}
        return {
            "form_options": {"supportedFulfillmentMethods": self.supported_fulfillment_methods},
            "menu": {"items": [{"id": "menu-one", "name": "Dumplings", "price": "11.50"}]},
            "save_recipe": {"product": {"productName": "Dumplings"}},
            "recipes": {"products": [{"id": "spec-one", "menuItemId": "menu-one", "productName": "Dumplings", "spec": {"container": {"name": "box"}}}]},
            "create_form": {"url": "http://localhost/forms/demo", "message": "Share this form link."},
            "orders": {"orders": self.orders},
            "order_receipt": {"orderId": payload.get("orderId"), "text": "Order receipt\nTotal: $23.00\nPayment not recorded.",
                              "html": "<h1>Order receipt</h1>", "documentKind": "receipt"},
            "production_plan": {"acceptedOrders": 1, "pendingRequests": 0, "products": [],
                                "ingredients": [{"name": "Flour", "amount": "1000", "unit": "g"}], "calculation": "Whole batches."},
            "grocery_list": {"message": "Review the full ingredient list on Instacart; no order placed.",
                             "url": "https://www.instacart.com/store/shopping_lists/test", "ingredients": [{"name": "Flour", "amount": "1000", "unit": "g"}]},
            "change_order": {"order": {"status": payload.get("status")}},
            "draft_notifications": {"notifications": [{"id": "notice-one", "recipient": "fictional@example.invalid", "body": "Delivery between 2 and 3 pm."}]},
            "update_notification_recipient": {"notification": {"id": payload.get("notificationId"),
                "recipient": payload.get("recipient"), "body": "Delivery between 2 and 3 pm.", "status": "DRAFT"}},
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
        for value in ("1:50", "Friday dumplings", "2030-06-15", "2030-06-10T18:00:00-04:00", "delivery", "Fictional test area", "$20", "$3.25", "publish"):
            reply = await self.say(value)
        self.assertIn("http://localhost/forms/demo", reply)
        saved = [payload for name, payload in self.backend.calls if name == "create_form"][0]
        self.assertEqual(saved["products"], [{"productSpecId": "spec-one", "maxPackages": 50, "expectedUnitPrice": "11.50"}])
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

    async def test_receipt_uses_listed_order_after_restart_and_returns_printable_document(self):
        self.assertIn('receipt 1', await self.say('orders June 15, 2030'))
        self.agent = CatererConversation(self.backend)
        for command in ('receipt 1', 'receipt', 'receipt for order 1', 'get receipt 1', 'request receipt for order #1'):
            with self.subTest(command=command):
                reply = await self.agent.handle('owner', command)
                self.assertIn('Total: $23.00', reply['text'])
                self.assertEqual(reply['documentKind'], 'receipt')
                self.assertEqual(reply['html'], '<h1>Order receipt</h1>')
                self.assertEqual(reply['orderId'], 'order-one')
        self.assertIn(('order_receipt', {'orderId': 'order-one'}), self.backend.calls)
        self.assertFalse(any(name in ('change_order', 'send_notification') for name, _ in self.backend.calls))

    async def test_receipt_does_not_guess_order_and_is_scoped_to_current_session(self):
        self.assertIn("'orders'", await self.say('receipt 1'))
        self.backend.sessions['owner'] = {'orders': ['order-one', 'order-two']}
        for command in ('receipt', 'receipt 0', 'receipt 3'):
            self.assertIn('Choose a listed order', await self.say(command))
        self.assertFalse(any(name == 'order_receipt' for name, _ in self.backend.calls))
        await self.say('receipt 2')
        self.assertIn(('order_receipt', {'orderId': 'order-two'}), self.backend.calls)
        other = await self.agent.handle('other-owner-session', 'receipt 2')
        self.assertIn("'orders'", other['text'])

    async def test_receipt_during_setup_keeps_the_current_question(self):
        await self.say('notify June 15, 2030')
        self.assertIn('still setting up', await self.say('receipt 1'))
        self.assertEqual(self.backend.sessions['owner']['step'], 'window')
        self.assertFalse(any(name in ('order_receipt', 'draft_notifications') for name, _ in self.backend.calls))

    async def test_notifications_require_review_and_explicit_send(self):
        await self.say("notify 2030-06-10 2030-06-16")
        draft = await self.say("June 15, 2–3pm local time")
        self.assertIn("fictional@example.invalid", draft)
        self.assertIn("'send notification'", draft)
        self.assertFalse(any(name == "send_notification" for name, _ in self.backend.calls))
        self.agent = CatererConversation(self.backend)
        self.assertIn("No transport configured", await self.say("send notification"))
        self.assertIn(("send_notification", {"notificationId": "notice-one", "confirm": True}), self.backend.calls)

    async def test_numbered_send_accepts_short_and_legacy_commands(self):
        for command in ('send notification 2', 'send notification 2 confirm'):
            with self.subTest(command=command):
                self.backend.sessions['owner'] = {'notifications': ['notice-one', 'notice-two']}
                self.backend.calls.clear()
                await self.say(command)
                sends = [payload for name, payload in self.backend.calls if name == 'send_notification']
                self.assertEqual(sends, [{'notificationId': 'notice-two', 'confirm': True}])

    async def test_simple_send_requires_an_unambiguous_draft(self):
        self.assertIn("'notify' first", await self.say('send notification'))
        self.backend.sessions['owner'] = {'notifications': ['notice-one', 'notice-two'],
                                          'selectedNotification': 'old-notice'}
        self.assertIn('Choose one', await self.say('send notification'))
        for command in ('send notification 0', 'send notification 3'):
            self.assertIn('listed notification', await self.say(command))
        self.assertFalse(any(name == 'send_notification' for name, _ in self.backend.calls))

    async def test_simple_send_remembers_the_draft_whose_phone_was_set(self):
        self.backend.sessions['owner'] = {'notifications': ['notice-one', 'notice-two']}
        await self.say('notification 2 to +12025550143')
        self.agent = CatererConversation(self.backend)
        self.backend.calls.clear()
        await self.say('send notification')
        sends = [payload for name, payload in self.backend.calls if name == 'send_notification']
        self.assertEqual(sends, [{'notificationId': 'notice-two', 'confirm': True}])
        self.assertFalse(any(name == 'update_notification_recipient' for name, _ in self.backend.calls))
        other = await self.agent.handle('other-owner-session', 'send notification')
        self.assertIn("'notify' first", other['text'])

    async def test_send_during_notification_setup_does_not_become_delivery_window(self):
        await self.say('notify June 15, 2030')
        for command in ('send notification', 'send notification 1', 'send notification 1 confirm'):
            self.assertIn('still setting up', await self.say(command))
        self.assertEqual(self.backend.sessions['owner']['step'], 'window')
        self.assertFalse(any(name in ('draft_notifications', 'send_notification') for name, _ in self.backend.calls))

    async def test_new_notification_drafts_clear_previous_selection(self):
        self.backend.sessions['owner'] = {'notifications': ['old-notice'], 'selectedNotification': 'old-notice'}
        await self.say('notify June 15, 2030')
        await self.say('June 15, 2–3 PM Eastern')
        self.assertNotIn('selectedNotification', self.backend.sessions['owner'])
        await self.say('send notification')
        self.assertIn(('send_notification', {'notificationId': 'notice-one', 'confirm': True}), self.backend.calls)

    async def test_bad_measurement_keeps_current_step_and_cancel_clears_state(self):
        for value in ("new recipe", "1", "box"):
            await self.say(value)
        self.assertIn("amount and unit", await self.say("medium sized"))
        self.assertEqual(self.backend.sessions["owner"]["step"], "capacity")
        await self.say("cancel")
        self.assertEqual(self.backend.sessions["owner"], {})

    async def test_manual_notification_phone_survives_restart_and_does_not_send(self):
        await self.say('notify June 15, 2030')
        self.assertIn('notification 1 to', await self.say('June 15, 2–3 PM Eastern'))
        self.agent = CatererConversation(self.backend)
        self.backend.calls.clear()
        reply = await self.say('notification 1 to +12025550143')
        self.assertIn('+12025550143', reply)
        self.assertIn('Delivery between 2 and 3 pm.', reply)
        self.assertIn('Nothing has been sent', reply)
        self.assertIn(('update_notification_recipient', {'notificationId': 'notice-one', 'recipient': '+12025550143'}), self.backend.calls)
        self.assertFalse(any(name == 'send_notification' for name, _ in self.backend.calls))
        self.assertEqual(self.backend.sessions['owner']['notifications'], ['notice-one'])
        self.agent = CatererConversation(self.backend)
        await self.say('send notification')
        self.assertIn(('send_notification', {'notificationId': 'notice-one', 'confirm': True}), self.backend.calls)

    async def test_manual_phone_requires_a_listed_draft_and_does_not_become_a_delivery_window(self):
        self.assertIn('Create drafts', await self.say('notification 1 to +12025550143'))
        await self.say('notify June 15, 2030')
        self.assertIn('still setting up', await self.say('notification 1 to +12025550143'))
        self.assertEqual(self.backend.sessions['owner']['step'], 'window')
        await self.say('June 15, 2–3 PM Eastern')
        for text in ('notification 0 to +12025550143', 'notification 2 to +12025550143', 'notification 1 to'):
            await self.say(text)
        self.assertFalse(any(name in ('update_notification_recipient', 'send_notification') for name, _ in self.backend.calls))

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

    async def test_new_named_dates_do_not_inherit_an_old_search_year(self):
        commands = (
            ('October 10th', 'orders'), ('orders October 10', 'orders'),
            ('What orders do I have for October 10?', 'orders'),
            ('plan October 10', 'production_plan'), ('order ingredients October 10', 'grocery_list'),
        )
        for text, tool in commands:
            with self.subTest(text=text), patch('fetch_agent.caterer_dates.local_today', return_value=date(2026, 10, 4)):
                await self.say('orders June 10, 2030')
                self.agent = CatererConversation(self.backend)
                self.backend.calls.clear()
                self.assertIn('October 10, 2026', await self.say(text))
                self.assertIn((tool, {'start': '2026-10-10', 'end': '2026-10-10'}), self.backend.calls)
                self.assertEqual(self.backend.sessions['owner']['period'], {'start': '2026-10-10', 'end': '2026-10-10'})

    async def test_new_yearless_ranges_and_explicit_year_overrides(self):
        with patch('fetch_agent.caterer_dates.local_today', return_value=date(2026, 10, 4)):
            await self.say('orders June 10, 2030')
            await self.say('orders October 10–16')
            self.assertEqual(self.backend.sessions['owner']['period'], {'start': '2026-10-10', 'end': '2026-10-16'})
            self.assertIn('October 10, 2030', await self.say('orders October 10, 2030'))
            self.assertIn('October 10, 2030', await self.say('plan'))
            self.assertIn('October 10, 2030', await self.say('order ingredients'))

    async def test_yearless_dates_follow_the_local_calendar_after_new_year(self):
        await self.say('orders October 10, 2026')
        with patch('fetch_agent.caterer_dates.local_today', return_value=date(2027, 1, 1)):
            self.assertIn('January 2, 2027', await self.say('orders January 2'))

    async def test_single_order_plan_and_followup_shopping_survive_restart(self):
        self.backend.orders.append({**self.backend.orders[0], 'id': 'order-two'})
        await self.say('orders June 15, 2030')
        reply = await self.say('plan order 2')
        self.assertIn('order 2 only', reply)
        self.assertIn(('production_plan', {'orderId': 'order-two'}), self.backend.calls)
        self.agent = CatererConversation(self.backend)
        self.backend.calls.clear()
        self.assertIn('order 2 only', await self.say('order ingredients'))
        self.assertIn(('grocery_list', {'orderId': 'order-two'}), self.backend.calls)
        self.assertFalse(any(name == 'change_order' for name, _ in self.backend.calls))

    async def test_shopping_can_reference_the_last_order_accepted_in_this_chat(self):
        self.assertIn('accept an order', await self.say('order ingredients for the order I accepted'))
        self.backend.orders.append({**self.backend.orders[0], 'id': 'order-two'})
        await self.say('orders June 15, 2030')
        await self.say('accept 2')
        self.agent = CatererConversation(self.backend)
        self.backend.calls.clear()
        for command in ('order ingredients for the order I accepted', 'plan for my last accepted order',
                        'order ingredients for order 2', 'groceries order 2'):
            self.assertIn('order 2 only', await self.say(command))
        requests = [(name, payload) for name, payload in self.backend.calls if name in ('production_plan', 'grocery_list')]
        self.assertTrue(requests)
        self.assertTrue(all(payload == {'orderId': 'order-two'} for _, payload in requests))
        other = await self.agent.handle('other-session', 'order ingredients for the order I accepted')
        self.assertIn('accept an order', other['text'])

    async def test_explicit_date_or_new_order_list_restores_combined_ingredient_planning(self):
        await self.say('orders June 15, 2030')
        await self.say('plan order 1')
        self.assertNotIn('order 1 only', await self.say('plan June 16, 2030'))
        self.backend.calls.clear()
        await self.say('order ingredients')
        self.assertIn(('grocery_list', {'start': '2030-06-16', 'end': '2030-06-16'}), self.backend.calls)
        await self.say('plan order 1')
        await self.say('orders June 15, 2030')
        self.backend.calls.clear()
        await self.say('order ingredients')
        self.assertIn(('grocery_list', {'start': '2030-06-15', 'end': '2030-06-15'}), self.backend.calls)

    async def test_invalid_order_numbers_and_active_setup_never_become_a_combined_plan(self):
        for command in ('plan order 1', 'order ingredients for order 0'):
            self.assertIn("'orders' first", await self.say(command))
        await self.say('orders June 15, 2030')
        self.backend.calls.clear()
        self.assertIn('listed order number', await self.say('order ingredients for order 2'))
        await self.say('new recipe')
        self.assertIn('still setting up', await self.say('plan order 1'))
        self.assertFalse(any(name in ('grocery_list', 'production_plan') for name, _ in self.backend.calls))

    async def test_rejected_selected_order_does_not_fall_back_to_combined_ingredients(self):
        await self.say('orders June 15, 2030')
        real_tool = self.backend.tool
        async def tool(name, payload):
            if name == 'grocery_list':
                raise ValueError('This order must be accepted before shopping.')
            return await real_tool(name, payload)
        self.backend.tool = AsyncMock(side_effect=tool)
        self.assertIn('must be accepted', await self.say('order ingredients for order 1'))
        requests = [call.args for call in self.backend.tool.await_args_list if call.args[0] == 'grocery_list']
        self.assertEqual(requests, [('grocery_list', {'orderId': 'order-one'})])
        self.assertNotIn('productionOrderId', self.backend.sessions['owner'])

    async def test_single_order_reply_uses_the_orders_actual_date(self):
        await self.say('orders June 10, 2030')
        real_tool = self.backend.tool
        async def tool(name, payload):
            result = await real_tool(name, payload)
            if name == 'production_plan':
                result['period'] = {'start': '2030-06-15', 'end': '2030-06-15'}
            return result
        self.backend.tool = AsyncMock(side_effect=tool)
        self.assertIn('June 15, 2030', await self.say('plan order 1'))
        self.assertEqual(self.backend.sessions['owner']['period'], {'start': '2030-06-15', 'end': '2030-06-15'})

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
