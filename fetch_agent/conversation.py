from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from enum import Enum
from typing import Any, Protocol
from uuid import uuid4

from .backend import AgentBackendClient, BackendDomainError
from .models import PartialCateringRequest, normalize_budget

LOGGER = logging.getLogger(__name__)


class Intent(str, Enum):
    FIND_CATERING = "FIND_CATERING"
    GET_MENU = "GET_MENU"
    SELECT_CATERER = "SELECT_CATERER"
    CREATE_ORDER = "CREATE_ORDER"
    REQUEST_ORDER = "REQUEST_ORDER"
    GET_ORDER_STATUS = "GET_ORDER_STATUS"
    UPDATE_REQUEST = "UPDATE_REQUEST"
    START_OVER = "START_OVER"


@dataclass
class Extraction:
    intent: Intent = Intent.UPDATE_REQUEST
    patch: dict[str, Any] = field(default_factory=dict)
    reference_index: int | None = None


class RequestExtractor(Protocol):
    async def extract(self, message: str, state: PartialCateringRequest) -> Extraction: ...


class RuleBasedExtractor:
    """Small credential-free fallback for local development and deterministic tests."""

    cuisines = {
        "chinese": "Chinese",
        "mexican": "Mexican",
        "vegan": "Vegan",
        "mediterranean": "Mediterranean",
        "korean": "Korean",
    }
    dishes = ("dumplings", "fried rice", "tacos", "shawarma", "bibimbap", "noodles")

    async def extract(self, message: str, state: PartialCateringRequest) -> Extraction:
        text = message.strip()
        lower = text.lower()
        extraction = Extraction(intent=self._intent(lower))

        if "first" in lower:
            extraction.reference_index = 0
        elif "second" in lower:
            extraction.reference_index = 1
        if extraction.reference_index is not None and extraction.intent == Intent.UPDATE_REQUEST:
            extraction.intent = Intent.GET_MENU

        patch: dict[str, Any] = {}
        parsed_date = self._parse_date(lower)
        if parsed_date:
            patch["eventDate"] = parsed_date
        budget = re.search(r"\$\s*(\d+(?:\.\d{1,2})?)(?!\d|\.\d)", lower)
        if budget:
            patch["budget"] = normalize_budget(budget.group(1))
        headcount = re.search(r"\b(\d+)\s*(?:people|guests|attendees|persons)\b", lower)
        if headcount:
            patch["headcount"] = int(headcount.group(1))

        matched_cuisines = [value for key, value in self.cuisines.items() if key in lower]
        if matched_cuisines:
            patch["cuisines"] = matched_cuisines
        matched_dishes = [dish for dish in self.dishes if dish in lower]
        if matched_dishes:
            patch["dishes"] = matched_dishes

        styles = {
            "family style": "FAMILY_STYLE",
            "individual meals": "INDIVIDUAL_MEALS",
            "drop off": "DROP_OFF",
            "buffet": "BUFFET",
            "formal": "FORMAL",
            "casual": "CASUAL",
        }
        for phrase, value in styles.items():
            if phrase in lower:
                patch["eventStyle"] = value
                break

        dietary = {
            "gluten free": "GLUTEN_FREE",
            "vegetarian": "VEGETARIAN",
            "vegan": "VEGAN",
            "halal": "HALAL",
        }
        matched_dietary = [value for phrase, value in dietary.items() if phrase in lower]
        if matched_dietary:
            patch["dietaryRestrictions"] = matched_dietary
            patch["dietaryRestrictionsConfirmed"] = True
        elif any(
            phrase in lower
            for phrase in ("no dietary restrictions", "no dietary restriction", "no restrictions")
        ):
            patch["dietaryRestrictions"] = []
            patch["dietaryRestrictionsConfirmed"] = True
        if "delivery" in lower:
            patch["fulfillmentMethod"] = "DELIVERY"
        elif "pickup" in lower or "pick up" in lower:
            patch["fulfillmentMethod"] = "PICKUP"

        if "ann arbor" in lower or "umich" in lower or "u-m" in lower:
            patch["location"] = "Ann Arbor, MI"
        elif "ypsilanti" in lower:
            patch["location"] = "Ypsilanti, MI"
        elif "detroit" in lower:
            patch["location"] = "Detroit, MI"

        if extraction.intent == Intent.START_OVER:
            patch = {"reset": True}
        extraction.patch = patch
        return extraction

    @staticmethod
    def _intent(text: str) -> Intent:
        if any(phrase in text for phrase in ("start over", "start again", "reset")):
            return Intent.START_OVER
        if "menu" in text:
            return Intent.GET_MENU
        if any(phrase in text for phrase in ("create a draft", "create draft", "draft order")):
            return Intent.CREATE_ORDER
        if any(phrase in text for phrase in ("book it", "request order", "place the order")):
            return Intent.REQUEST_ORDER
        if any(phrase in text for phrase in ("order status", "where is my order", "status")):
            return Intent.GET_ORDER_STATUS
        if any(phrase in text for phrase in ("let's use", "lets use", "i want that", "select", "go with")):
            return Intent.SELECT_CATERER
        if any(phrase in text for phrase in ("need", "find", "catering", "caterer", "looking for")):
            return Intent.FIND_CATERING
        return Intent.UPDATE_REQUEST

    @staticmethod
    def _parse_date(text: str) -> str | None:
        iso = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", text)
        if iso:
            return iso.group(1)
        weekdays = {
            "monday": 0,
            "tuesday": 1,
            "wednesday": 2,
            "thursday": 3,
            "friday": 4,
            "saturday": 5,
            "sunday": 6,
        }
        for weekday, number in weekdays.items():
            if weekday in text:
                today = date.today()
                delta = (number - today.weekday()) % 7
                if "next" in text or delta == 0:
                    delta += 7
                return (today + timedelta(days=delta)).isoformat()
        return None


