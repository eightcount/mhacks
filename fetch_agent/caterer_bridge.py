"""Authenticated loopback REST boundary hosted by the Fetch uAgent runtime."""
from __future__ import annotations

import asyncio
import hmac
import logging
import os
import re
from typing import Literal

from .caterer import CatererConversation


async def process_message(payload, engine, expected_token):
    if not expected_token or not hmac.compare_digest(payload.token, expected_token):
        return {"ok": False, "text": "Unauthorized", "html": None}
    if not re.fullmatch(r"photon-chat:[a-f0-9]{64}", payload.session_id):
        return {"ok": False, "text": "Invalid conversation", "html": None}
    try:
        result = await engine.handle(payload.session_id, payload.text)
        return {"ok": True, "text": result['text'], "html": result.get('html'), "documentKind": result.get('documentKind')}
    except Exception:
        # Do not expose backend responses, customer records, or credentials in logs.
        return {"ok": False, "text": "The caterer backend could not finish that request.", "html": None}


async def main():
    from uagents import Agent, Model
    from pydantic import Field
    import uagents.asgi

    token = os.environ.get('CATERER_INTERNAL_TOKEN', '')
    seed = os.environ.get('FETCH_CATERER_SEED', '')
    if len(token) < 32 or not seed:
        raise ValueError('Run npm run caterer:configure before starting the Photon bridge.')
    # uAgents currently exposes a module-level ASGI bind address, not an Agent
    # constructor host option. This standalone process only accepts local calls.
    uagents.asgi.HOST = '127.0.0.1'
    agent = Agent(name='catering-operations-agent', seed=seed,
                  port=int(os.environ.get('CATERER_BRIDGE_PORT') or '8003'),
                  loop=asyncio.get_running_loop(), mailbox=False,
                  enable_agent_inspector=False, publish_agent_details=False,
                  report_events=False, mark_inactive_on_shutdown=False, log_level=logging.CRITICAL)
    engine = CatererConversation()

    class Inbound(Model):
        token: str = Field(min_length=32, max_length=256, repr=False)
        session_id: str = Field(max_length=100)
        text: str = Field(min_length=1, max_length=8000)

    class Reply(Model):
        ok: bool
        text: str
        html: str | None = None
        documentKind: Literal['labels', 'grocery_demo'] | None = None

    class Health(Model):
        service: str

    @agent.on_rest_get('/caterer/health', Health)
    async def health(ctx):
        return Health(service='caterer-fetch-bridge')

    @agent.on_rest_post('/caterer/message', Inbound, Reply)
    async def message(ctx, request):
        return Reply(**await process_message(request, engine, token))

    print('[caterer-bridge] starting authenticated local Fetch endpoint', flush=True)
    await agent.run_async()


if __name__ == '__main__':
    asyncio.run(main())
