from __future__ import annotations

import unittest
from copy import deepcopy
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fetch_agent.backend import BackendDomainError
from fetch_agent.conversation import (
    AsiOneExtractor,
    CateringConversationEngine,
    Intent,
    RuleBasedExtractor,
    ConversationContext,
    Extraction,
    RequestUpdate,
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
        self.initial_state = deepcopy(self.state)
        self.states = {CONVERSATION_ID: self.state}
        self.active_id = CONVERSATION_ID
        self.saved_orders: list[dict[str, Any]] = []
        self.matches = matches if matches is not None else [self._match()]
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.messages: list[tuple[str, str]] = []
        self.fail_tool: str | None = None
        self.menu_items = [{"id": MENU_ITEM_ID, "name": "Vegetable Dumplings", "price": "11.50",
                            "dietaryTags": ["VEGETARIAN", "VEGAN"]}]

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
        current = self.states[conversation_id]
        if patch.get("reset"):
            current.update(
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
                current[key] = list(value)
            else:
                current[key] = value
        return deepcopy(current)

    async def get_context(self, conversation_id: str, customer_id: str) -> dict[str, Any]:
        self.assert_customer(customer_id)
        return {"requests": deepcopy(list(self.states.values())),
                "activeConversationId": self.active_id,
                "history": [{"sender": sender, "content": content} for sender, content in self.messages[-24:]]}

    async def create_request(self, conversation_id: str, customer_id: str) -> dict[str, Any]:
        self.assert_customer(customer_id)
        state = deepcopy(self.initial_state)
        state["conversationId"] = str(uuid4())
        self.states[state["conversationId"]] = state
        self.active_id = state["conversationId"]
        return deepcopy(state)

    async def activate_request(self, conversation_id: str, customer_id: str,
                               request_conversation_id: str) -> dict[str, Any]:
        self.assert_customer(customer_id)
        self.active_id = request_conversation_id
        return deepcopy(self.states[request_conversation_id])

    async def tool(self, name: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((name, deepcopy(payload)))
        if self.fail_tool == name:
            raise BackendDomainError("CATERER_NOT_FOUND")
        if name == "search_caterers":
            return {"matches": self.matches}
        if name == "get_caterer":
            return {"caterer": {"id": CATERER_ID, "businessName": "Jade Juniper Kitchen"}}
        if name == "get_menu":
            return {"menuItems": deepcopy(self.menu_items)}
        if name == "create_order":
            order = {"id": ORDER_ID if not self.saved_orders else str(uuid4()),
                     "customerId": payload["customerId"], "status": "DRAFT", "estimatedTotal": "370.00",
                     "eventDate": payload["eventDate"], "eventLocation": payload["location"],
                     "guestCount": payload["headcount"], "fulfillmentMethod": payload["fulfillmentMethod"]}
            menu = {item["id"]: item for item in self.menu_items}
            items = [{"name": menu[item["menuItemId"]]["name"], "menuItemId": item["menuItemId"],
                      "quantity": item["quantity"], "unitPrice": menu[item["menuItemId"]]["price"]}
                     for item in payload["menuItems"]]
            self.saved_orders.append({"order": order, "items": items, "catererName": "Jade Juniper Kitchen"})
            return {"order": {"order": deepcopy(order), "items": deepcopy(items)}}
        if name == "request_order":
            self.assert_customer(payload["customerId"])
            entry = next(item for item in self.saved_orders if item["order"]["id"] == payload["orderId"])
            entry["order"]["status"] = "REQUESTED"
            return {"order": deepcopy(entry["order"])}
        if name == "get_order":
            self.assert_customer(payload["customerId"])
            entry = next((item for item in self.saved_orders if item["order"]["id"] == payload["orderId"]), None)
            return {"order": deepcopy(entry) if entry else {"order": {"id": ORDER_ID, "status": "DRAFT"}, "items": []}}
        if name == "get_orders":
            self.assert_customer(payload["customerId"])
            entries = [entry for entry in self.saved_orders
                       if (not payload.get("location") or entry["order"]["eventLocation"] == payload["location"])
                       and (not payload.get("status") or entry["order"]["status"] == payload["status"])
                       and (not payload.get("eventDate") or entry["order"]["eventDate"] == payload["eventDate"])]
            return {"orders": deepcopy(entries), "hasMore": False}
        raise AssertionError(f"Unexpected tool: {name}")

    @staticmethod
    def assert_customer(customer_id: str) -> None:
        if customer_id != CUSTOMER_ID:
            raise AssertionError("Unexpected customer ID")


class RuleBasedExtractionTests(unittest.IsolatedAsyncioTestCase):
    async def test_comma_formatted_budget_is_not_truncated(self) -> None:
        extraction = await RuleBasedExtractor().extract(
            "Our budget is $1,500.10", PartialCateringRequest(CONVERSATION_ID, CUSTOMER_ID)
        )
        self.assertEqual(extraction.patch["budget"], "1500.10")

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
    def test_order_history_intent_with_items_cannot_become_a_draft_creation(self) -> None:
        with self.assertRaises(ValueError):
            AsiOneExtractor._validated_extraction({
                "intent": "GET_ORDERS", "menu_items": [{"name": "Dumplings", "quantity": 20}],
            })

    async def test_model_item_selection_keeps_quantities_out_of_search_preferences(self) -> None:
        content = '{"intent":"UPDATE_REQUEST","patch":{"dishes":["dumplings"],"headcount":12},"menu_items":[{"name":"Vegetable Dumplings","quantity":12}]}'
        response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])
        create = AsyncMock(return_value=response)
        module = SimpleNamespace(AsyncOpenAI=lambda **kwargs: SimpleNamespace(chat=SimpleNamespace(
            completions=SimpleNamespace(create=create))))
        with patch.dict("sys.modules", {"openai": module}):
            extraction = await AsiOneExtractor("test-key").extract(
                "I'd like a dozen Vegetable Dumplings.",
                PartialCateringRequest(CONVERSATION_ID, CUSTOMER_ID, selected_caterer_id=CATERER_ID),
            )
        self.assertEqual(extraction.intent, Intent.SELECT_MENU_ITEMS)
        self.assertEqual(extraction.patch, {})
        self.assertEqual([(item.name, item.quantity) for item in extraction.menu_items], [("Vegetable Dumplings", 12)])

    def test_model_cannot_supply_menu_ids_prices_or_noninteger_quantities(self) -> None:
        for item in ({"name": "Dumplings", "quantity": True},
                     {"name": "Dumplings", "quantity": "12"},
                     {"name": "Dumplings", "quantity": 12, "menuItemId": MENU_ITEM_ID},
                     {"name": "Dumplings", "quantity": 12, "price": "0.01"}):
            with self.subTest(item=item), self.assertRaises(ValueError):
                AsiOneExtractor._validated_extraction({"intent": "SELECT_MENU_ITEMS", "menu_items": [item]})

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

    async def test_model_receives_all_events_and_recent_conversation(self) -> None:
        content = '{"intent":"UPDATE_REQUEST","request_index":1,"patch":{"budget":"700.10"}}'
        response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])
        create = AsyncMock(return_value=response)
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        module = SimpleNamespace(AsyncOpenAI=lambda **kwargs: client)
        first = PartialCateringRequest(CONVERSATION_ID, CUSTOMER_ID, location="Ann Arbor, MI")
        second = PartialCateringRequest("second-event", CUSTOMER_ID, location="Detroit, MI")
        context = ConversationContext([first, second], [{"sender": "CUSTOMER", "content": "Two separate parties."}])
        with patch.dict("sys.modules", {"openai": module}):
            result = await AsiOneExtractor("test-key").extract("Make the Detroit one seven hundred and ten cents.", second, context)
        self.assertEqual(result.request_index, 1)
        self.assertEqual(result.patch["budget"], "700.10")
        payload = create.call_args.kwargs["messages"][1]["content"]
        self.assertIn("Ann Arbor, MI", payload)
        self.assertIn("Detroit, MI", payload)
        self.assertIn("Two separate parties", payload)

    def test_rejects_identity_and_database_fields_from_the_model(self) -> None:
        for value in (
            {"patch": {"customerId": "another-customer"}},
            {"patch": {"pendingOrderId": ORDER_ID}},
            {"order_filters": {"customerId": "another-customer"}},
            {"request_index": True},
            {"request_updates": [{"new_request": "true"}]},
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                AsiOneExtractor._validated_extraction(value)

    async def test_missing_model_dependency_uses_the_offline_fallback(self) -> None:
        with patch.dict("sys.modules", {"openai": None}):
            result = await AsiOneExtractor("test-key").extract("What did I order?", PartialCateringRequest(CONVERSATION_ID, CUSTOMER_ID))
        self.assertEqual(result.intent, Intent.GET_ORDERS)


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
        draft = await self.engine.handle_message("conversation-b", CUSTOMER_ID, "20 Vegetable Dumplings")
        self.assertIn("20 × Vegetable Dumplings", draft.text)
        self.assertEqual(self.backend.saved_orders[0]["order"]["status"], "DRAFT")
        booking = await self.engine.handle_message("conversation-b", CUSTOMER_ID, "Book it.")
        self.assertIn("REQUESTED", booking.text)
        self.assertEqual(booking.state.pending_order_id, ORDER_ID)
        self.assertEqual([name for name, _ in self.backend.calls][-2:], ["get_order", "request_order"])
        create_call = next(payload for name, payload in self.backend.calls if name == "create_order")
        self.assertEqual(create_call["budget"], "500.10")
        self.assertEqual(create_call["headcount"], 30)
        self.assertEqual(create_call["menuItems"], [{"menuItemId": MENU_ITEM_ID, "quantity": 20}])

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

    async def test_two_events_in_one_message_remain_independent_after_restart(self) -> None:
        reply = await self.engine.handle_message("multi", CUSTOMER_ID,
            "Chinese dumplings for 30 people in Ann Arbor on 2030-06-15; Mexican tacos for 20 people in Detroit on 2030-06-16")
        self.assertEqual(len(self.backend.states), 2)
        requests = list(self.backend.states.values())
        self.assertEqual(requests[0]["location"], "Ann Arbor, MI")
        self.assertEqual(requests[0]["headcount"], 30)
        self.assertEqual(requests[0]["cuisines"], ["Chinese"])
        self.assertEqual(requests[1]["location"], "Detroit, MI")
        self.assertEqual(requests[1]["eventDate"], "2030-06-16")
        self.assertEqual(requests[1]["cuisines"], ["Mexican"])
        self.assertIn("Request 1", reply.text)
        self.assertIn("Request 2", reply.text)
        restarted = CateringConversationEngine(self.backend, RuleBasedExtractor())
        await restarted.handle_message("multi", CUSTOMER_ID, "$400 for the first request")
        self.assertEqual(requests[0]["budget"], "400.00")
        self.assertIsNone(requests[1]["budget"])
        await restarted.handle_message("multi", CUSTOMER_ID, "The Detroit one has a budget of $250")
        self.assertEqual(requests[1]["budget"], "250.00")
        self.assertEqual(requests[0]["budget"], "400.00")

    async def test_another_event_does_not_inherit_the_first_events_preferences(self) -> None:
        await self.engine.handle_message("multi", CUSTOMER_ID,
            "Chinese dumplings for 30 people in Ann Arbor on 2030-06-15, $500 buffet delivery vegetarian")
        reply = await self.engine.handle_message("multi", CUSTOMER_ID, "Another catering in Detroit")
        self.assertEqual(len(self.backend.states), 2)
        self.assertEqual(reply.state.location, "Detroit, MI")
        self.assertIsNone(reply.state.budget)
        self.assertIsNone(reply.state.headcount)
        self.assertEqual(reply.state.cuisines, [])
        self.assertEqual(reply.state.dietary_restrictions, [])

    async def test_shared_preferences_apply_only_when_explicit_and_arrays_can_be_cleared(self) -> None:
        await self.engine.handle_message("multi", CUSTOMER_ID,
            "Chinese for 30 people in Ann Arbor on 2030-06-15; Korean for 20 people in Detroit on 2030-06-16")
        await self.engine.handle_message("multi", CUSTOMER_ID, "Both have a budget of $500 and no dietary restrictions")
        for request in self.backend.states.values():
            self.assertEqual(request["budget"], "500.00")
            self.assertTrue(request["dietaryRestrictionsConfirmed"])
        await self.engine.handle_message("multi", CUSTOMER_ID, "First request needs vegetarian food")
        await self.engine.handle_message("multi", CUSTOMER_ID, "First request has no restrictions")
        self.assertEqual(self.backend.state["dietaryRestrictions"], [])

    async def test_book_both_submits_separate_orders_and_history_survives_a_new_engine(self) -> None:
        await self.engine.handle_message("multi", CUSTOMER_ID,
            "Chinese dumplings for 30 people in Ann Arbor on 2030-06-15, $500 buffet delivery vegetarian; Chinese dumplings for 20 people in Detroit on 2030-06-16, $400 buffet delivery vegetarian")
        await self.engine.handle_message("multi", CUSTOMER_ID, "Show the first request's first menu")
        await self.engine.handle_message("multi", CUSTOMER_ID, "30 Vegetable Dumplings for the first request")
        await self.engine.handle_message("multi", CUSTOMER_ID, "Show the second request's first menu")
        await self.engine.handle_message("multi", CUSTOMER_ID, "20 Vegetable Dumplings for the second request")
        booking = await self.engine.handle_message("multi", CUSTOMER_ID, "Book both")
        self.assertEqual(len(self.backend.saved_orders), 2)
        self.assertTrue(all(entry["order"]["status"] == "REQUESTED" for entry in self.backend.saved_orders))
        self.assertIn("REQUESTED", booking.text)
        restarted = CateringConversationEngine(self.backend, RuleBasedExtractor())
        reply = await restarted.handle_message("multi", CUSTOMER_ID, "Remind me what I ordered")
        self.assertIn("30 × Vegetable Dumplings", reply.text)
        self.assertIn("20 × Vegetable Dumplings", reply.text)
        self.assertIn("Ann Arbor, MI", reply.text)
        self.assertIn("Detroit, MI", reply.text)
        self.assertIn("awaiting caterer acceptance", reply.text)
        self.assertEqual(self.backend.calls[-1], ("get_orders", {"customerId": CUSTOMER_ID}))
        await restarted.handle_message("multi", CUSTOMER_ID, "Book both")
        self.assertEqual(len(self.backend.saved_orders), 2)

    async def test_order_questions_fetch_database_results_without_changing_planning_state(self) -> None:
        self.backend.saved_orders = [{"catererName": "Fictional Kitchen", "order": {
            "id": ORDER_ID, "eventDate": "2030-06-15", "eventLocation": "Detroit, MI",
            "guestCount": 10, "fulfillmentMethod": "PICKUP", "estimatedTotal": "125.00", "status": "ACCEPTED",
        }, "items": [{"name": "Tacos", "quantity": 10, "unitPrice": "12.50"}]}]
        before = deepcopy(self.backend.state)
        reply = await self.engine.handle_message("new-chat", CUSTOMER_ID, "What did I order in Detroit?")
        self.assertIn("10 × Tacos", reply.text)
        self.assertIn("$125.00", reply.text)
        self.assertIn("accepted", reply.text)
        self.assertEqual(self.backend.state, before)
        self.assertEqual(self.backend.calls[-1][1], {"customerId": CUSTOMER_ID, "location": "Detroit, MI"})

    async def test_bad_request_references_cannot_modify_or_book_any_event(self) -> None:
        before = deepcopy(self.backend.state)
        reply = await self.engine.handle_message("multi", CUSTOMER_ID, "Book request 9")
        self.assertIn("couldn't resolve", reply.text)
        self.assertEqual(self.backend.state, before)
        self.assertEqual(self.backend.calls, [])

    async def test_questions_about_booking_do_not_submit_orders(self) -> None:
        reply = await self.engine.handle_message("multi", CUSTOMER_ID, "How do I book it?")
        self.assertIn("submit your chosen orders", reply.text)
        self.assertFalse(any(tool == "request_order" for tool, _ in self.backend.calls))

    async def test_unknown_messages_ask_for_clarification_and_do_not_repeat_a_search(self) -> None:
        await self.engine.handle_message("multi", CUSTOMER_ID, "Chinese for 20 people in Detroit on 2030-06-15")
        before = len(self.backend.calls)
        reply = await self.engine.handle_message("multi", CUSTOMER_ID, "That sounds complicated")
        self.assertIn("I can find caterers", reply.text)
        self.assertEqual(len(self.backend.calls), before)

    async def test_empty_history_does_not_invent_orders(self) -> None:
        reply = await self.engine.handle_message("multi", CUSTOMER_ID, "What have I booked?")
        self.assertIn("no saved orders", reply.text)
        self.assertEqual(reply.tools, ["get_orders"])

    async def test_two_unspecified_events_still_create_independent_saved_requests(self) -> None:
        extractor = SimpleNamespace(extract=AsyncMock(return_value=Extraction(
            intent=Intent.FIND_CATERING,
            request_updates=[RequestUpdate(new_request=True), RequestUpdate(new_request=True)],
        )))
        engine = CateringConversationEngine(self.backend, extractor)
        reply = await engine.handle_message("multi", CUSTOMER_ID, "I need two separate caterings")
        self.assertEqual(len(self.backend.states), 2)
        self.assertIn("Request 1", reply.text)
        self.assertIn("Request 2", reply.text)

    async def test_model_order_question_cannot_mutate_request_fields(self) -> None:
        before = deepcopy(self.backend.state)
        extractor = SimpleNamespace(extract=AsyncMock(return_value=Extraction(
            intent=Intent.GET_ORDERS, patch={"budget": "500.00"}, new_request=True,
        )))
        engine = CateringConversationEngine(self.backend, extractor)
        await engine.handle_message("multi", CUSTOMER_ID, "What did I order?")
        self.assertEqual(self.backend.state, before)
        self.assertEqual(len(self.backend.states), 1)

    async def test_model_start_over_resets_only_the_referenced_event(self) -> None:
        await self.engine.handle_message("multi", CUSTOMER_ID,
            "Chinese for 30 people in Ann Arbor on 2030-06-15; Korean for 20 people in Detroit on 2030-06-16")
        extractor = SimpleNamespace(extract=AsyncMock(return_value=Extraction(intent=Intent.START_OVER, request_index=0)))
        engine = CateringConversationEngine(self.backend, extractor)
        await engine.handle_message("multi", CUSTOMER_ID, "Start over with the first event")
        self.assertIsNone(self.backend.state["location"])
        self.assertEqual(list(self.backend.states.values())[1]["location"], "Detroit, MI")


class MenuSelectionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.backend = FakeBackend()
        self.engine = CateringConversationEngine(self.backend, RuleBasedExtractor())
        await self.engine.handle_message("menu-test", CUSTOMER_ID,
            "Chinese dumplings for 30 people in Ann Arbor on 2030-06-15, $500 buffet delivery vegetarian")
        await self.engine.handle_message("menu-test", CUSTOMER_ID, "First one")
        self.before = deepcopy(self.backend.state)
        self.backend.calls.clear()

    async def test_common_quantity_formats_save_a_draft_without_search_or_submission(self) -> None:
        for message in ("20 Vegetable Dumplings", "I'd like 20 Vegetable Dumplings, please.",
                        "Vegetable Dumplings x 20", "Vegetable Dumplings: 20",
                        "Vegetable Dumplings 20", "Vegetable Dumplings, quantity 20",
                        "vegetable dumpling, 20",
                        "Can I have 20 servings of Vegetable Dumplings?", "20 of Vegetable Dumplings"):
            with self.subTest(message=message):
                await self.asyncSetUp()
                reply = await self.engine.handle_message("menu-test", CUSTOMER_ID, message)
                self.assertIn("20 × Vegetable Dumplings", reply.text)
                self.assertEqual(reply.state.selected_caterer_id, CATERER_ID)
                self.assertEqual(reply.state.headcount, 30)
                self.assertEqual(reply.state.dishes, self.before["dishes"])
                self.assertEqual(reply.state.dietary_restrictions, self.before["dietaryRestrictions"])
                self.assertEqual(reply.tools, ["get_menu", "create_order"])
                self.assertEqual(self.backend.saved_orders[0]["order"]["status"], "DRAFT")
                self.assertEqual(self.backend.calls[-1][1]["menuItems"], [{"menuItemId": MENU_ITEM_ID, "quantity": 20}])

    async def test_multiple_items_keep_independent_quantities(self) -> None:
        second_id = "33000000-0000-4000-8000-000000000002"
        self.backend.menu_items.append({"id": second_id, "name": "Mac and Cheese", "price": "9.00", "dietaryTags": ["VEGETARIAN"]})
        reply = await self.engine.handle_message("menu-test", CUSTOMER_ID,
                                                "20 Vegetable Dumplings and 10 Mac and Cheese")
        self.assertIn("20 × Vegetable Dumplings, 10 × Mac and Cheese", reply.text)
        self.assertEqual(self.backend.calls[-1][1]["menuItems"], [
            {"menuItemId": MENU_ITEM_ID, "quantity": 20}, {"menuItemId": second_id, "quantity": 10},
        ])

    async def test_draft_quantities_survive_restart_and_book_it_submits_only_once(self) -> None:
        draft = await self.engine.handle_message("menu-test", CUSTOMER_ID, "12 Vegetable Dumplings")
        self.assertIsNotNone(draft.state.pending_order_id)
        restarted = CateringConversationEngine(self.backend, RuleBasedExtractor())
        reply = await restarted.handle_message("menu-test", CUSTOMER_ID, "Book it")
        self.assertIn("REQUESTED", reply.text)
        self.assertEqual(self.backend.saved_orders[0]["items"][0]["quantity"], 12)
        await restarted.handle_message("menu-test", CUSTOMER_ID, "Book it")
        self.assertEqual(len(self.backend.saved_orders), 1)
        self.assertEqual(sum(name == "request_order" for name, _ in self.backend.calls), 1)

    async def test_booking_without_quantities_does_not_use_guest_count(self) -> None:
        reply = await self.engine.handle_message("menu-test", CUSTOMER_ID, "Book it")
        self.assertIn("quantities", reply.text)
        self.assertEqual(self.backend.saved_orders, [])
        self.assertEqual(self.backend.calls, [])

    async def test_unknown_or_ambiguous_item_rejects_the_whole_selection(self) -> None:
        self.backend.menu_items.append({"id": "33000000-0000-4000-8000-000000000002",
            "name": "Pork Dumplings", "price": "12.00", "dietaryTags": []})
        for message in ("20 Vegetable Dumplings and 5 Sushi", "20 Dumplings"):
            with self.subTest(message=message):
                reply = await self.engine.handle_message("menu-test", CUSTOMER_ID, message)
                self.assertIn("exact menu item name", reply.text)
                self.assertEqual(reply.state.selected_caterer_id, CATERER_ID)
                self.assertEqual(self.backend.saved_orders, [])
                self.assertFalse(any(name == "search_caterers" for name, _ in self.backend.calls))

    async def test_invalid_quantities_do_not_search_or_create_orders(self) -> None:
        for quantity in ("0", "-3", "1.5", "2147483648"):
            with self.subTest(quantity=quantity):
                reply = await self.engine.handle_message("menu-test", CUSTOMER_ID, f"{quantity} Vegetable Dumplings")
                self.assertIn("positive whole-number", reply.text)
                self.assertEqual(reply.state.selected_caterer_id, CATERER_ID)
                self.assertEqual(self.backend.calls, [])

    async def test_missing_event_details_keep_the_caterer_and_do_not_guess(self) -> None:
        self.backend.state["eventStyle"] = None
        reply = await self.engine.handle_message("menu-test", CUSTOMER_ID, "20 Vegetable Dumplings")
        self.assertIn("event style", reply.text)
        self.assertIn("send the item names and quantities again", reply.text)
        self.assertEqual(reply.state.selected_caterer_id, CATERER_ID)
        self.assertEqual(self.backend.saved_orders, [])

    async def test_backend_rejection_does_not_clear_selection_or_submit(self) -> None:
        real_tool = self.backend.tool
        async def rejected(name, payload):
            if name == "create_order":
                raise BackendDomainError("BUDGET_EXCEEDED")
            return await real_tool(name, payload)
        with patch.object(self.backend, "tool", side_effect=rejected):
            reply = await self.engine.handle_message("menu-test", CUSTOMER_ID, "20 Vegetable Dumplings")
        self.assertIn("exceeds the stated budget", reply.text)
        self.assertEqual(reply.state.selected_caterer_id, CATERER_ID)
        self.assertIsNone(reply.state.pending_order_id)
        self.assertEqual(self.backend.saved_orders, [])


if __name__ == "__main__":
    unittest.main()