class AsiOneExtractor:
    """Optional ASI:One extraction adapter using its OpenAI-compatible API."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.fallback = RuleBasedExtractor()

    async def extract(self, message: str, state: PartialCateringRequest) -> Extraction:
        try:
            from openai import AsyncOpenAI
        except ImportError as error:
            raise RuntimeError("Install requirements.txt to use ASI:One extraction.") from error

        client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=os.environ.get("ASI1_BASE_URL") or "https://api.asi1.ai/v1",
        )
        system = (
            "Extract catering-request updates only. Return JSON with intent, patch, and "
            "reference_index. Allowed intents: FIND_CATERING, GET_MENU, SELECT_CATERER, "
            "CREATE_ORDER, REQUEST_ORDER, GET_ORDER_STATUS, UPDATE_REQUEST, START_OVER. "
            "Use only explicit user facts. Return budget as a decimal dollar string (e.g. \"500.10\"). "
            "patch keys are eventDate (YYYY-MM-DD), budget, dishes, "
            "cuisines, headcount, eventStyle, dietaryRestrictions, location, fulfillmentMethod, "
            "dietaryRestrictionsConfirmed, or reset. Set dietaryRestrictionsConfirmed only when "
            "the customer states a dietary requirement or explicitly says there are none. Use null "
            "for reference_index when no first/second reference exists. Never invent a missing value."
        )
        try:
            response = await client.chat.completions.create(
                model=os.environ.get("ASI1_MODEL") or "asi1",
                temperature=0,
                messages=[
                    {"role": "system", "content": system},
                    {
                        "role": "user",
                        "content": json.dumps(
                            {"message": message, "knownRequest": state.__dict__}
                        ),
                    },
                ],
            )
            content = response.choices[0].message.content
            if not content:
                return await self.fallback.extract(message, state)
            # Preserve decimal literals exactly even if the model returns a JSON number.
            return self._validated_extraction(json.loads(content, parse_float=str))
        # The hosted model is optional. A malformed response or a transient network
        # failure must not prevent local, deterministic development from working.
        except Exception:  # noqa: BLE001 - this is a deliberate external-service boundary
            return await self.fallback.extract(message, state)

    @staticmethod
    def _validated_extraction(value: object) -> Extraction:
        if not isinstance(value, dict):
            raise ValueError("Structured extraction must be an object.")
        intent = Intent(str(value.get("intent", "UPDATE_REQUEST")))
        patch = value.get("patch", {})
        if not isinstance(patch, dict):
            raise ValueError("Extraction patch must be an object.")
        if "budget" in patch and patch["budget"] is not None:
            patch["budget"] = normalize_budget(patch["budget"])
        reference = value.get("reference_index")
        if reference is not None and (not isinstance(reference, int) or reference < 0):
            raise ValueError("reference_index must be a non-negative integer or null.")
        return Extraction(intent=intent, patch=patch, reference_index=reference)


@dataclass
class AgentReply:
    text: str
    state: PartialCateringRequest
    tools: list[str]


class CateringConversationEngine:
    def __init__(self, backend: AgentBackendClient, extractor: RequestExtractor | None = None):
        self.backend = backend
        self.extractor = extractor or self._default_extractor()

    @staticmethod
    def _default_extractor() -> RequestExtractor:
        api_key = os.environ.get("ASI1_API_KEY")
        return AsiOneExtractor(api_key) if api_key else RuleBasedExtractor()

    async def handle_message(
        self, external_conversation_id: str, customer_id: str, message: str
    ) -> AgentReply:
        raw_state = await self.backend.create_session(external_conversation_id, customer_id)
        state = PartialCateringRequest.from_api(raw_state)
        await self.backend.append_message(
            state.conversation_id, "CUSTOMER", message, f"agent-in:{uuid4()}"
        )
        extraction = await self.extractor.extract(message, state)
        LOGGER.info(
            "agent_event=received_intent session=%s intent=%s",
            state.conversation_id,
            extraction.intent,
        )

        if extraction.patch:
            request_fields = {
                "eventDate",
                "budget",
                "dishes",
                "cuisines",
                "headcount",
                "eventStyle",
                "dietaryRestrictions",
                "location",
                "fulfillmentMethod",
            }
            if state.pending_order_id and request_fields.intersection(extraction.patch):
                extraction.patch["pendingOrderId"] = None
            raw_state = await self.backend.update_state(
                state.conversation_id, state.customer_id, extraction.patch
            )
            state = PartialCateringRequest.from_api(raw_state)

        try:
            reply = await self._respond(extraction, state)
        except BackendDomainError as error:
            reply = AgentReply(
                text=self._domain_error_text(error.code), state=state, tools=[]
            )

        await self.backend.append_message(
            reply.state.conversation_id,
            "SYSTEM",
            reply.text,
            f"agent-out:{uuid4()}",
        )
        return reply

    async def _respond(self, extraction: Extraction, state: PartialCateringRequest) -> AgentReply:
        if extraction.intent == Intent.START_OVER:
            return AgentReply(
                "I cleared this catering request. What date, headcount, location, and cuisine or dish do you need?",
                state,
                [],
            )
        if extraction.intent == Intent.GET_MENU:
            return await self._get_menu(state, extraction.reference_index)
        if extraction.intent == Intent.SELECT_CATERER:
            return await self._select_caterer(state, extraction.reference_index)
        if extraction.intent == Intent.CREATE_ORDER:
            return await self._create_order(state, request_after_creation=False)
        if extraction.intent == Intent.REQUEST_ORDER:
            return await self._request_order(state)
        if extraction.intent == Intent.GET_ORDER_STATUS:
            return await self._get_order_status(state)

        search_input = state.search_input()
        if search_input is None:
            return AgentReply(self._follow_up(state), state, [])

        LOGGER.info("agent_event=selected_tool session=%s tool=search_caterers", state.conversation_id)
        result = await self.backend.tool("search_caterers", search_input)
        matches = result["matches"]
        updated_state = PartialCateringRequest.from_api(
            await self.backend.update_state(
                state.conversation_id,
                state.customer_id,
                {"recentSearchResultIds": [match["caterer"]["id"] for match in matches]},
            )
        )
        if not matches:
            return AgentReply(
                "I couldn't find a caterer matching those requirements. Would you like to adjust the date, budget, location, or food preferences?",
                updated_state,
                ["search_caterers"],
            )
        options = [
            f"{index + 1}. {match['caterer']['businessName']} — {', '.join(match['caterer']['cuisineTypes'])}; {match['caterer']['fulfillmentMethod'].lower()}"
            for index, match in enumerate(matches)
        ]
        optional_missing = state.missing_for_order()
        narrowing_prompt = (
            "\nTo narrow these further, you can also share " + ", ".join(optional_missing) + "."
            if optional_missing
            else ""
        )
        return AgentReply(
            "I found these matching caterers:\n"
            + "\n".join(options)
            + "\nReply with 'first one' or 'second option' to see a menu."
            + narrowing_prompt,
            updated_state,
            ["search_caterers"],
        )

    async def _select_caterer(
        self, state: PartialCateringRequest, reference_index: int | None
    ) -> AgentReply:
        caterer_id = self._resolve_caterer_reference(state, reference_index)
        if not caterer_id:
            return AgentReply("Choose a caterer from the latest search results first.", state, [])
        updated_state = PartialCateringRequest.from_api(
            await self.backend.update_state(
                state.conversation_id,
                state.customer_id,
                {"selectedCatererId": caterer_id, "pendingOrderId": None},
            )
        )
        caterer = (await self.backend.tool("get_caterer", {"catererId": caterer_id}))["caterer"]
        return AgentReply(
            f"Selected {caterer['businessName']}. Ask to see the menu, then choose an item and quantity before booking.",
            updated_state,
            ["get_caterer"],
        )

    async def _get_menu(
        self, state: PartialCateringRequest, reference_index: int | None
    ) -> AgentReply:
        caterer_id = self._resolve_caterer_reference(state, reference_index)
        if not caterer_id:
            return AgentReply("Choose a caterer from the latest search results before requesting a menu.", state, [])
        if caterer_id != state.selected_caterer_id:
            raw_state = await self.backend.update_state(
                state.conversation_id, state.customer_id, {"selectedCatererId": caterer_id}
            )
            state = PartialCateringRequest.from_api(raw_state)
        filters: dict[str, Any] = {}
        if state.dietary_restrictions:
            filters["dietaryRestrictions"] = state.dietary_restrictions
        result = await self.backend.tool("get_menu", {"catererId": caterer_id, "filters": filters})
        items = result["menuItems"]
        if not items:
            return AgentReply("There are no active menu items matching those filters.", state, ["get_menu"])
        lines = [
            f"- {item['name']}: ${item['price']}" + (
                f" ({', '.join(item['dietaryTags']).lower()})" if item["dietaryTags"] else ""
            )
            for item in items
        ]
        return AgentReply("Active menu items:\n" + "\n".join(lines), state, ["get_menu"])

    async def _request_order(self, state: PartialCateringRequest) -> AgentReply:
        if state.pending_order_id:
            result = await self.backend.tool(
                "get_order", {"orderId": state.pending_order_id}
            )
            order = result["order"]["order"]
            if order["status"] == "DRAFT":
                requested = (
                    await self.backend.tool(
                        "request_order",
                        {
                            "orderId": state.pending_order_id,
                            "customerId": state.customer_id,
                        },
                    )
                )["order"]
                return AgentReply(
                    f"Your catering request has been submitted with status {requested['status']}.",
                    state,
                    ["get_order", "request_order"],
                )
            return AgentReply(
                f"This conversation's order is already {order['status']}.",
                state,
                ["get_order"],
            )
        return await self._create_order(state, request_after_creation=True)

    async def _create_order(
        self, state: PartialCateringRequest, request_after_creation: bool
    ) -> AgentReply:
        if not state.selected_caterer_id:
            return AgentReply("Choose a caterer before creating an order.", state, [])
        order_input = state.order_input()
        if order_input is None:
            return AgentReply(self._order_follow_up(state), state, [])
        if len(state.dishes) != 1:
            return AgentReply(
                "Before I create an order, choose one menu item and quantity. I won't assume a menu selection.",
                state,
                [],
            )
        menu = await self.backend.tool(
            "get_menu",
            {
                "catererId": state.selected_caterer_id,
                "filters": {"requestedDishes": state.dishes},
            },
        )
        items = menu["menuItems"]
        if len(items) != 1:
            return AgentReply(
                "Please choose a specific menu item and quantity before I create the order.", state, ["get_menu"]
            )
        order_input = {
            "customerId": state.customer_id,
            "catererId": state.selected_caterer_id,
            **order_input,
            "menuItems": [{"menuItemId": items[0]["id"], "quantity": state.headcount}],
        }
        created = (await self.backend.tool("create_order", order_input))["order"]
        order = created["order"]
        tools = ["get_menu", "create_order"]
        if request_after_creation:
            order = (
                await self.backend.tool(
                    "request_order",
                    {"orderId": order["id"], "customerId": state.customer_id},
                )
            )["order"]
            tools.append("request_order")
        updated_state = PartialCateringRequest.from_api(
            await self.backend.update_state(
                state.conversation_id,
                state.customer_id,
                {"pendingOrderId": order["id"]},
            )
        )
        if not request_after_creation:
            return AgentReply(
                f"I created a draft order. Estimated total: ${order['estimatedTotal']}. Say 'book it' to submit it.",
                updated_state,
                tools,
            )
        return AgentReply(
            f"Your catering request has been submitted with status {order['status']}. Estimated total: ${order['estimatedTotal']}.",
            updated_state,
            tools,
        )

    async def _get_order_status(self, state: PartialCateringRequest) -> AgentReply:
        if not state.pending_order_id:
            return AgentReply("There is no order request in this conversation yet.", state, [])
        result = await self.backend.tool("get_order", {"orderId": state.pending_order_id})
        order = result["order"]["order"]
        return AgentReply(f"Order status: {order['status']}.", state, ["get_order"])

    @staticmethod
    def _resolve_caterer_reference(
        state: PartialCateringRequest, reference_index: int | None
    ) -> str | None:
        if reference_index is not None:
            if 0 <= reference_index < len(state.recent_search_result_ids):
                return state.recent_search_result_ids[reference_index]
            return None
        return state.selected_caterer_id

    @staticmethod
    def _follow_up(state: PartialCateringRequest) -> str:
        missing = state.missing_for_search()
        return "To search accurately, please share your " + ", ".join(missing) + "."

    @staticmethod
    def _order_follow_up(state: PartialCateringRequest) -> str:
        missing = state.missing_for_order()
        return "Before I can create an order, please share your " + ", ".join(missing) + "."

    @staticmethod
    def _domain_error_text(code: str) -> str:
        messages = {
            "CATERER_UNAVAILABLE": "That caterer is not available for the requested date.",
            "CAPACITY_EXCEEDED": "That caterer cannot accommodate the requested headcount.",
            "UNSUPPORTED_EVENT_STYLE": "That caterer does not support the requested event style.",
            "UNSUPPORTED_FULFILLMENT_METHOD": "That caterer does not support the requested pickup or delivery method.",
            "LOCATION_NOT_SUPPORTED": "That caterer does not serve the requested location.",
            "DIETARY_REQUIREMENT_NOT_SUPPORTED": "The selected caterer cannot support those dietary requirements with its current menu.",
            "BUDGET_EXCEEDED": "The selected menu exceeds the stated budget.",
            "MINIMUM_ORDER_NOT_MET": "The selected menu does not meet that caterer's minimum order.",
            "INVALID_MENU_ITEM": "That menu item is not available from the selected caterer.",
            "INVALID_ORDER_TRANSITION": "That order cannot be changed to the requested status.",
            "CATERER_NOT_FOUND": "I couldn't find that caterer.",
            "ORDER_NOT_FOUND": "I couldn't find that order.",
            "BACKEND_UNAVAILABLE": "The marketplace is temporarily unavailable. Please try again shortly.",
        }
        return messages.get(code, "I couldn't complete that marketplace action. Please try again.")
