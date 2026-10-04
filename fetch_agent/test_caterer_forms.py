import copy
import json
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from .caterer import CatererConversation
from .caterer_form_dates import closing_time
from .caterer_intents import RuleCatererInterpreter, AsiCatererInterpreter, validate_turn
from .test_caterer import FakeBackend


class NaturalFormTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.clock = patch('fetch_agent.caterer_dates.local_today', return_value=date(2026, 10, 4))
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.backend = FakeBackend()
        self.restart()

    def restart(self):
        self.agent = CatererConversation(self.backend, RuleCatererInterpreter())

    async def say(self, text):
        return (await self.agent.handle('owner', text))['text']

    def draft(self):
        return self.backend.sessions['owner']

    async def ready(self):
        await self.say('Create an order form for dumplings this Saturday.')
        await self.say('50 boxes, pickup only, orders close Friday at 6pm Eastern')
        return await self.say('Fictional Demo Hall, 123 Example Lane')

    async def test_exact_order_question_queries_only_requested_day(self):
        for text in ('What orders do I have for Saturday?', 'Which requests have I received for Saturday?',
                     'Can you show me my orders for Saturday please?'):
            response = await self.say(text)
            self.assertIn('Fictional Customer', response)
            self.assertIn(('orders', {'start': '2026-10-10', 'end': '2026-10-10'}), self.backend.calls)
        self.assertFalse(any(name.startswith('create') for name, _ in self.backend.calls))

    async def test_exact_demo_merges_details_survives_restart_and_requires_review(self):
        first = await self.say('Create an order form for dumplings this Saturday.')
        self.assertIn('$11.50', first)
        self.assertIn('2026-10-10', first)
        self.restart()
        response = await self.say('50 boxes, pickup only, orders close Friday at 6')
        self.assertIn('location', response)
        response = await self.say('Fictional Demo Hall, 123 Example Lane')
        self.assertIn('AM or PM', response)
        self.assertEqual(self.draft()['data']['fulfillmentDate'], '2026-10-10')
        self.restart()
        review = await self.say('6pm Eastern')
        self.assertIn('Review your order form', review)
        self.assertIn('October 09, 2026', review)
        self.assertIn('up to 50 packages', review)
        self.assertFalse(any(name == 'create_form' for name, _ in self.backend.calls))
        self.restart()
        self.assertIn('http://localhost/forms/demo', await self.say('publish'))
        saved = [payload for name, payload in self.backend.calls if name == 'create_form'][0]
        self.assertEqual(saved['closesAt'], '2026-10-09T18:00:00-04:00')
        self.assertEqual(saved['products'][0]['expectedUnitPrice'], '11.50')
        self.assertNotIn('flow', self.draft())
        await self.say('publish')
        self.assertEqual(sum(name == 'create_form' for name, _ in self.backend.calls), 1)

    async def test_corrections_invalidate_review_and_do_not_publish(self):
        await self.ready()
        review = await self.say('Actually, make it 40 boxes')
        self.assertIn('up to 40 packages', review)
        self.assertFalse(any(name == 'create_form' for name, _ in self.backend.calls))
        await self.say('publish')
        saved = next(p for name, p in self.backend.calls if name == 'create_form')
        self.assertEqual(saved['products'][0]['maxPackages'], 40)

    async def test_deadline_first_and_changed_fulfillment_keep_correct_fields(self):
        await self.say('Create an order form for dumplings this Saturday.')
        await self.say('Orders close Friday at 6pm Eastern, 50 boxes, pickup only')
        await self.say('Fictional Demo Hall')
        self.assertEqual(self.draft()['data']['fulfillmentDate'], '2026-10-10')
        response = await self.say('delivery instead')
        self.assertIn('delivery instructions', response)
        self.assertNotIn('reviewedForm', self.draft())
        await self.say('Fictional demo delivery area')
        await self.say('delivery fee is $3.25')
        self.assertEqual(self.draft()['reviewedForm']['deliveryFee'], '3.25')
        self.assertIn('Review your order form', await self.say('orders close Thursday at 5pm Eastern'))
        self.assertEqual(self.draft()['data']['closesAt'], '2026-10-08T17:00:00-04:00')

    async def test_sale_date_change_updates_generated_title_and_relative_deadline(self):
        await self.ready()
        await self.say('Actually, Saturday October 17, 2026')
        self.assertEqual(self.draft()['data']['fulfillmentDate'], '2026-10-17')
        self.assertIn('2026-10-17', self.draft()['data']['title'])
        self.assertEqual(self.draft()['data']['closesAt'], '2026-10-16T18:00:00-04:00')

    async def test_ambiguous_product_and_recipe_revisions_do_not_choose_arbitrarily(self):
        original = self.backend.tool
        async def catalog(name, payload):
            result = await original(name, payload)
            if name == 'menu':
                result['items'] = [{'id': 'menu-one', 'name': 'Vegetable Dumplings', 'price': '11.50'},
                                   {'id': 'menu-two', 'name': 'Mushroom Dumplings', 'price': '12.00'}]
            if name == 'recipes':
                result['products'] = [
                    {**result['products'][0], 'id': 'newest-spec'},
                    result['products'][0],
                    {**result['products'][0], 'id': 'other-spec', 'menuItemId': 'menu-two'}]
            return result
        self.backend.tool = catalog
        response = await self.say('Create an order form for dumplings Saturday')
        self.assertIn('More than one', response)
        self.assertNotIn('selectedProduct', self.draft())
        self.assertEqual(len(self.draft()['choices']), 2)
        await self.say('Vegetable Dumplings')
        self.assertEqual(self.draft()['selectedProduct'], 'newest-spec')

    async def test_cancel_and_premature_confirm_never_publish(self):
        await self.say('Create a form for dumplings Saturday')
        self.assertIn('How many', await self.say('publish'))
        await self.say('cancel')
        await self.say('publish')
        self.assertFalse(any(name == 'create_form' for name, _ in self.backend.calls))

    async def test_unknown_and_ambiguous_products_are_not_guessed(self):
        response = await self.say('Create a form for tacos Saturday')
        self.assertIn('could not find', response)
        self.assertNotIn('selectedProduct', self.draft())
        await self.say('1')
        self.assertEqual(self.draft()['selectedProduct'], 'spec-one')
        self.assertEqual(self.draft()['data']['fulfillmentDate'], '2026-10-10')

    async def test_price_is_not_overridden_by_conversation(self):
        await self.say('Create a form for dumplings Saturday')
        response = await self.say('50 boxes at $12 per box, pickup only')
        self.assertIn('saved menu price of $11.50', response)
        self.assertNotIn('quotedPrice', self.draft()['data'])
        self.assertNotIn('reviewedForm', self.draft())
        await self.say('use menu price')
        self.assertEqual(self.draft()['step'], 'fulfillmentInstructions')

    async def test_changed_price_requires_another_review(self):
        await self.ready()
        original = self.backend.tool
        async def changed(name, payload):
            if name == 'create_form':
                raise ValueError('A menu price changed. Review the form again before publishing.')
            result = await original(name, payload)
            if name == 'preview_form':
                result['form']['products'][0]['unitPrice'] = '12.00'
            return result
        self.backend.tool = changed
        response = await self.say('publish')
        self.assertIn('nothing was published', response)
        self.assertIn('$12.00', response)
        self.assertEqual(self.draft()['reviewedForm']['products'][0]['expectedUnitPrice'], '12.00')

    async def test_invalid_quantity_preserves_previous_draft(self):
        await self.ready()
        before = copy.deepcopy(self.draft()['data'])
        response = await self.say('0 boxes')
        self.assertIn('whole number', response)
        self.assertEqual(self.draft()['data'], before)

    async def test_unsupported_pickup_is_explained_early_and_keeps_other_details(self):
        self.backend.supported_fulfillment_methods = ['DELIVERY']
        await self.say('Create an order form for dumplings this Saturday.')
        response = await self.say('50 boxes, pickup only, orders close Friday at 6pm Eastern')
        self.assertIn('configured for delivery only', response)
        draft = self.draft()
        self.assertEqual(draft['step'], 'fulfillmentMethod')
        self.assertEqual(draft['data']['products'][0]['maxPackages'], 50)
        self.assertEqual(draft['data']['fulfillmentDate'], '2026-10-10')
        self.assertEqual(draft['data']['closesAt'], '2026-10-09T18:00:00-04:00')
        self.assertNotIn('fulfillmentMethod', draft['data'])
        self.assertFalse(any(name == 'preview_form' for name, _ in self.backend.calls))
        self.restart()
        self.assertIn('delivery instructions', await self.say('delivery'))
        await self.say('Delivery within the fictional demo area')
        self.assertIn('Review your order form', await self.say('free delivery'))
        self.assertIn('ready:', await self.say('publish'))

    async def test_supported_method_is_named_when_no_method_was_requested(self):
        self.backend.supported_fulfillment_methods = ['PICKUP']
        await self.say('Create an order form for dumplings this Saturday.')
        response = await self.say('50 boxes')
        self.assertIn("pickup only. Reply 'pickup'", response)

    async def test_existing_incompatible_review_cannot_publish_after_restart(self):
        await self.ready()
        self.backend.supported_fulfillment_methods = ['DELIVERY']
        self.restart()
        response = await self.say('publish')
        self.assertIn('configured for delivery only', response)
        self.assertNotIn('reviewedForm', self.draft())
        self.assertNotIn('fulfillmentInstructions', self.draft()['data'])
        self.assertNotIn('deliveryFee', self.draft()['data'])
        self.assertFalse(any(name == 'create_form' for name, _ in self.backend.calls))
        self.assertIn('delivery instructions', await self.say('delivery instead'))
        self.assertNotIn('fulfillmentInstructions', self.draft()['data'])

    async def test_method_correction_is_not_saved_as_delivery_instructions(self):
        await self.say('Create an order form for dumplings this Saturday.')
        await self.say('50 boxes, pickup only, orders close Friday at 6pm Eastern')
        self.assertEqual(self.draft()['step'], 'fulfillmentInstructions')
        self.backend.supported_fulfillment_methods = ['DELIVERY']
        response = await self.say('delivery instead')
        self.assertIn('delivery instructions', response)
        self.assertNotIn('fulfillmentInstructions', self.draft()['data'])

    async def test_guided_form_offers_supported_method_and_resumes_old_draft(self):
        self.backend.supported_fulfillment_methods = ['DELIVERY']
        await self.say('new form')
        for answer in ('1:50', 'Demo form', '2030-06-15', '2030-06-14T18:00:00-04:00'):
            response = await self.say(answer)
        self.assertIn('configured for delivery only', response)
        self.assertIn('configured for delivery only', await self.say('pickup'))
        self.assertIn('delivery instructions', await self.say('delivery'))
        for answer in ('Fictional delivery area', '0', '0'):
            response = await self.say(answer)
        self.assertIn('Review your order form', response)
        self.backend.supported_fulfillment_methods = ['PICKUP']
        self.restart()
        self.assertIn('configured for pickup only', await self.say('publish'))
        self.assertIn('pickup location', await self.say('pickup'))
        self.assertEqual(self.draft()['data']['products'][0]['maxPackages'], 50)
        self.assertFalse(any(name == 'create_form' for name, _ in self.backend.calls))

    async def test_publish_card_and_isolated_sessions(self):
        await self.ready()
        card = self.draft()['card']['view']
        payload = json.dumps({'card_id': card['id'], 'action': 'publish_form'})
        self.assertNotIn('ready:', (await self.agent.handle('other', payload))['text'])
        self.assertIn('ready:', await self.say(payload))
        self.assertEqual(sum(name == 'create_form' for name, _ in self.backend.calls), 1)


