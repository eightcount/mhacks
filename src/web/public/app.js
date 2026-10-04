// Read-only caterer dashboard. Every figure comes from the dashboard API, which
// calculates it from stored orders, menu items, and availability; this script
// only formats and displays it.

const REFRESH_INTERVAL_MS = 30_000;

const params = new URLSearchParams(window.location.search);
const catererId = params.get("catererId");
const actorUserId = params.get("actorUserId");
const today = params.get("today");

const fulfillmentLabels = {
  PICKUP: "Pickup",
  DELIVERY: "Delivery",
  EITHER: "Pickup or delivery"
};

const eventStyleLabels = {
  BUFFET: "Buffet",
  FAMILY_STYLE: "Family style",
  INDIVIDUAL_MEALS: "Individual meals",
  DROP_OFF: "Drop-off",
  FORMAL: "Formal",
  CASUAL: "Casual"
};

const dietaryLabels = {
  VEGETARIAN: "Vegetarian",
  VEGAN: "Vegan",
  GLUTEN_FREE: "Gluten-free",
  HALAL: "Halal"
};

const statusLabels = {
  ACCEPTED: { label: "Accepted", className: "status-accepted" },
  COMPLETED: { label: "Completed", className: "status-completed" },
  DECLINED: { label: "Declined", className: "status-closed" },
  CANCELLED: { label: "Cancelled", className: "status-closed" }
};

const availabilityLabels = {
  OPEN: "Open",
  CLOSED: "Closed",
  NOT_SET: "Not set"
};

const errorMessages = {
  INVALID_REQUEST: {
    title: "Those IDs don't look right",
    body: "Check the catererId and actorUserId in the address bar."
  },
  CATERER_NOT_FOUND: {
    title: "Caterer not found",
    body: "There is no caterer with that ID."
  },
  UNAUTHORIZED_CATERER: {
    title: "Not your caterer",
    body: "This account doesn't own that caterer, so its dashboard can't be shown."
  },
  INTERNAL_ERROR: {
    title: "The dashboard couldn't load",
    body: "Check that the server can reach the database, then refresh."
  },
  NETWORK: {
    title: "Can't reach the dashboard server",
    body: "Make sure `npm run dashboard` is still running, then refresh."
  },
  RENDER_FAILED: {
    title: "The dashboard couldn't be displayed",
    body: "The server's data doesn't match this page. Restart `npm run dashboard`, then refresh."
  }
};

const byId = (id) => document.getElementById(id);
let hasRendered = false;
let isLoading = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Formats integer cents from the API; no floating-point money math. */
function formatMoney({ cents }) {
  const dollars = Math.floor(cents / 100).toLocaleString("en-US");
  const remainder = cents % 100;
  return remainder === 0 ? `$${dollars}` : `$${dollars}.${String(remainder).padStart(2, "0")}`;
}

function plural(count, word) {
  return `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;
}

/** Labels a stored code, falling back to readable text for values without a label. */
function label(labels, value) {
  const text = value.toLowerCase().replaceAll("_", " ");
  return labels[value] ?? text.charAt(0).toUpperCase() + text.slice(1);
}

// Dates arrive as YYYY-MM-DD and are formatted in UTC so they never shift a day.
function parseDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(isoDate, options) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(
    parseDate(isoDate)
  );
}

function isSameYear(isoDate, todayIso) {
  return isoDate.slice(0, 4) === todayIso.slice(0, 4);
}

/** "Tue, Oct 13", with the year added when it isn't the current one. */
function formatEventDate(isoDate, todayIso) {
  return formatDate(isoDate, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(isSameYear(isoDate, todayIso) ? {} : { year: "numeric" })
  });
}

function formatRange({ start, end }) {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const startLabel = formatDate(start, { month: "short", day: "numeric" });
  const endLabel = formatDate(end, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${startLabel} – ${endLabel}`;
}

function itemsSummary(order) {
  return order.lines.map((line) => `${line.quantity}× ${line.name}`).join(", ");
}

function orderDetails(order) {
  const fulfillment =
    order.fulfillmentMethod === "DELIVERY"
      ? `Delivery to ${order.eventLocation}`
      : label(fulfillmentLabels, order.fulfillmentMethod);
  return [
    plural(order.guestCount, "guest"),
    label(eventStyleLabels, order.eventStyle),
    fulfillment
  ].join(" · ");
}

