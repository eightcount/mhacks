from __future__ import annotations

import asyncio
import os

from .backend import AgentBackendClient
from .conversation import CateringConversationEngine


async def main() -> None:
    customer_id = os.environ.get("FETCH_AGENT_DEFAULT_CUSTOMER_ID")
    if not customer_id:
        raise RuntimeError("FETCH_AGENT_DEFAULT_CUSTOMER_ID is required for local CLI mode.")
    conversation_id = os.environ.get("FETCH_AGENT_LOCAL_SESSION", "local-catering-demo")
    engine = CateringConversationEngine(AgentBackendClient.from_environment())
    print("Local catering agent. Type 'exit' to stop.")
    while True:
        message = input("Customer: ").strip()
        if message.lower() in {"exit", "quit"}:
            return
        if not message:
            continue
        reply = await engine.handle_message(conversation_id, customer_id, message)
        print(f"Agent: {reply.text}")


if __name__ == "__main__":
    asyncio.run(main())
