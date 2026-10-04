from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from uuid import uuid4

from .backend import AgentBackendClient
from .conversation import CateringConversationEngine


async def _run_agent() -> None:
    """Run one standard uAgent with Fetch.ai's documented Agent Chat Protocol."""
    logging.basicConfig(
        level=os.environ.get("FETCH_AGENT_LOG_LEVEL") or "INFO",
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    try:
        from uagents import Agent, Context, Protocol
        from uagents_core.contrib.protocols.chat import (
            ChatAcknowledgement,
            ChatMessage,
            TextContent,
            chat_protocol_spec,
        )
    except ImportError as error:
        raise RuntimeError("Install requirements.txt before running the Fetch uAgent.") from error

    seed = os.environ.get("FETCH_AGENT_SEED")
    customer_id = os.environ.get("FETCH_AGENT_DEFAULT_CUSTOMER_ID")
    if not seed or not customer_id:
        raise RuntimeError(
            "FETCH_AGENT_SEED and FETCH_AGENT_DEFAULT_CUSTOMER_ID are required to run the uAgent."
        )

    agent = Agent(
        name=os.environ.get("FETCH_AGENT_NAME") or "catering-marketplace-agent",
        seed=seed,
        port=int(os.environ.get("FETCH_AGENT_PORT") or "8001"),
        mailbox=os.environ.get("FETCH_AGENT_MAILBOX", "false").lower() == "true",
        publish_agent_details=True,
        loop=asyncio.get_running_loop(),
    )
    chat_protocol = Protocol(spec=chat_protocol_spec)
    engine = CateringConversationEngine(AgentBackendClient.from_environment())

    def text_reply(text: str) -> ChatMessage:
        return ChatMessage(
            timestamp=datetime.now(timezone.utc),
            msg_id=uuid4(),
            content=[TextContent(type="text", text=text)],
        )

    @chat_protocol.on_message(ChatMessage)
    async def handle_chat_message(ctx: Context, sender: str, msg: ChatMessage):
        await ctx.send(
            sender,
            ChatAcknowledgement(
                timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id
            ),
        )
        text = "\n".join(item.text for item in msg.content if isinstance(item, TextContent)).strip()
        text = text.removeprefix(f"@{agent.address}").strip()
        if not text:
            return
        reply = await engine.handle_message(f"uagent:{sender}", customer_id, text)
        await ctx.send(sender, text_reply(reply.text))

    @chat_protocol.on_message(ChatAcknowledgement)
    async def handle_chat_acknowledgement(ctx: Context, sender: str, msg: ChatAcknowledgement):
        """Receive delivery receipts without triggering marketplace actions."""

    agent.include(chat_protocol, publish_manifest=True)
    await agent.run_async()


def run() -> None:
    """Create the event loop before initializing uAgents, including on Python 3.14."""
    asyncio.run(_run_agent())


if __name__ == "__main__":
    run()