function tagList(values, labels) {
  const tags = el("div", "tags");
  tags.append(...values.map((value) => el("span", "tag", label(labels, value))));
  return tags;
}

function emptyState(text) {
  return el("li", "empty", text);
}

function dateChip(isoDate, todayIso) {
  const chip = el("div", "date");
  chip.append(
    el("span", "mon", formatDate(isoDate, { month: "short" })),
    el("span", "dom", formatDate(isoDate, { day: "numeric" }))
  );
  if (!isSameYear(isoDate, todayIso)) {
    chip.append(el("span", "yr", isoDate.slice(0, 4)));
  }
  return chip;
}

/** Shared body for an order row: customer, event details, items, dietary needs, and note. */
function orderMain(order, dateText, { showNote }) {
  const main = el("div", "row-main");
  main.append(
    el("p", "row-title", order.customerName),
    el("p", "row-sub", `${dateText} · ${orderDetails(order)}`)
  );
  if (order.lines.length > 0) {
    main.append(el("p", "row-sub", itemsSummary(order)));
  }
  if (order.dietaryRestrictions.length > 0) {
    main.append(tagList(order.dietaryRestrictions, dietaryLabels));
  }
  if (showNote && order.specialRequests) {
    main.append(el("p", "row-note", `“${order.specialRequests}”`));
  }
  return main;
}

function bookedOrderRow(order, todayIso, options) {
  const row = el("li", "row");
  const side = el("div", "row-side");
  const status = statusLabels[order.status] ?? { label: label({}, order.status), className: "" };
  side.append(
    el("p", "amount", formatMoney(order.total)),
    el("span", `status ${status.className}`, status.label)
  );

  row.append(
    dateChip(order.eventDate, todayIso),
    orderMain(order, formatDate(order.eventDate, { weekday: "short" }), options),
    side
  );
  return row;
}

function renderStats(data) {
  const { customers, revenue, ordersToFill } = data.stats;
  const monthName = formatDate(data.month.start, { month: "long" });

  byId("revenue-total").textContent = formatMoney(revenue.month);
  byId("revenue-sub").textContent = `${monthName} · ${formatMoney(revenue.completed)} completed, ${formatMoney(revenue.upcoming)} to fill`;

  byId("orders-to-fill").textContent = ordersToFill.count.toLocaleString("en-US");
  byId("orders-sub").textContent = ordersToFill.nextEventDate
    ? `${plural(ordersToFill.guestCount, "guest")} · next ${formatEventDate(ordersToFill.nextEventDate, data.today)}`
    : "No accepted orders coming up";

  byId("customers-total").textContent = customers.total.toLocaleString("en-US");
  byId("customers-sub").textContent = `${customers.bookedThisMonth.toLocaleString("en-US")} booked in ${monthName}`;
}

function renderUpcoming(data) {
  const list = byId("upcoming-list");
  if (data.upcoming.length === 0) {
    list.replaceChildren(emptyState("No accepted orders coming up."));
    return;
  }

  list.replaceChildren(
    ...data.upcoming.map((order) => bookedOrderRow(order, data.today, { showNote: true }))
  );
}

function renderRequests(data) {
  byId("requests-count").textContent = String(data.stats.pendingRequests.count);
  const list = byId("request-list");

  if (data.pendingRequests.length === 0) {
    list.replaceChildren(emptyState("No requests waiting right now."));
    return;
  }

  list.replaceChildren(
    ...data.pendingRequests.map((order) => {
      const row = el("li", "row");
      row.append(
        orderMain(order, formatEventDate(order.eventDate, data.today), { showNote: true }),
        el("p", "amount", formatMoney(order.total))
      );
      return row;
    })
  );
}

function renderAvailability(data) {
  byId("availability-range").textContent = formatRange(data.availability.period);

  byId("availability-list").replaceChildren(
    ...data.availability.days.map((day) => {
      const tile = el("li", `day day-${day.status.toLowerCase().replaceAll("_", "-")}`);
      if (day.date === data.today) {
        tile.classList.add("is-today");
        tile.setAttribute("aria-current", "date");
      }
      tile.append(
        el("span", "day-dow", formatDate(day.date, { weekday: "short" })),
        el("span", "day-dom", formatDate(day.date, { day: "numeric" })),
        el("span", "day-status", label(availabilityLabels, day.status))
      );
      if (day.capacity !== null) {
        tile.append(el("span", "day-detail", `Up to ${plural(day.capacity, "guest")}`));
      }
      if (day.bookedGuests > 0) {
        tile.append(el("span", "day-booked", `${day.bookedGuests.toLocaleString("en-US")} booked`));
      }
      return tile;
    })
  );
}

