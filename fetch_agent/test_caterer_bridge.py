import os
import unittest
from contextlib import redirect_stdout
from importlib.util import find_spec
from io import StringIO
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from .caterer_bridge import main, process_message


class CatererBridgeTests(unittest.IsolatedAsyncioTestCase):
    @unittest.skipUnless(find_spec('uagents'), 'Install requirements.txt for Fetch startup tests.')
    async def test_runtime_disables_cards_for_imessage(self):
        from uagents import Agent

        with (
            TemporaryDirectory() as directory,
            patch.dict(os.environ, {'CATERER_INTERNAL_TOKEN': 't' * 32,
                                    'FETCH_CATERER_SEED': 'fictional-bridge-seed'}, clear=True),
            patch('uagents.agent.get_almanac_contract', return_value=None),
            patch('uagents.asgi.HOST'),
            patch.object(Agent, 'run_async', new=AsyncMock()),
            patch('fetch_agent.caterer_bridge.CatererConversation') as conversation,
            redirect_stdout(StringIO()),
        ):
            previous = os.getcwd()
            try:
                os.chdir(directory)
                await main()
            finally:
                os.chdir(previous)
        conversation.assert_called_once_with(interactive_cards=False)

    async def test_bridge_discards_interactive_card_metadata(self):
        card = {'id': 'fictional-card', 'title': 'Orders', 'fields': [], 'actions': []}
        engine = SimpleNamespace(handle=AsyncMock(return_value={'text': 'Choose orders', 'card': card}))
        payload = SimpleNamespace(token='t' * 32, session_id='photon-chat:' + 'a' * 64, text='orders')
        reply = await process_message(payload, engine, 't' * 32)
        self.assertEqual(reply['text'], 'Choose orders')
        self.assertNotIn('card', reply)

    async def test_token_and_session_checked_before_agent(self):
        engine = SimpleNamespace(handle=AsyncMock(return_value={'text': 'ok'}))
        payload = SimpleNamespace(token='wrong', session_id='photon-chat:' + 'a' * 64, text='menu')
        self.assertFalse((await process_message(payload, engine, 't' * 32))['ok'])
        payload.token = 't' * 32
        payload.session_id = 'local-caterer'
        self.assertFalse((await process_message(payload, engine, 't' * 32))['ok'])
        engine.handle.assert_not_awaited()

    async def test_valid_session_and_private_errors(self):
        engine = SimpleNamespace(handle=AsyncMock(return_value={'text': 'labels', 'html': '<p>Labels</p>'}))
        payload = SimpleNamespace(token='t' * 32, session_id='photon-chat:' + 'a' * 64, text='labels')
        reply = await process_message(payload, engine, 't' * 32)
        self.assertTrue(reply['ok'])
        self.assertEqual(reply['html'], '<p>Labels</p>')
        engine.handle.assert_awaited_once_with(payload.session_id, 'labels')
        engine.handle.side_effect = RuntimeError('private database info')
        reply = await process_message(payload, engine, 't' * 32)
        self.assertFalse(reply['ok'])
        self.assertNotIn('private database', reply['text'])

    async def test_demo_document_kind_survives_bridge(self):
        engine = SimpleNamespace(handle=AsyncMock(return_value={
            'text': 'DEMO ONLY', 'html': '<p>Sample basket</p>', 'documentKind': 'grocery_demo'}))
        payload = SimpleNamespace(token='t' * 32, session_id='photon-chat:' + 'a' * 64, text='order ingredients')
        reply = await process_message(payload, engine, 't' * 32)
        self.assertTrue(reply['ok'])
        self.assertEqual(reply['documentKind'], 'grocery_demo')

    async def test_receipt_text_and_document_survive_bridge(self):
        engine = SimpleNamespace(handle=AsyncMock(return_value={
            'text': 'Order receipt\nTotal: $23.00', 'html': '<h1>Order receipt</h1>', 'documentKind': 'receipt'}))
        payload = SimpleNamespace(token='t' * 32, session_id='photon-chat:' + 'a' * 64, text='receipt 1')
        reply = await process_message(payload, engine, 't' * 32)
        self.assertTrue(reply['ok'])
        self.assertEqual(reply['documentKind'], 'receipt')
        self.assertEqual(reply['html'], '<h1>Order receipt</h1>')
        self.assertIn('Total: $23.00', reply['text'])
