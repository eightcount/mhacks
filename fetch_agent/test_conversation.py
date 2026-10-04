from __future__ import annotations

import unittest
from copy import deepcopy
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

from fetch_agent.backend import BackendDomainError
from fetch_agent.conversation import (
    AsiOneExtractor,
    CateringConversationEngine,
    Intent,
    RuleBasedExtractor,
)
from fetch_agent.models import PartialCateringRequest


CUSTOMER_ID = "11000000-0000-4000-8000-000000000006"
CONVERSATION_ID = "66000000-0000-4000-8000-000000000010"
CATERER_ID = "22000000-0000-4000-8000-000000000001"
MENU_ITEM_ID = "33000000-0000-4000-8000-000000000001"
ORDER_ID = "44000000-0000-4000-8000-000000000010"


class FakeBackend:
    """A deterministic substitute for the internal TypeScript API."""

    def __init__(self, matches: list[dict[str, Any]] | None = None):
        self.state: dict[str, Any] = {
            "conversationId": CONVERSATION_ID,
            "customerId": CUSTOMER_ID,
            "eventDate": None,
            "budget": None,
            "dishes": [],
            "cuisines": [],
            "headcount": None,
            "eventStyle": None,
            "dietaryRestrictions": [],
            "location": None,
            "fulfillmentMethod": None,
            "recentSearchResultIds": [],
            "selectedCatererId": None,
            "pendingOrderId": None,
        }
        self.matches = matches if matches is not None else [self._match()]
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.messages: list[tuple[str, str]] = []
        self.fail_tool: str | None = None

    @staticmethod
    def _match() -> dict[str, Any]:
        return {
            "caterer": {
                "id": CATERER_ID,
                "businessName": "Jade Juniper Kitchen",
                "cuisineTypes": ["CHINESE"],
                "fulfillmentMethod": "DELIVERY",
            },
            "match": {"available": True},
        }

    async def create_session(self, external_conversation_id: str, customer_id: str) -> dict[str, Any]:
        self.assert_customer(customer_id)
        return deepcopy(self.state)

    async def append_message(
        self, conversation_id: str, sender: str, content: str, external_message_id: str
    ) -> None:
        self.messages.append((sender, content))

    async def update_state(
        self, conversation_id: str, customer_id: str, patch: dict[str, Any]
    ) -> dict[str, Any]:
        self.assert_customer(customer_id)
        if patch.get("reset"):
            self.state.update(
                {
                    "eventDate": None,
                    "budget": None,
                    "dishes": [],
                    "cuisines": [],
                    "headcount": None,
                    "eventStyle": None,
                    "dietaryRestrictions": [],
                    "location": None,
                    "fulfillmentMethod": None,
                    "recentSearchResultIds": [],
                    "selectedCatererId": None,
                    "pendingOrderId": None,
                }
            )
        for key, value in patch.items():
            if key == "reset":
                continue
            if key in {"dishes", "cuisines", "dietaryRestrictions"}:
                self.state[key] = list(dict.fromkeys([*self.state[key], *value]))
            else:
                self.state[key] = value
        return deepcopy(self.state)

    async def tool(self, name: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((name, deepcopy(payload)))
        if self.fail_tool == name:
            raise BackendDomainError("CATERER_NOT_FOUND")
        if name == "search_caterers":
            return {"matches": self.matches}
        if name == "get_caterer":
            return {"caterer": {"id": CATERER_ID, "businessName": "Jade Juniper Kitchen"}}
        if name == "get_menu":
            return {
                "menuItems": [
                    {
                        "id": MENU_ITEM_ID,
                        "name": "Vegetable Dumplings",
                        "price": "11.50",
                        "dietaryTags": ["VEGETARIAN", "VEGAN"],
                    }
                ]
            }
        if name == "create_order":
            return {
                "order": {
                    "order": {"id": ORDER_ID, "status": "DRAFT", "estimatedTotal": "370.00"},
                    "items": [],
                }
            }
        if name == "request_order":
            return {"order": {"id": ORDER_ID, "status": "REQUESTED", "estimatedTotal": "370.00"}}
        if name == "get_order":
            return {"order": {"order": {"id": ORDER_ID, "status": "DRAFT"}, "items": []}}
        raise AssertionError(f"Unexpected tool: {name}")

    @staticmethod
    def assert_customer(customer_id: str) -> None:
        if customer_id != CUSTOMER_ID:
            raise AssertionError("Unexpected customer ID")


class RuleBasedExtractionTests(unittest.IsolatedAsyncioTestCase):
    async def test_preserves_exact_decimal_budgets(self) -> None:
        state = PartialCateringRequest(CONVERSATION_ID, CUSTOMER_ID)
        for amount, expected in [("0.29", "0.29"), ("500.1", "500.10"), ("500", "500.00")]:
            with self.subTest(amount=amount):
                extraction = await RuleBasedExtractor().extract(f"Budget is ${amount}.", state)
                self.assertEqual(extraction.patch["budget"], expected)

    async def test_does_not_truncate_overprecise_budgets(self) -> None:
        extraction = await RuleBasedExtractor().extract(
            "Budget is $0.291.", PartialCateringRequest(CONVERSATION_ID, CUSTOMER_ID)
        )
        self.assertNotIn("budget", extraction.patch)

    async def test_extracts_only_explicit_partial_request_fields(self) -> None:
        state = PartialCateringRequest(CONVERSATION_ID, CUSTOMER_ID)
        extraction = await RuleBasedExtractor().extract(
            "I need Chinese dumplings for 30 people next Saturday.", state
        )

        self.assertEqual(extraction.intent, Intent.FIND_CATERING)
        self.assertEqual(extraction.patch["cuisines"], ["Chinese"])
        self.assertEqual(extraction.patch["dishes"], ["dumplings"])
        self.assertEqual(extraction.patch["headcount"], 30)
        self.assertIn("eventDate", extraction.patch)
        self.assertNotIn("budget", extraction.patch)
        self.assertNotIn("fulfillmentMethod", extraction.patch)


class BudgetRepresentationTests(unittest.TestCase):
    def test_preserves_database_budget_in_search_and_order_payloads(self) -> None:
        for amount in ("0.29", "500.10", "9999999999.99"):
            with self.subTest(amount=amount):
                state = PartialCateringRequest.from_api({
                    "conversationId": CONVERSATION_ID,
                    "customerId": CUSTOMER_ID,
                    "eventDate": "2030-06-15",
                    "budget": amount,
                    "cuisines": ["Chinese"],
                    "headcount": 30,
                    "eventStyle": "BUFFET",
                    "dietaryRestrictionsConfirmed": True,
                    "location": "Ann Arbor, MI",
                    "fulfillmentMethod": "DELIVERY",
                })
                self.assertEqual(state.budget, amount)
                self.assertEqual(state.search_input()["budget"], amount)
                self.assertEqual(state.order_input()["budget"], amount)

    def test_rejects_inexact_or_invalid_database_budgets(self) -> None:
        for amount in (0.29, "0.291", "-0.01", "10000000000.00", True):
            with self.subTest(amount=amount), self.assertRaises(ValueError):
                PartialCateringRequest.from_api({
                    "conversationId": CONVERSATION_ID,
                    "customerId": CUSTOMER_ID,
                    "budget": amount,
                })


class AsiOneExtractionTests(unittest.IsolatedAsyncioTestCase):
    async def test_preserves_numeric_model_budget_without_float_conversion(self) -> None:
        content = '{"intent":"UPDATE_REQUEST","patch":{"budget":9999999999.99}}'
        response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])
        create = AsyncMock(return_value=response)
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        module = SimpleNamespace(AsyncOpenAI=lambda **kwargs: client)
        with patch.dict("sys.modules", {"openai": module}):
            extraction = await AsiOneExtractor("test-key").extract(
                "Budget is $9999999999.99.", PartialCateringRequest(CONVERSATION_ID, CUSTOMER_ID)
            )
        self.assertEqual(extraction.patch["budget"], "9999999999.99")


class ConversationEngineTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.backend = FakeBackend()
        self.engine = CateringConversationEngine(self.backend, RuleBasedExtractor())

    async def test_merges_request_fields_and_preserves_previous_values_for_search(self) -> None:
        first = await self.engine.handle_message(
            "conversation-a", CUSTOMER_ID, "I need Chinese dumplings for 30 people next Saturday."
        )
        self.assertIn("event location", first.text)
        self.assertEqual(first.state.cuisines, ["Chinese"])
        self.assertEqual(first.state.dishes, ["dumplings"])
        self.assertEqual(first.state.headcount, 30)

        second = await self.engine.handle_message(
            "conversation-a", CUSTOMER_ID, "$500, Ann Arbor, delivery."
        )
        self.assertEqual(second.state.cuisines, ["Chinese"])
        self.assertEqual(second.state.dishes, ["dumplings"])
        self.assertEqual(second.state.budget, "500.00")
        self.assertEqual(second.state.location, "Ann Arbor, MI")
        self.assertEqual(second.state.fulfillment_method, "DELIVERY")
        self.assertIn("event style", second.text)

        third = await self.engine.handle_message(
            "conversation-a", CUSTOMER_ID, "Buffet style with vegetarian options."
        )
        self.assertIn("Jade Juniper Kitchen", third.text)
        search_call = [call for call in self.backend.calls if call[0] == "search_caterers"][-1]
        self.assertEqual(search_call[1]["cuisines"], ["Chinese"])
        self.assertEqual(search_call[1]["dishes"], ["dumplings"])
        self.assertEqual(search_call[1]["dietaryRestrictions"], ["VEGETARIAN"])
        self.assertEqual(search_call[1]["budget"], "500.00")

    async def test_first_result_resolves_to_its_menu_and_book_it_requests_not_accepts(self) -> None:
        await self.engine.handle_message(
            "conversation-b", CUSTOMER_ID, "Chinese dumplings for 30 people next Saturday."
        )
        await self.engine.handle_message("conversation-b", CUSTOMER_ID, "$500.10 in Ann Arbor, delivery.")
        await self.engine.handle_message("conversation-b", CUSTOMER_ID, "Buffet and vegetarian.")

        menu_reply = await self.engine.handle_message(
            "conversation-b", CUSTOMER_ID, "Show me the first one's menu."
        )
        self.assertIn("Vegetable Dumplings", menu_reply.text)
        menu_call = [call for call in self.backend.calls if call[0] == "get_menu"][-1]
        self.assertEqual(menu_call[1]["catererId"], CATERER_ID)

        await self.engine.handle_message("conversation-b", CUSTOMER_ID, "Let's use that caterer.")
        booking = await self.engine.handle_message("conversation-b", CUSTOMER_ID, "Book it.")
        self.assertIn("REQUESTED", booking.text)
        self.assertEqual(booking.state.pending_order_id, ORDER_ID)
        self.assertEqual([name for name, _ in self.backend.calls][-3:], ["get_menu", "create_order", "request_order"])
        create_call = next(payload for name, payload in self.backend.calls if name == "create_order")
        self.assertEqual(create_call["budget"], "500.10")

    async def test_bare_first_one_uses_persisted_search_results(self) -> None:
        await self.engine.handle_message(
            "conversation-reference", CUSTOMER_ID, "Chinese dumplings for 30 people next Saturday."
        )
        await self.engine.handle_message(
            "conversation-reference", CUSTOMER_ID, "$500 in Ann Arbor, delivery."
        )
        await self.engine.handle_message("conversation-reference", CUSTOMER_ID, "Buffet and vegetarian.")

        reply = await self.engine.handle_message("conversation-reference", CUSTOMER_ID, "First one.")
        self.assertIn("Vegetable Dumplings", reply.text)
        self.assertEqual(self.backend.calls[-1][0], "get_menu")

    async def test_no_match_and_domain_errors_return_safe_customer_text(self) -> None:
        no_match_engine = CateringConversationEngine(FakeBackend(matches=[]), RuleBasedExtractor())
        await no_match_engine.handle_message(
            "conversation-c", CUSTOMER_ID, "Chinese dumplings for 30 people next Saturday."
        )
        await no_match_engine.handle_message("conversation-c", CUSTOMER_ID, "$500 in Ann Arbor, delivery.")
        reply = await no_match_engine.handle_message("conversation-c", CUSTOMER_ID, "Buffet and vegetarian.")
        self.assertIn("couldn't find a caterer", reply.text)

        self.backend.state["selectedCatererId"] = CATERER_ID
        self.backend.fail_tool = "get_menu"
        error_reply = await self.engine.handle_message(
            "conversation-d", CUSTOMER_ID, "Show me their menu."
        )
        self.assertEqual(error_reply.text, "I couldn't find that caterer.")


if __name__ == "__main__":
    unittest.main()