class FormInterpretationTests(unittest.IsolatedAsyncioTestCase):
    async def test_model_adapter_returns_validated_fields_and_rejects_tool_calls(self):
        client = MagicMock()
        client.__aenter__.return_value = client
        client.chat.completions.create = AsyncMock()
        client.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(
            content=json.dumps({'intent': 'UPDATE_FORM', 'patch': {'maxPackages': 40, 'fulfillmentMethod': 'PICKUP'}})))])
        factory = MagicMock(return_value=client)
        interpreter = AsiCatererInterpreter('fictional-key')
        with patch.dict('sys.modules', {'openai': SimpleNamespace(AsyncOpenAI=factory)}):
            result = await interpreter.extract('Make that forty containers for collection', {'naturalForm': True})
            self.assertEqual(result['patch'], {'maxPackages': 40, 'fulfillmentMethod': 'PICKUP'})
            self.assertEqual(factory.call_args.kwargs['timeout'], 20)
            client.chat.completions.create.return_value.choices[0].message.content = json.dumps({'intent': 'PUBLISH_FORM'})
            with self.assertLogs('fetch_agent.caterer_intents'):
                result = await interpreter.extract('50 boxes', {'naturalForm': True, 'step': 'maxPackages'})
            self.assertEqual(result['intent'], 'UPDATE_FORM')
            self.assertEqual(result['patch']['maxPackages'], 50)

    async def test_model_output_cannot_choose_tools_sql_prices_or_publication(self):
        for value in ({'intent': 'PUBLISH_FORM'}, {'intent': 'UPDATE_FORM', 'patch': {'sql': 'anything'}},
                      {'intent': 'UPDATE_FORM', 'patch': {'productSpecId': 'foreign-id'}},
                      {'intent': 'UPDATE_FORM', 'patch': {'maxPackages': True}},
                      {'intent': 'UPDATE_FORM', 'patch': {'unitPrice': '0.01'}},
                      {'intent': 'ORDERS', 'patch': {'maxPackages': 2}}):
            with self.assertRaises(ValueError):
                validate_turn(value)

    async def test_unavailable_model_falls_back_without_logging_message_or_credentials(self):
        interpreter = AsiCatererInterpreter('fictional-test-key')
        with patch.dict('sys.modules', {'openai': None}), self.assertLogs('fetch_agent.caterer_intents') as logs:
            turn = await interpreter.extract('Create a form for dumplings Saturday', {})
        self.assertEqual(turn['intent'], 'CREATE_FORM')
        self.assertEqual(turn['patch']['product'], 'dumplings')
        self.assertNotIn('fictional-test-key', str(logs.output))

    def test_deadline_requires_unambiguous_time_and_zone(self):
        with patch.dict('os.environ', {}, clear=True):
            with self.assertRaisesRegex(ValueError, 'AM or PM'):
                closing_time('Friday at 6', '2026-10-10')
            with self.assertRaisesRegex(ValueError, 'time zone'):
                closing_time('Friday at 6pm', '2026-10-10')
        self.assertEqual(closing_time('Friday at 6pm Eastern', '2026-10-10'), '2026-10-09T18:00:00-04:00')
        self.assertEqual(closing_time('Eastern', '2026-10-10', 'Friday at 6pm'), '2026-10-09T18:00:00-04:00')
        with self.assertRaisesRegex(ValueError, 'skipped'):
            closing_time('March 8, 2026 at 2:30am Eastern', '2026-03-09')
        with self.assertRaisesRegex(ValueError, 'twice'):
            closing_time('November 1, 2026 at 1:30am Eastern', '2026-11-02')


if __name__ == '__main__':
    unittest.main()
