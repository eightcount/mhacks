from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


def normalize_budget(value: object) -> str:
    """Keep dollars as an exact decimal string matching Postgres numeric(12,2)."""
    if type(value) not in (str, int):
        raise ValueError("Budgets must be decimal strings or whole-dollar integers.")
    source = str(value).strip()
    if not re.fullmatch(r"[0-9]+(?:\.[0-9]{1,2})?", source):
        raise ValueError("Budgets must be non-negative with at most two decimal places.")
    whole, _, fraction = source.partition(".")
    whole = whole.lstrip("0") or "0"
    if len(whole) > 10:
        raise ValueError("Budget exceeds the database money limit.")
    return f"{whole}.{fraction.ljust(2, '0')}"


@dataclass
class PartialCateringRequest:
    """The persisted request shape returned by the TypeScript backend."""

    conversation_id: str
    customer_id: str
    event_date: str | None = None
    budget: str | None = None
    dishes: list[str] = field(default_factory=list)
    cuisines: list[str] = field(default_factory=list)
    headcount: int | None = None
    event_style: str | None = None
    dietary_restrictions: list[str] = field(default_factory=list)
    dietary_restrictions_confirmed: bool = False
    location: str | None = None
    fulfillment_method: str | None = None
    recent_search_result_ids: list[str] = field(default_factory=list)
    selected_caterer_id: str | None = None
    pending_order_id: str | None = None

    @classmethod
    def from_api(cls, state: dict[str, Any]) -> "PartialCateringRequest":
        budget = state.get("budget")
        return cls(
            conversation_id=str(state["conversationId"]),
            customer_id=str(state["customerId"]),
            event_date=state.get("eventDate"),
            budget=normalize_budget(budget) if budget is not None else None,
            dishes=list(state.get("dishes", [])),
            cuisines=list(state.get("cuisines", [])),
            headcount=state.get("headcount"),
            event_style=state.get("eventStyle"),
            dietary_restrictions=list(state.get("dietaryRestrictions", [])),
            dietary_restrictions_confirmed=bool(state.get("dietaryRestrictionsConfirmed", False)),
            location=state.get("location"),
            fulfillment_method=state.get("fulfillmentMethod"),
            recent_search_result_ids=list(state.get("recentSearchResultIds", [])),
            selected_caterer_id=state.get("selectedCatererId"),
            pending_order_id=state.get("pendingOrderId"),
        )

    def search_input(self) -> dict[str, Any] | None:
        """Return the minimum useful search input, omitting unknown preferences."""
        if not all(
            [
                self.event_date,
                self.headcount is not None,
                self.location,
                self.dishes or self.cuisines,
            ]
        ):
            return None
        search: dict[str, Any] = {
            "eventDate": self.event_date,
            "dishes": self.dishes,
            "cuisines": self.cuisines,
            "headcount": self.headcount,
            "location": self.location,
        }
        if self.budget is not None:
            search["budget"] = self.budget
        if self.event_style:
            search["eventStyle"] = self.event_style
        if self.dietary_restrictions:
            search["dietaryRestrictions"] = self.dietary_restrictions
        if self.fulfillment_method:
            search["fulfillmentMethod"] = self.fulfillment_method
        return search

    def order_input(self) -> dict[str, Any] | None:
        """Return a complete Phase 2 order/search input only when known."""
        search = self.search_input()
        if (
            search is None
            or self.budget is None
            or not self.event_style
            or not self.fulfillment_method
            or not self.dietary_restrictions_confirmed
        ):
            return None
        return {
            **search,
            "budget": self.budget,
            "eventStyle": self.event_style,
            "dietaryRestrictions": self.dietary_restrictions,
            "fulfillmentMethod": self.fulfillment_method,
        }

    def missing_for_search(self) -> list[str]:
        missing: list[str] = []
        if not self.event_date:
            missing.append("event date")
        if not self.headcount:
            missing.append("headcount")
        if not self.location:
            missing.append("event location")
        if not self.dishes and not self.cuisines:
            missing.append("a cuisine or dish")
        return missing

    def missing_for_order(self) -> list[str]:
        missing = self.missing_for_search()
        if self.budget is None:
            missing.append("budget")
        if not self.event_style:
            missing.append("event style")
        if not self.dietary_restrictions_confirmed:
            missing.append("dietary restrictions (or confirmation that there are none)")
        if not self.fulfillment_method:
            missing.append("pickup or delivery preference")
        return missing