function renderMenu(data) {
  const list = byId("menu-list");
  if (data.menu.length === 0) {
    list.replaceChildren(emptyState("No menu items yet."));
    return;
  }

  list.replaceChildren(
    ...data.menu.map((item) => {
      const card = el("li", item.active ? "menu-item" : "menu-item is-inactive");
      card.title = item.description;
      card.append(
        el("p", "menu-price", `${item.active ? "" : "Inactive · "}${formatMoney(item.price)} each`),
        el("p", "menu-name", item.name),
        el(
          "p",
          "menu-meta",
          item.servingsBooked > 0
            ? `${plural(item.servingsBooked, "serving")} booked · ${plural(item.orderCount, "order")}`
            : "No servings booked yet"
        )
      );
      if (item.dietaryTags.length > 0) {
        card.append(tagList(item.dietaryTags, dietaryLabels));
      }
      return card;
    })
  );
}

function renderHistory(data) {
  const list = byId("history-list");
  if (data.history.length === 0) {
    list.replaceChildren(emptyState("Completed, declined, and cancelled orders will show up here."));
    return;
  }

  list.replaceChildren(
    ...data.history.map((order) => bookedOrderRow(order, data.today, { showNote: false }))
  );
}

function render(data) {
  const { businessName, ownerName, location, cuisineTypes, active } = data.caterer;
  document.title = `${businessName} · Dashboard`;
  byId("business-name").textContent = businessName;
  byId("business-name-wrap").hidden = false;

  const subtitle = byId("subtitle");
  subtitle.replaceChildren(
    [ownerName, location, cuisineTypes.map((cuisine) => label({}, cuisine)).join(", ")]
      .filter(Boolean)
      .join(" · ")
  );
  if (!active) {
    const flag = el("span", "status status-closed", "Inactive");
    flag.title = "Hidden from customer search; new orders can't be placed.";
    subtitle.append(flag);
  }

  renderStats(data);
  renderUpcoming(data);
  renderRequests(data);
  renderAvailability(data);
  renderMenu(data);
  renderHistory(data);
}

function showNotice({ title, body }) {
  byId("notice-title").textContent = title;
  byId("notice-body").textContent = body;
  byId("notice").hidden = false;
}

function hideNotice() {
  byId("notice").hidden = true;
}

async function loadDashboard() {
  if (isLoading) return;
  isLoading = true;
  const refreshButton = byId("refresh-button");
  refreshButton.disabled = true;

  try {
    const query = new URLSearchParams({ actorUserId });
    if (today) query.set("today", today);
    let response;
    try {
      response = await fetch(
        `/api/caterers/${encodeURIComponent(catererId)}/dashboard?${query}`,
        { headers: { Accept: "application/json" }, cache: "no-store" }
      );
    } catch {
      showNotice(errorMessages.NETWORK);
      return;
    }
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      showNotice(errorMessages[body.error] ?? errorMessages.INTERNAL_ERROR);
      return;
    }

    render(body);
    hasRendered = true;
    hideNotice();
    byId("updated-at").textContent = `Updated ${new Date().toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit"
    })}`;
  } catch {
    // The server answered with data this page can't display, e.g. a server
    // process still running older code.
    showNotice(errorMessages.RENDER_FAILED);
  } finally {
    isLoading = false;
    refreshButton.disabled = false;
    byId("dashboard").hidden = !hasRendered;
    byId("refresh-area").hidden = !hasRendered;
  }
}

if (!catererId || !actorUserId) {
  showNotice({
    title: "Which caterer?",
    body: "Open this page with your IDs in the address, for example /?catererId=<caterer id>&actorUserId=<owner user id>."
  });
} else {
  byId("refresh-button").addEventListener("click", loadDashboard);
  loadDashboard();
  setInterval(() => {
    if (!document.hidden) loadDashboard();
  }, REFRESH_INTERVAL_MS);
  // Catch up right away when the caterer comes back to the tab.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadDashboard();
  });
}
