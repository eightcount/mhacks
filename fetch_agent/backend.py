from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class BackendDomainError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass
class AgentBackendClient:
    """Authenticated client for the loopback TypeScript agent-tool API."""

    base_url: str
    token: str

    @classmethod
    def from_environment(cls) -> "AgentBackendClient":
        token = os.environ.get("AGENT_INTERNAL_TOKEN")
        if not token:
            raise RuntimeError("AGENT_INTERNAL_TOKEN is required for the Fetch agent.")
        host = os.environ.get("AGENT_BACKEND_HOST", "127.0.0.1")
        port = os.environ.get("AGENT_BACKEND_PORT", "4001")
        return cls(base_url=f"http://{host}:{port}", token=token)

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await asyncio.to_thread(self._post_sync, path, payload)

    def _post_sync(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        request = Request(
            f"{self.base_url}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=20) as response:
                data = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            try:
                data = json.loads(error.read().decode("utf-8"))
            except json.JSONDecodeError:
                raise RuntimeError("The internal backend returned an invalid error response.") from error
            code = data.get("error", {}).get("code", "BACKEND_REQUEST_FAILED")
            raise BackendDomainError(str(code)) from error
        except (URLError, OSError) as error:
            raise BackendDomainError("BACKEND_UNAVAILABLE") from error
        if "error" in data:
            raise BackendDomainError(str(data["error"].get("code", "BACKEND_REQUEST_FAILED")))
        return data

    async def create_session(
        self, external_conversation_id: str, customer_id: str
    ) -> dict[str, Any]:
        return (await self._post(
            "/v1/agent/session",
            {
                "externalConversationId": external_conversation_id,
                "customerId": customer_id,
            },
        ))["state"]

    async def update_state(
        self, conversation_id: str, customer_id: str, patch: dict[str, Any]
    ) -> dict[str, Any]:
        return (await self._post(
            "/v1/agent/request-state/update",
            {"conversationId": conversation_id, "customerId": customer_id, "patch": patch},
        ))["state"]

    async def append_message(
        self,
        conversation_id: str,
        sender: str,
        content: str,
        external_message_id: str,
    ) -> None:
        await self._post(
            "/v1/agent/messages",
            {
                "conversationId": conversation_id,
                "sender": sender,
                "content": content,
                "externalMessageId": external_message_id,
            },
        )

    async def tool(self, name: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._post(f"/v1/agent/tools/{name}", payload)
