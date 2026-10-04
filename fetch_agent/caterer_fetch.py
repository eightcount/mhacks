from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from uuid import uuid4

from .caterer import CatererConversation


async def main():
    from uagents import Agent, Protocol
    from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage, TextContent, chat_protocol_spec

    seed = os.environ.get('FETCH_CATERER_SEED')
    if not seed:
        raise ValueError('Run caterer:configure to create a separate caterer agent identity.')
    allowed = {value.strip() for value in os.environ.get('FETCH_CATERER_ALLOWED_SENDERS', '').split(',') if value.strip()}
    if not allowed:
        raise ValueError('Set FETCH_CATERER_ALLOWED_SENDERS to the owner’s Fetch sender address before exposing management tools. Use caterer:cli locally meanwhile.')
    agent = Agent(name='catering-operations-agent', seed=seed, port=int(os.environ.get('FETCH_CATERER_PORT') or '8002'),
                  mailbox=True, loop=asyncio.get_running_loop(), publish_agent_details=True)
    protocol = Protocol(spec=chat_protocol_spec)
    engine = CatererConversation()

    @protocol.on_message(ChatMessage)
    async def handle(ctx, sender, msg):
        await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id))
        if sender not in allowed:
            response = 'This agent manages a private catering business. Owner access is required.'
        else:
            text = '\n'.join(part.text for part in msg.content if isinstance(part, TextContent)).strip().removeprefix(f'@{agent.address}').strip()
            if not text: return
            try:
                reply = await engine.handle(f'fetch:{sender}', text)
                response = reply['text']
                if reply.get('html'):
                    response += ' Repeat this request in the local caterer CLI to save the printable document.'
            except Exception:
                response = 'The catering backend could not complete that action. Please try again after checking the backend.'
        await ctx.send(sender, ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=[TextContent(type='text', text=response)]))

    @protocol.on_message(ChatAcknowledgement)
    async def receipt(ctx, sender, msg):
        pass

    agent.include(protocol, publish_manifest=True)
    await agent.run_async()


if __name__ == '__main__':
    asyncio.run(main())
