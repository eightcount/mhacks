from __future__ import annotations

import asyncio
import os
import unittest
from importlib.util import find_spec
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fetch_agent.fetch_agent import run


@unittest.skipUnless(find_spec("uagents"), "Install requirements.txt for Fetch startup tests.")
class FetchStartupTests(unittest.TestCase):
    def test_direct_mention_reaches_engine_as_item_selection(self) -> None:
        from uagents import Agent
        from uagents_core.contrib.protocols.chat import ChatMessage, TextContent
        from uagents_core.models import Model
        from datetime import datetime, timezone
        from uuid import uuid4

        handler = AsyncMock(return_value=SimpleNamespace(text="Draft created."))

        async def deliver_message(agent: Agent) -> None:
            chat = agent._signed_message_handlers[Model.build_schema_digest(ChatMessage)]
            context = SimpleNamespace(send=AsyncMock())
            await chat(context, "fictional-sender", ChatMessage(
                timestamp=datetime.now(timezone.utc), msg_id=uuid4(),
                content=[TextContent(type="text", text=f"@{agent.address} vegetable dumpling, 10")],
            ))
            self.assertEqual(context.send.await_count, 2)

        environment = {
            "FETCH_AGENT_SEED": "fictional-fetch-startup-test-seed",
            "FETCH_AGENT_DEFAULT_CUSTOMER_ID": "11000000-0000-4000-8000-000000000006",
            "AGENT_INTERNAL_TOKEN": "fictional-internal-test-token",
        }
        with (
            TemporaryDirectory() as directory,
            patch.dict(os.environ, environment, clear=True),
            patch("uagents.agent.get_almanac_contract", return_value=None),
            patch.object(Agent, "run_async", new=deliver_message),
            patch.object(Agent, "publish_manifest", new=AsyncMock()),
            patch("fetch_agent.fetch_agent.CateringConversationEngine.handle_message", new=handler),
        ):
            previous_directory = os.getcwd()
            try:
                os.chdir(directory)
                run()
            finally:
                os.chdir(previous_directory)
        handler.assert_awaited_once_with("uagent:fictional-sender", environment["FETCH_AGENT_DEFAULT_CUSTOMER_ID"],
                                        "vegetable dumpling, 10")

    def test_starts_without_an_existing_event_loop_and_closes_it(self) -> None:
        from uagents import Agent

        runtime_loops: list[asyncio.AbstractEventLoop] = []

        async def capture_runtime(_agent: Agent) -> None:
            runtime_loops.append(asyncio.get_running_loop())

        environment = {
            "FETCH_AGENT_SEED": "fictional-fetch-startup-test-seed",
            "FETCH_AGENT_DEFAULT_CUSTOMER_ID": "11000000-0000-4000-8000-000000000006",
            "AGENT_INTERNAL_TOKEN": "fictional-internal-test-token",
            "FETCH_AGENT_MAILBOX": "true",
        }

        # Use the real SDK constructor while disabling its network runtime and
        # manifest publication. Keep any SDK storage in a temporary directory.
        with (
            TemporaryDirectory() as directory,
            patch.dict(os.environ, environment, clear=True),
            patch("uagents.agent.get_almanac_contract", return_value=None),
            patch.object(Agent, "run_async", new=capture_runtime),
            patch.object(Agent, "publish_manifest", new=AsyncMock()),
        ):
            previous_directory = os.getcwd()
            try:
                os.chdir(directory)
                asyncio.set_event_loop(None)
                run()
            finally:
                os.chdir(previous_directory)

        self.assertEqual(len(runtime_loops), 1)
        self.assertTrue(runtime_loops[0].is_closed())


if __name__ == "__main__":
    unittest.main()
