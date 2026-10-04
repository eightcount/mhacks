from __future__ import annotations

import os
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from importlib.util import find_spec
from io import StringIO
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fetch_agent.caterer_fetch import main


@unittest.skipUnless(find_spec('uagents'), 'Install requirements.txt for Fetch startup tests.')
class CatererFetchTests(unittest.IsolatedAsyncioTestCase):
    async def exercise(self, allowlist: str, sender: str, reply=None):
        from uagents import Agent
        from uagents_core.contrib.protocols.chat import ChatMessage, TextContent
        from uagents_core.models import Model

        engine = AsyncMock(return_value=reply or {'text': 'Fictional menu result.'})
        captured = {}
        context = SimpleNamespace(send=AsyncMock())

        async def run(agent):
            captured['agent'] = agent
            handler = agent._signed_message_handlers[Model.build_schema_digest(ChatMessage)]
            await handler(context, sender, ChatMessage(
                timestamp=datetime.now(timezone.utc), msg_id=uuid4(),
                content=[TextContent(type='text', text=f'@{agent.address} menu')],
            ))

        environment = {
            'FETCH_CATERER_SEED': 'fictional-caterer-fetch-startup-seed',
            'FETCH_CATERER_ALLOWED_SENDERS': allowlist,
        }
        output = StringIO()
        with (
            TemporaryDirectory() as directory,
            patch.dict(os.environ, environment, clear=True),
            patch('uagents.agent.get_almanac_contract', return_value=None),
            patch('uagents.asgi.HOST'),
            patch.object(Agent, 'run_async', new=run),
            patch.object(Agent, 'publish_manifest', new=AsyncMock()),
            patch('fetch_agent.caterer_fetch.CatererConversation.handle', new=engine),
            redirect_stdout(output),
        ):
            previous = os.getcwd()
            try:
                os.chdir(directory)
                await main()
                import uagents.asgi
                self.assertEqual(uagents.asgi.HOST, '127.0.0.1')
            finally:
                os.chdir(previous)
        self.assertNotIn(environment['FETCH_CATERER_SEED'], output.getvalue())
        return captured['agent'], context, engine

    async def test_unconfigured_owner_can_register_but_cannot_use_management_tools(self):
        agent, context, engine = await self.exercise('', 'fictional-untrusted-sender')
        self.assertTrue(agent._use_mailbox)
        self.assertTrue(agent._enable_agent_inspector)
        self.assertTrue(agent._publish_agent_details)
        self.assertIn('Private caterer assistant', agent._description)
        self.assertIn('new form', agent._readme)
        engine.assert_not_awaited()
        self.assertEqual(context.send.await_count, 2)
        self.assertIn('Owner access is required', context.send.await_args.args[1].content[0].text)

    async def test_authorized_owner_reaches_the_caterer_engine(self):
        _, context, engine = await self.exercise('fictional-owner-sender', 'fictional-owner-sender')
        engine.assert_awaited_once_with('fetch:fictional-owner-sender', 'menu')
        self.assertEqual(context.send.await_args.args[1].content[0].text, 'Fictional menu result.')

    async def test_other_senders_remain_denied_after_owner_configuration(self):
        _, context, engine = await self.exercise('fictional-owner-sender', 'fictional-other-sender')
        engine.assert_not_awaited()
        self.assertIn('Owner access is required', context.send.await_args.args[1].content[0].text)

    async def test_authorized_reply_is_text_only_even_if_engine_returns_a_card(self):
        from uagents_core.contrib.protocols.chat import TextContent
        reply = {'text': 'Choose orders', 'card': {'id': str(uuid4()), 'title': 'Manage orders',
                 'fields': [], 'actions': [{'id': 'accept', 'label': 'Accept selected'}]}}
        _, context, _ = await self.exercise('fictional-owner-sender', 'fictional-owner-sender', reply)
        content = context.send.await_args.args[1].content
        self.assertEqual(len(content), 1)
        self.assertIsInstance(content[0], TextContent)
        self.assertEqual(content[0].text, 'Choose orders')


if __name__ == '__main__':
    unittest.main()
