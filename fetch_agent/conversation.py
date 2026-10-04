from __future__ import annotations

import logging
import os
from dataclasses import dataclass, replace
from typing import Any
from uuid import uuid4

from .backend import AgentBackendClient, BackendDomainError
from .models import PartialCateringRequest
from .menu_selection import MenuSelection, normalized_menu_name
from .extraction import (
    AsiOneExtractor, ConversationContext, Extraction, Intent,
    RequestExtractor, RequestUpdate, RuleBasedExtractor,
)

LOGGER = logging.getLogger(__name__)


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
        root = PartialCateringRequest.from_api(
            await self.backend.create_session(external_conversation_id, customer_id)
        )
        state = root
        try:
            raw_context = await self.backend.get_context(root.conversation_id, customer_id)
            context = ConversationContext(
                [PartialCateringRequest.from_api(row) for row in raw_context["requests"]],
                raw_context.get("history", []),
            )
            state = next(request for request in context.requests
                         if request.conversation_id == raw_context["activeConversationId"])
            await self.backend.append_message(root.conversation_id, "CUSTOMER", message, f"agent-in:{uuid4()}")
            extraction = await self.extractor.extract(message, state, context)
            LOGGER.info("agent_event=received_intent intent=%s", extraction.intent.value)
            if extraction.intent in (Intent.GET_ORDERS, Intent.GET_ORDER_STATUS):
                reply = await self._get_orders(state, extraction.order_filters)
            elif extraction.intent == Intent.GET_REQUESTS:
                reply = AgentReply(self._requests_summary(context.requests), state, [])
            elif extraction.intent in (Intent.HELP, Intent.CLARIFY):
                text = ("I can find caterers, plan separate events, show menus, submit your chosen "
                        "orders, and tell you what you ordered. "
                        "Describe each event's location, date, guest count, and food preferences.")
                if len(context.requests) > 1:
                    text += "\n" + self._requests_summary(context.requests) + "\nWhich request should we work on?"
                reply = AgentReply(text, state, [])
            else:
                reply = await self._handle_requests(root, state, context, extraction)
        except BackendDomainError as error:
            reply = AgentReply(self._domain_error_text(error.code), state, [])
        await self.backend.append_message(root.conversation_id, "SYSTEM", reply.text[:10_000], f"agent-out:{uuid4()}")
        return reply

    async def _handle_requests(self, root: PartialCateringRequest, active: PartialCateringRequest,
                               context: ConversationContext, extraction: Extraction) -> AgentReply:
        updates = extraction.request_updates or [RequestUpdate(
            extraction.patch, extraction.request_index, extraction.new_request,
        )]
        # Resolve every event reference before changing requests or submitting orders.
        if any((u.request_index is not None and not 0 <= u.request_index < len(context.requests))
               or (u.new_request and u.request_index is not None)
               or (len(updates) > 1 and u.request_index is None and not u.new_request)
               for u in updates):
            return AgentReply("Please identify the event by request number or location; I couldn't resolve that reference.", active, [])
        reuse_root = int(len(context.requests) == 1 and self._is_empty(context.requests[0]) and updates[0].new_request)
        if len(context.requests) + sum(u.new_request for u in updates) - reuse_root > 20:
            return AgentReply("Please finish an existing catering request before adding more events.", active, [])
        replies: list[AgentReply] = []
        for update_index, update in enumerate(updates):
            if update.new_request:
                if update_index == 0 and reuse_root:
                    state = context.requests[0]
                else:
                    state = PartialCateringRequest.from_api(
                        await self.backend.create_request(root.conversation_id, root.customer_id)
                    )
                    context.requests.append(state)
            elif update.request_index is not None:
                state = context.requests[update.request_index]
            else:
                state = active
            reply = await self._process_request(root, state, extraction, update)
            index = next(i for i, request in enumerate(context.requests)
                         if request.conversation_id == state.conversation_id)
            context.requests[index] = reply.state
            if len(context.requests) > 1 or len(updates) > 1:
                reply.text = f"Request {index + 1} — {reply.state.location or 'location not specified'}:\n{reply.text}"
            replies.append(reply)
        return AgentReply("\n\n".join(reply.text for reply in replies), replies[-1].state,
                          [tool for reply in replies for tool in reply.tools])

    async def _process_request(self, root: PartialCateringRequest, state: PartialCateringRequest,
                               extraction: Extraction, update: RequestUpdate) -> AgentReply:
        try:
            state = PartialCateringRequest.from_api(await self.backend.activate_request(
                root.conversation_id, root.customer_id, state.conversation_id,
            ))
            patch = dict(update.patch)
            if extraction.intent == Intent.START_OVER:
                patch["reset"] = True
            fields = {
                "eventDate": state.event_date, "budget": state.budget, "dishes": state.dishes,
                "cuisines": state.cuisines, "headcount": state.headcount, "eventStyle": state.event_style,
                "dietaryRestrictions": state.dietary_restrictions, "location": state.location,
                "fulfillmentMethod": state.fulfillment_method,
            }
            changed = {key for key, value in patch.items() if key in fields and value != fields[key]}
            if changed:
                patch["pendingOrderId"] = None
            # Choosing a dish from the displayed menu keeps that caterer selected.
            if changed - {"dishes"}:
                patch.update(selectedCatererId=None, recentSearchResultIds=[])
            if patch:
                state = PartialCateringRequest.from_api(await self.backend.update_state(
                    state.conversation_id, state.customer_id, patch,
                ))
            step = replace(extraction, patch=patch, request_updates=[])
            if extraction.caterer_name:
                step.reference_index = await self._named_caterer_reference(state, extraction.caterer_name)
                if step.reference_index is None:
                    return AgentReply("I couldn't identify that name in this event's search results. Choose an option number.", state, ["get_caterer"])
            if step.intent == Intent.REQUEST_ORDER and not state.selected_caterer_id and update.new_request:
                step.intent = Intent.FIND_CATERING
            return await self._respond(step, state)
        except BackendDomainError as error:
            return AgentReply(self._domain_error_text(error.code), state, [])

    @staticmethod
    def _is_empty(state: PartialCateringRequest) -> bool:
        return not any((state.event_date, state.budget, state.cuisines, state.dishes, state.headcount,
                        state.location, state.event_style, state.fulfillment_method,
                        state.dietary_restrictions_confirmed, state.pending_order_id))

    @staticmethod
    def _requests_summary(requests: list[PartialCateringRequest]) -> str:
        lines = []
        for index, state in enumerate(requests):
            details = [state.location or "location needed", state.event_date or "date needed",
                       f"{state.headcount} guests" if state.headcount else "guest count needed",
                       ", ".join(state.dishes or state.cuisines) or "food preferences needed"]
            if state.budget is not None:
                details.append(f"budget ${state.budget}")
            if state.pending_order_id:
                details.append("order created; ask for its current status")
            lines.append(f"{index + 1}. " + " · ".join(details))
        return "Your catering plans:\n" + "\n".join(lines)

    async def _named_caterer_reference(self, state: PartialCateringRequest, name: str) -> int | None:
        matches = []
        for index, caterer_id in enumerate(state.recent_search_result_ids):
            result = await self.backend.tool("get_caterer", {"catererId": caterer_id})
            if result["caterer"]["businessName"].casefold() == name.strip().casefold():
                matches.append(index)
        return matches[0] if len(matches) == 1 else None

    async def _get_orders(self, state: PartialCateringRequest, filters: dict[str, str]) -> AgentReply:
        result = await self.backend.tool("get_orders", {**filters, "customerId": state.customer_id})
        if not result["orders"]:
            return AgentReply("You have no saved orders matching that request. Your catering plans aren't orders until you submit them.", state, ["get_orders"])
        status_labels = {
            "DRAFT": "draft — not submitted", "REQUESTED": "requested — awaiting caterer acceptance",
            "ACCEPTED": "accepted", "DECLINED": "declined", "CANCELLED": "cancelled", "COMPLETED": "completed",
        }
        lines = []
        for entry in result["orders"]:
            order = entry["order"]
            items = ", ".join(f"{item['quantity']} × {item['name']} (${item['unitPrice']} each)" for item in entry["items"])
            lines.append(f"- {entry['catererName']} on {order['eventDate']} at {order['eventLocation']}: "
                         f"{items or 'no items recorded'}; {order['guestCount']} guests; "
                         f"{order['fulfillmentMethod'].lower()}; total ${order['estimatedTotal']}; "
                         f"{status_labels[order['status']]}.")
        text = "Your saved orders:\n" + "\n".join(lines)
        if result.get("hasMore"):
            text += "\nShowing the latest 50 orders. Give me a date, location, or status to narrow them down."
        return AgentReply(text, state, ["get_orders"])

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
        if extraction.intent == Intent.SELECT_MENU_ITEMS:
            return await self._create_order(state, request_after_creation=False,
                                            selections=extraction.menu_items)
        if extraction.intent == Intent.CREATE_ORDER:
            return await self._create_order(state, request_after_creation=False)
        if extraction.intent == Intent.REQUEST_ORDER:
            return await self._request_order(state)

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
                state.conversation_id, state.customer_id, {"selectedCatererId": caterer_id, "pendingOrderId": None}
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
        return AgentReply("Active menu items:\n" + "\n".join(lines)
                          + "\nTell me the item names and quantities, such as '20 Vegetable Dumplings'. Quantities use the menu's listed units.",
                          state, ["get_menu"])

    async def _request_order(self, state: PartialCateringRequest) -> AgentReply:
        if state.pending_order_id:
            result = await self.backend.tool(
                "get_order", {"orderId": state.pending_order_id, "customerId": state.customer_id}
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
        self, state: PartialCateringRequest, request_after_creation: bool,
        selections: list[MenuSelection] | None = None,
    ) -> AgentReply:
        if not state.selected_caterer_id:
            return AgentReply("Choose a caterer before creating an order.", state, [])
        if state.pending_order_id:
            result = await self.backend.tool("get_order", {
                "orderId": state.pending_order_id, "customerId": state.customer_id,
            })
            status = result["order"]["order"]["status"]
            return AgentReply(
                f"This event already has an order with status {status}. "
                "To keep it, say 'book it' if it is a draft. To choose a replacement, start over with a new request.",
                state, ["get_order"],
            )
        if not selections:
            return AgentReply(
                "Please tell me the menu item names and quantities before I create the order, "
                "for example '20 Vegetable Dumplings'.", state, [],
            )
        if any(type(item.quantity) is not int or not 0 < item.quantity <= 2_147_483_647 for item in selections):
            return AgentReply("Please use a positive whole-number quantity for each menu item.", state, [])
        order_input = state.order_input()
        if order_input is None:
            return AgentReply(
                self._order_follow_up(state) + " Then send the item names and quantities again to save the draft.",
                state, [],
            )
        menu = await self.backend.tool(
            "get_menu", {"catererId": state.selected_caterer_id},
        )
        items = menu["menuItems"]
        chosen: list[dict[str, Any]] = []
        descriptions: list[str] = []
        for selection in selections:
            name = normalized_menu_name(selection.name)
            exact = [item for item in items if normalized_menu_name(item["name"]) == name]
            matches = exact or [item for item in items
                                if name and f" {name} " in f" {normalized_menu_name(item['name'])} "]
            if len(matches) != 1:
                reason = "matches several items" if matches else "isn't on this caterer's active menu"
                return AgentReply(
                    f"'{selection.name}' {reason}. Please use the exact menu item name and quantity. "
                    "I haven't created an order.", state, ["get_menu"],
                )
            item = matches[0]
            if any(line["menuItemId"] == item["id"] for line in chosen):
                return AgentReply("Please list each menu item once with its total quantity.", state, ["get_menu"])
            chosen.append({"menuItemId": item["id"], "quantity": selection.quantity})
            descriptions.append(f"{selection.quantity} × {item['name']}")
        order_input = {
            "customerId": state.customer_id,
            "catererId": state.selected_caterer_id,
            **order_input,
            "menuItems": chosen,
        }
        created = (await self.backend.tool("create_order", order_input))["order"]
        order = created["order"]
        updated_state = PartialCateringRequest.from_api(
            await self.backend.update_state(
                state.conversation_id,
                state.customer_id,
                {"pendingOrderId": order["id"]},
            )
        )
        tools = ["get_menu", "create_order"]
        if request_after_creation:
            order = (
                await self.backend.tool(
                    "request_order",
                    {"orderId": order["id"], "customerId": state.customer_id},
                )
            )["order"]
            tools.append("request_order")
        if not request_after_creation:
            return AgentReply(
                f"I created a draft order: {', '.join(descriptions)}. "
                f"Estimated total: ${order['estimatedTotal']}. Say 'book it' to submit it.",
                updated_state,
                tools,
            )
        return AgentReply(
            f"Your catering request has been submitted with status {order['status']}. Estimated total: ${order['estimatedTotal']}.",
            updated_state,
            tools,
        )

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
            "INVALID_INPUT": "I couldn't use one of those details. Please check the date, guest count, budget, and preferences.",
            "UNAUTHORIZED_CUSTOMER": "I can only show or change orders belonging to this customer.",
            "REQUEST_LIMIT_REACHED": "Please finish an existing catering request before adding more events.",
            "BACKEND_UNAVAILABLE": "The marketplace is temporarily unavailable. Please try again shortly.",
        }
        return messages.get(code, "I couldn't complete that marketplace action. Please try again.")
