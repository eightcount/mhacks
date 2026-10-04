import copy
import json
import unittest
from unittest.mock import patch

from .caterer import CatererConversation
from .test_caterer import FakeBackend


class CardBackend(FakeBackend):
    async def tool(self, name, payload):
        if name == 'change_orders':
            self.calls.append((name, copy.deepcopy(payload)))
            return {'orders': [{'id': key, 'status': payload['status']} for key in payload['orderIds']]}
        result = await super().tool(name, payload)
        if name == 'recipes':
            result['products'][0]['menuItemId'] = 'menu-one'
            result['products'].append({**result['products'][0], 'id': 'spec-two', 'menuItemId': 'menu-two', 'productName': 'Rice'})
        if name == 'menu':
            result['items'].append({'id': 'menu-two', 'name': 'Rice', 'price': '10.00'})
        return result


class CatererCardTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.backend = CardBackend()
        self.backend.orders *= 0
        self.backend.orders += [{'id': f'order-{i}', 'customerName': f'Fictional buyer {i}', 'fulfillmentDate': '2030-06-15',
                                 'status': 'REQUESTED', 'items': [{'name': 'Rice', 'quantity': 2}], 'total': '20.00'} for i in range(1, 9)]
        self.agent = CatererConversation(self.backend)

    async def say(self, text):
        return await self.agent.handle('owner', text)

    async def tap(self, reply, action, **values):
        return await self.say(json.dumps({'card_id': reply['card']['id'], 'action': action, **values}))

    async def test_selects_eighth_order_and_multiple_orders_with_stable_ids(self):
        reply = await self.say('orders June 15, 2030')
        self.assertTrue(reply['card']['fields'][0]['choices'][7]['label'].startswith('8.'))
        # Even if another query reorders underlying results, this card uses IDs.
        self.backend.orders.reverse()
        self.agent = CatererConversation(self.backend)
        result = await self.tap(reply, 'accept', selected=['order-8', 'order-2'])
        self.assertIn('2 order(s) now ACCEPTED', result['text'])
        self.assertIn(('change_orders', {'orderIds': ['order-8', 'order-2'], 'status': 'ACCEPTED'}), self.backend.calls)
        await self.tap(reply, 'accept', selected=['order-8'])
        self.assertEqual(sum(name == 'change_orders' for name, _ in self.backend.calls), 1)

    async def test_rejects_stale_cross_session_expired_and_forged_choices(self):
        reply = await self.say('orders June 15, 2030')
        self.assertIn('shown on this card', (await self.tap(reply, 'accept', selected=['foreign-order']))['text'])
        self.assertIn('shown on this card', (await self.tap(reply, 'accept', selected=['order-1', 'order-1']))['text'])
        payload = json.dumps({'card_id': reply['card']['id'], 'action': 'accept', 'selected': ['order-1']})
        self.assertIn('out of date', (await self.agent.handle('another-owner-chat', payload))['text'])
        with patch('fetch_agent.caterer_cards.time.time', return_value=9999999999):
            self.assertIn('out of date', (await self.say(payload))['text'])
        await self.say('menu')
        self.assertIn('out of date', (await self.say(payload))['text'])
        self.assertFalse(any(name == 'change_orders' for name, _ in self.backend.calls))

    async def test_two_menu_products_become_one_form_with_individual_limits(self):
        menu = await self.say('menu')
        products = await self.tap(menu, 'choose_products', selected=['menu-one', 'menu-two'])
        self.assertEqual(len(products['card']['fields'][0]['choices']), 2)
        title = await self.tap(products, 'products', selected=['spec-one', 'spec-two'], **{'qty_spec-one': '50', 'qty_spec-two': 30})
        self.assertIn('title', title['text'])
        self.assertEqual(self.backend.sessions['owner']['data']['products'], [
            {'productSpecId': 'spec-one', 'maxPackages': 50}, {'productSpecId': 'spec-two', 'maxPackages': 30}])
        for answer in ('Fictional menu', 'June 15, 2030', '2030-06-14T12:00:00-04:00', 'PICKUP', 'Fictional area', '0', '0'):
            title = await self.tap(title, 'answer', answer=answer)
        self.assertFalse(any(name == 'create_form' for name, _ in self.backend.calls))
        await self.tap(title, 'publish_form')
        created = [payload for name, payload in self.backend.calls if name == 'create_form']
        self.assertEqual(len(created), 1)
        self.assertEqual(len(created[0]['products']), 2)

    async def test_quantity_error_keeps_the_product_picker(self):
        reply = await self.say('new form')
        error = await self.tap(reply, 'products', selected=['spec-one'])
        self.assertIn('package limit', error['text'])
        self.assertIn('card', error)
        result = await self.tap(error, 'products', selected=['spec-one'], **{'qty_spec-one': '12'})
        self.assertIn('title', result['text'])

    async def test_owner_card_selection_round_trips_as_json(self):
        reply = await self.say('orders June 15, 2030')
        self.assertTrue(reply['card']['fields'][0]['multi'])
        result = await self.tap(reply, 'accept', selected=['order-8'])
        self.assertIn('ACCEPTED', result['text'])

    async def test_planner_forwarded_selection_preserves_explicit_identifiers(self):
        reply = await self.say('orders June 15, 2030')
        result = await self.say(f"User picked order-8 on card {reply['card']['id']}, action: accept.")
        self.assertIn('ACCEPTED', result['text'])
        self.assertIn(('change_orders', {'orderIds': ['order-8'], 'status': 'ACCEPTED'}), self.backend.calls)

    async def test_notification_requires_a_tap_and_cannot_be_sent_twice(self):
        self.backend.orders[0]['status'] = 'ACCEPTED'
        await self.say('notify June 15, 2030')
        reply = await self.say('2–3 PM Eastern')
        self.assertFalse(any(name == 'send_notification' for name, _ in self.backend.calls))
        await self.tap(reply, 'send_notification', selected='notice-one')
        await self.tap(reply, 'send_notification', selected='notice-one')
        self.assertEqual(sum(name == 'send_notification' for name, _ in self.backend.calls), 1)


class TextOnlyCatererTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.backend = CardBackend()
        self.agent = CatererConversation(self.backend, interactive_cards=False)

    async def say(self, text):
        reply = await self.agent.handle('fetch:owner', text)
        self.assertNotIn('card', reply)
        self.assertNotIn('card', self.backend.sessions.get('fetch:owner', {}))
        return reply['text']

    async def test_menu_orders_and_guided_forms_work_with_typed_replies(self):
        self.assertIn('Dumplings', await self.say('menu'))
        self.assertIn('Fictional Customer', await self.say('orders June 15, 2030'))
        self.assertIn('maximum packages', await self.say('new form'))
        for answer in ('1:50, 2:30', 'Fictional menu', 'June 15, 2030',
                       '2030-06-14T12:00:00-04:00', 'PICKUP', 'Fictional hall', '0', '0'):
            response = await self.say(answer)
        self.assertIn('Review your order form', response)
        self.assertFalse(any(name == 'create_form' for name, _ in self.backend.calls))
        self.assertIn('ready:', await self.say('publish'))

    async def test_old_card_click_cannot_execute_and_clears_saved_card(self):
        old = await CatererConversation(self.backend).handle('fetch:owner', 'orders June 15, 2030')
        response = await self.say(json.dumps({'card_id': old['card']['id'], 'action': 'accept', 'selected': ['order-one']}))
        self.assertIn('disabled', response)
        self.assertFalse(any(name in ('change_order', 'change_orders') for name, _ in self.backend.calls))
        self.assertIn('ACCEPTED', await self.say('accept 1'))

    async def test_invalid_wizard_answer_remains_text_only(self):
        await self.say('new form')
        self.assertIn('Choose product', await self.say('not a selection'))
        self.assertEqual(self.backend.sessions['fetch:owner']['step'], 'products')

    async def test_existing_draft_resumes_without_cards_after_restart(self):
        await CatererConversation(self.backend).handle('fetch:owner', 'new form')
        self.assertIn('title', await self.say('1:20'))
        self.assertEqual(self.backend.sessions['fetch:owner']['data']['products'][0]['maxPackages'], 20)
