import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock
from .caterer_bridge import process_message


class CatererBridgeTests(unittest.IsolatedAsyncioTestCase):
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
