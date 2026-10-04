from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from uuid import uuid4

from .caterer import CatererConversation


async def main():
    from uagents import Agent, Model, Protocol
    from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage, TextContent, chat_protocol_spec

    seed = os.environ.get('FETCH_CATERER_SEED')
    if not seed:
        raise ValueError('Run caterer:configure to create a separate caterer agent identity.')
    allowed = {value.strip() for value in os.environ.get('FETCH_CATERER_ALLOWED_SENDERS', '').split(',') if value.strip()}
    # Registration must be possible before the owner has a Fetch chat sender.
    # An empty allowlist still denies every management request below.
    import uagents.asgi
    uagents.asgi.HOST = '127.0.0.1'
    port = int(os.environ.get('FETCH_CATERER_PORT') or '8002')
    agent = Agent(name='catering-operations-agent', seed=seed, port=port,
                  mailbox=True, loop=asyncio.get_running_loop(), publish_agent_details=True,
                  readme_path=str(Path(__file__).with_name('caterer-profile.md')),
                  description='Private caterer assistant for order forms, weekly production, ingredients, labels, and customer updates.',
                  report_events=False, store_message_history=False, log_level=logging.CRITICAL)
    protocol = Protocol(spec=chat_protocol_spec)
    engine = CatererConversation(interactive_cards=False)

    class Health(Model):
        service: str
        ownerAccessConfigured: bool

    @agent.on_rest_get('/caterer/fetch-health', Health)
    async def health(ctx):
        return Health(service='caterer-fetch-agent', ownerAccessConfigured=bool(allowed))

    @protocol.on_message(ChatMessage)
    async def handle(ctx, sender, msg):
        await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id))
        if sender not in allowed:
            response = ('This agent manages a private catering business. Owner access is required. '
                        f'Your Fetch sender address is {sender}. '
                        'The owner must authorize their own direct Fetch sender before management commands are enabled.')
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
        await ctx.send(sender, ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(),
                                          content=[TextContent(type='text', text=response)]))

    @protocol.on_message(ChatAcknowledgement)
    async def receipt(ctx, sender, msg):
        pass

    agent.include(protocol, publish_manifest=True)
    inspector = f"{agent.agentverse.url}/inspect/?" + urlencode({
        'uri': f'http://127.0.0.1:{port}', 'address': agent.address,
    })
    print(f'[caterer-fetch] Agent: {agent.address}', flush=True)
    print(f'[caterer-fetch] Connect in Agentverse: {inspector}', flush=True)
    if not allowed:
        print('[caterer-fetch] Owner access is not configured; all management requests will be denied.', flush=True)
    await agent.run_async()


if __name__ == '__main__':
    asyncio.run(main())
