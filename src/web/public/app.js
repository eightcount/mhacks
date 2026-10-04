// Read-only caterer dashboard. Every figure comes from the dashboard API, which
// calculates it from stored orders, menu items, and preorders; this script only
// formats and displays it, and remembers which month and detail view is open.

const REFRESH_INTERVAL_MS = 30_000;

const params = new URLSearchParams(window.location.search);
const catererId = params.get("catererId");
const actorUserId = params.get("actorUserId");
const today = params.get("today");
/** YYYY-MM of the month shown, or null for the month containing today. */
let selectedMonth = params.get("month");

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
  REQUESTED: { label: "Awaiting reply", className: "status-pending" },
  ACCEPTED: { label: "Accepted", className: "status-accepted" },
  COMPLETED: { label: "Completed", className: "status-completed" },
  DECLINED: { label: "Declined", className: "status-closed" },
  CANCELLED: { label: "Cancelled", className: "status-closed" }
};

/** Detail views, keyed by the tile's address (#revenue, #orders, ...). */
const detailTitles = {
  revenue: "Revenue",
  orders: "Orders to fill",
  awaiting: "Awaiting your reply",
  customers: "Customers"
};

const errorMessages = {
  INVALID_REQUEST: {
    title: "Those IDs don't look right",
    body: "Check the catererId, actorUserId, and month in the address bar."
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
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let hasRendered = false;
let lastData = null;
let latestRequest = 0;
let inFlight = 0;
/** True for the render after a detail view opens or changes month, so its charts grow in once. */
let revealCharts = false;

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

/** Whole dollars for chart labels, e.g. $4.5k. Display only. */
function formatCompactMoney(cents) {
  const dollars = Math.round(cents / 100);
  if (dollars < 1000) return `$${dollars}`;
  const thousands = dollars / 1000;
  return `$${thousands.toLocaleString("en-US", { maximumFractionDigits: thousands < 10 ? 1 : 0 })}k`;
}

function plural(count, word, pluralWord = `${word}s`) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? word : pluralWord}`;
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

/** "October 2026" for a YYYY-MM month. */
function monthLabel(yearMonth) {
  return formatDate(`${yearMonth}-01`, { month: "long", year: "numeric" });
}

function monthName(yearMonth) {
  return formatDate(`${yearMonth}-01`, { month: "long" });
}

function daysWaiting(requestedOn, todayIso) {
  return Math.max(0, Math.round((parseDate(todayIso) - parseDate(requestedOn)) / 86_400_000));
}

function waitingLabel(days) {
  return days === 0 ? "Received today" : `Waiting ${plural(days, "day")}`;
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

function statusPill(labels, value) {
  const status = labels[value] ?? { label: label({}, value), className: "" };
  return el("span", `status ${status.className}`, status.label);
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
  side.append(el("p", "amount", formatMoney(order.total)), statusPill(statusLabels, order.status));

  row.append(
    dateChip(order.eventDate, todayIso),
    orderMain(order, formatDate(order.eventDate, { weekday: "short" }), options),
    side
  );
  return row;
}

function requestRow(order, todayIso) {
  const row = el("li", "row");
  const side = el("div", "row-side");
  side.append(
    el("p", "amount", formatMoney(order.total)),
    el("p", "row-sub", waitingLabel(daysWaiting(order.requestedOn, todayIso)))
  );
  row.append(
    dateChip(order.eventDate, todayIso),
    orderMain(order, formatDate(order.eventDate, { weekday: "short" }), { showNote: true }),
    side
  );
  return row;
}

function preorderRow(order, todayIso) {
  const row = el("li", "row");
  const main = el("div", "row-main");
  main.append(
    el("p", "row-title", order.customerName),
    el("p", "row-sub", [order.formTitle, order.deliveryAddress].filter(Boolean).join(" · ")),
    el("p", "row-sub", order.lines.map((line) => `${line.quantity}× ${line.name}`).join(", "))
  );
  const side = el("div", "row-side");
  side.append(
    el("p", "amount", formatMoney(order.total)),
    el("p", "row-sub", waitingLabel(daysWaiting(order.requestedOn, todayIso)))
  );
  row.append(dateChip(order.fulfillmentDate, todayIso), main, side);
  return row;
}

function listPanel(items, emptyText) {
  const panel = el("div", "panel");
  const list = el("ul", "rows");
  list.append(...(items.length > 0 ? items : [emptyState(emptyText)]));
  panel.append(list);
  return panel;
}

// Dashboard: header, month bar, tiles, and the live lists.

/** Up to two initials for the logo mark, e.g. "Jade Juniper Kitchen" → "JJ". */
function initials(name) {
  return name
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

function renderHeader(data) {
  const { businessName, active } = data.caterer;
  byId("brand-mark").textContent = initials(businessName);
  byId("brand-mark").hidden = false;
  byId("brand-divider").hidden = false;
  byId("today-label").textContent = formatDate(data.today, { weekday: "long", month: "long", day: "numeric" });
  const name = byId("business-name");
  name.replaceChildren(el("span", "brand-text", businessName));
  if (!active) {
    const flag = el("span", "status status-closed", "Inactive");
    flag.title = "Hidden from customer search; new orders can't be placed.";
    name.append(flag);
  }
}

function renderMonthBar(data) {
  const { month, months } = data.monthView;
  byId("month-heading").textContent = monthLabel(month);
  const index = months.indexOf(month);
  byId("month-prev").disabled = index <= 0;
  byId("month-next").disabled = index === -1 || index >= months.length - 1;
}

function renderStats(data) {
  const { revenue, ordersToFill, awaiting, customers } = data.monthView;

  byId("revenue-total").textContent = formatMoney(revenue.total);
  const revenueParts = [
    revenue.completed.cents > 0 ? `${formatMoney(revenue.completed)} completed` : "",
    revenue.toFill.cents > 0 ? `${formatMoney(revenue.toFill)} still to fill` : ""
  ].filter(Boolean);
  byId("revenue-sub").textContent = revenueParts.length > 0 ? revenueParts.join(" and ") : "No booked orders";
  byId("revenue-preorders").textContent =
    revenue.preorders.cents > 0 ? `Plus ${formatMoney(revenue.preorders)} in preorders` : "";

  byId("orders-to-fill").textContent = ordersToFill.count.toLocaleString("en-US");
  byId("orders-sub").textContent = ordersToFill.count > 0
    ? `${plural(ordersToFill.guestCount, "guest")}${ordersToFill.nextEventDate ? `, next on ${formatEventDate(ordersToFill.nextEventDate, data.today)}` : ""}`
    : ordersToFill.filled.length > 0
      ? `All ${plural(ordersToFill.filled.length, "order")} filled`
      : "Nothing to fill";

  byId("awaiting-total").textContent = awaiting.count.toLocaleString("en-US");
  byId("awaiting-sub").textContent = awaiting.count === 0
    ? "You're all caught up"
    : `${plural(awaiting.requests.length, "catering request")} and ${plural(awaiting.preorders.length, "preorder")}`;

  byId("customers-total").textContent = customers.count.toLocaleString("en-US");
  byId("customers-sub").textContent = customers.count > 0
    ? `${customers.newCount} new and ${customers.returningCount} returning`
    : "No booked customers";
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

  list.replaceChildren(...data.pendingRequests.map((order) => requestRow(order, data.today)));
}

function renderWeekMenu(data) {
  byId("menu-range").textContent = formatRange(data.weekMenu.period);
  const list = byId("menu-list");
  if (data.weekMenu.items.length === 0) {
    list.replaceChildren(emptyState("No menu items yet."));
    return;
  }

  list.replaceChildren(
    ...data.weekMenu.items.map((item) => {
      const card = el("li", item.active ? "menu-item" : "menu-item is-inactive");
      card.title = item.description;
      card.append(
        el("p", "menu-price", `${item.active ? "" : "Inactive · "}${formatMoney(item.price)} each`),
        el("p", "menu-name", item.name)
      );

      if (item.servings > 0 || item.preorderPackages > 0) {
        const booked = el("div", "menu-booked");
        if (item.servings > 0) {
          const servings = el("span", "menu-count", plural(item.servings, "serving"));
          servings.title = `${plural(item.orderCount, "accepted order")} this week`;
          booked.append(servings);
        }
        if (item.preorderPackages > 0) {
          booked.append(el("span", "menu-count menu-count-preorder", plural(item.preorderPackages, "preorder package")));
        }
        card.append(booked);
      } else {
        card.append(el("p", "menu-idle", "Not booked this week"));
      }

      if (item.dietaryTags.length > 0) {
        card.append(tagList(item.dietaryTags, dietaryLabels));
      }
      return card;
    })
  );
}

// Detail views: figures, a chart, and the people and orders behind a tile.

function facts(entries) {
  const list = el("dl", "facts");
  for (const [term, value] of entries) {
    const item = el("div", "fact");
    item.append(el("dt", "", term), el("dd", "", value));
    list.append(item);
  }
  return list;
}

function block(title, note, ...content) {
  const section = el("section", "detail-block");
  const head = el("div", "block-head");
  head.append(el("h3", "block-title", title));
  if (note) head.append(el("span", "section-note", note));
  section.append(head, ...content);
  return section;
}

function columns(...blocks) {
  const grid = el("div", "detail-columns");
  grid.append(...blocks);
  return grid;
}

function legend(series) {
  const list = el("div", "legend");
  for (const entry of series) {
    const item = el("span", "legend-item");
    item.append(el("span", `swatch ${entry.className}`), entry.label);
    list.append(item);
  }
  return list;
}

/**
 * Stacked columns from plain elements. Values are display-only numbers (cents
 * or counts) used for proportions; each column carries a readable title.
 */
function columnChart({ description, series, points, showTotals = true, labelEvery = 1, dense = false }) {
  const figure = el("figure", "chart");
  if (series.length > 1) figure.append(legend(series));
  const plot = el("div", dense ? "chart-plot is-dense" : "chart-plot");
  plot.setAttribute("role", "img");
  plot.setAttribute("aria-label", description);
  const max = Math.max(1, ...points.map((point) => point.total));
  const axis = el("div", dense ? "chart-x is-dense" : "chart-x");

  points.forEach((point, index) => {
    const column = el("div", point.current ? "chart-col is-current" : "chart-col");
    column.title = point.title;
    column.style.setProperty("--i", String(index));
    const stack = el("div", "chart-stack");
    stack.style.height = `${(point.total / max) * 100}%`;
    for (const entry of series) {
      const value = point.values[entry.key] ?? 0;
      if (value <= 0) continue;
      const segment = el("span", `seg ${entry.className}`);
      segment.style.flexGrow = String(value);
      stack.append(segment);
    }
    if (showTotals && point.total > 0) stack.append(el("small", "chart-total", point.totalLabel));
    column.append(stack);
    plot.append(column);
    axis.append(el("span", point.current ? "is-current" : "", index % labelEvery === 0 ? point.label : ""));
  });

  figure.append(plot, axis);
  return figure;
}

function barRows(entries) {
  const max = Math.max(1, ...entries.map((entry) => entry.value));
  const list = el("ul", "hbars");
  entries.forEach((entry, index) => {
    const item = el("li", "hbar");
    item.style.setProperty("--i", String(index));
    const track = el("span", "hbar-track");
    const fill = el("span", "hbar-fill");
    fill.style.width = `${(entry.value / max) * 100}%`;
    track.append(fill);
    item.append(el("span", "hbar-label", entry.label), track, el("span", "hbar-value", String(entry.value)));
    list.append(item);
  });
  return list;
}

const twoSeries = (first, second) => [
  { key: first[0], label: first[1], className: "seg-primary" },
  { key: second[0], label: second[1], className: "seg-secondary" }
];

const detailRenderers = {
  revenue(month, data) {
    const { revenue } = month;
    const name = monthName(month.month);
    return [
      facts([
        ["Booked", formatMoney(revenue.total)],
        ["Completed", formatMoney(revenue.completed)],
        ["Still to fill", formatMoney(revenue.toFill)],
        ["Preorders", `${formatMoney(revenue.preorders)} from ${plural(revenue.preorderCount, "preorder")}`]
      ]),
      block("Booked value by month", "Catering orders by event date, preorders by pickup date",
        columnChart({
          description: `Booked value for the six months ending ${monthLabel(month.month)}`,
          series: twoSeries(["catering", "Catering orders"], ["preorders", "Preorders"]),
          points: month.trend.map((point) => ({
            label: formatDate(`${point.month}-01`, { month: "short" }),
            values: { catering: point.catering.cents, preorders: point.preorders.cents },
            total: point.total.cents,
            totalLabel: formatCompactMoney(point.total.cents),
            current: point.month === month.month,
            title: `${monthLabel(point.month)}: ${formatMoney(point.catering)} catering, ${formatMoney(point.preorders)} preorders`
          }))
        })),
      block(`Booked orders in ${name}`, plural(revenue.orders.length, "order"),
        listPanel(
          revenue.orders.map((order) => bookedOrderRow(order, data.today, { showNote: false })),
          `No accepted or completed orders in ${name}.`
        ))
    ];
  },

  orders(month, data) {
    const { ordersToFill } = month;
    const name = monthName(month.month);
    return [
      facts([
        ["To fill", plural(ordersToFill.count, "order")],
        ["Guests", ordersToFill.guestCount.toLocaleString("en-US")],
        ["Next event", ordersToFill.nextEventDate ? formatEventDate(ordersToFill.nextEventDate, data.today) : "None"],
        ["Already filled", plural(ordersToFill.filled.length, "order")]
      ]),
      block("Guests by day", name,
        columnChart({
          description: `Guests per day in ${monthLabel(month.month)}`,
          series: twoSeries(["toFill", "To fill"], ["filled", "Filled"]),
          points: ordersToFill.days.map((day) => ({
            label: formatDate(day.date, { day: "numeric" }),
            values: { toFill: day.toFill, filled: day.filled },
            total: day.toFill + day.filled,
            current: day.date === data.today,
            title: `${formatEventDate(day.date, data.today)}: ${plural(day.toFill, "guest")} to fill, ${day.filled} filled`
          })),
          showTotals: false,
          labelEvery: 7,
          dense: true
        })),
      columns(
        block("To fill", plural(ordersToFill.orders.length, "order"),
          listPanel(
            ordersToFill.orders.map((order) => bookedOrderRow(order, data.today, { showNote: true })),
            `No accepted orders waiting to be filled in ${name}.`
          )),
        block("Filled", plural(ordersToFill.filled.length, "order"),
          listPanel(
            ordersToFill.filled.map((order) => bookedOrderRow(order, data.today, { showNote: false })),
            `No completed orders in ${name} yet.`
          ))
      )
    ];
  },

  awaiting(month, data) {
    const { awaiting } = month;
    const name = monthName(month.month);
    const waits = [...awaiting.requests, ...awaiting.preorders]
      .map((order) => daysWaiting(order.requestedOn, data.today));
    const count = (test) => waits.filter(test).length;
    return [
      facts([
        ["Awaiting reply", awaiting.count.toLocaleString("en-US")],
        ["Catering requests", awaiting.requests.length.toLocaleString("en-US")],
        ["Preorders", awaiting.preorders.length.toLocaleString("en-US")],
        ["Longest wait", waits.length > 0 ? plural(Math.max(...waits), "day") : "None"]
      ]),
      block("How long they've waited", `Requests for ${name} events`,
        barRows([
          { label: "Under 3 days", value: count((days) => days < 3) },
          { label: "3 to 6 days", value: count((days) => days >= 3 && days < 7) },
          { label: "1 to 2 weeks", value: count((days) => days >= 7 && days < 14) },
          { label: "Over 2 weeks", value: count((days) => days >= 14) }
        ])),
      columns(
        block("Catering requests", plural(awaiting.requests.length, "request"),
          listPanel(
            awaiting.requests.map((order) => requestRow(order, data.today)),
            `No catering requests waiting for ${name} events.`
          )),
        block("Preorders", plural(awaiting.preorders.length, "preorder"),
          listPanel(
            awaiting.preorders.map((order) => preorderRow(order, data.today)),
            `No preorders waiting for ${name}.`
          ))
      )
    ];
  },

  customers(month) {
    const { customers } = month;
    const name = monthName(month.month);
    const bookedValue = customers.customers.reduce((total, customer) => total + customer.total.cents, 0);
    return [
      facts([
        ["Customers", customers.count.toLocaleString("en-US")],
        ["New", customers.newCount.toLocaleString("en-US")],
        ["Returning", customers.returningCount.toLocaleString("en-US")],
        ["Booked value", formatMoney({ cents: bookedValue })]
      ]),
      block("New and returning customers", "By first booked event",
        columnChart({
          description: `New and returning customers for the six months ending ${monthLabel(month.month)}`,
          series: twoSeries(["returning", "Returning"], ["new", "New"]),
          points: month.trend.map((point) => {
            const total = point.newCustomers + point.returningCustomers;
            return {
              label: formatDate(`${point.month}-01`, { month: "short" }),
              values: { returning: point.returningCustomers, new: point.newCustomers },
              total,
              totalLabel: String(total),
              current: point.month === month.month,
              title: `${monthLabel(point.month)}: ${point.newCustomers} new, ${point.returningCustomers} returning`
            };
          })
        })),
      block(`Customers in ${name}`, "By booked value",
        listPanel(
          customers.customers.map((customer) => {
            const row = el("li", "row");
            const main = el("div", "row-main");
            const title = el("p", "row-title", customer.name);
            title.append(el("span", customer.isNew ? "status status-accepted" : "status status-completed", customer.isNew ? "New" : "Returning"));
            main.append(
              title,
              el("p", "row-sub", `${plural(customer.orderCount, "order")} in ${name} · ${plural(customer.lifetimeOrderCount, "order")} all time`)
            );
            row.append(main, el("p", "amount", formatMoney(customer.total)));
            return row;
          }),
          `No customers with booked orders in ${name}.`
        ))
    ];
  }
};

function currentView() {
  const view = window.location.hash.slice(1);
  return Object.hasOwn(detailTitles, view) ? view : null;
}

/** Shows the dashboard or one tile's detail view, matching the address. */
function renderView(data) {
  const view = currentView();
  document.documentElement.dataset.view = view ? "detail" : "home";
  byId("home-view").hidden = Boolean(view);
  byId("detail-view").hidden = !view;

  for (const tile of document.querySelectorAll(".stat")) {
    const active = tile.dataset.view === view;
    tile.classList.toggle("is-active", active);
    // The open tile links back to the dashboard, so a second click closes it.
    tile.href = active ? "#home" : `#${tile.dataset.view}`;
    if (active) tile.setAttribute("aria-current", "page");
    else tile.removeAttribute("aria-current");
  }

  if (view) {
    // The detail view takes its tile's tone and icon, so the color carries over.
    const tile = document.querySelector(`.stat[data-view="${view}"]`);
    byId("detail-view").dataset.tone = tile.dataset.tone;
    byId("detail-title").replaceChildren(
      tile.querySelector(".well").cloneNode(true),
      `${detailTitles[view]} in ${monthLabel(data.monthView.month)}`
    );
    byId("detail-body").replaceChildren(...detailRenderers[view](data.monthView, data));
    byId("detail-body").classList.toggle("is-revealing", revealCharts);
  }
  revealCharts = false;
  document.title = view
    ? `${detailTitles[view]} · ${data.caterer.businessName} · Dishpatch`
    : `${data.caterer.businessName} · Dishpatch`;
}

function render(data) {
  lastData = data;
  renderHeader(data);
  renderMonthBar(data);
  renderStats(data);
  renderUpcoming(data);
  renderRequests(data);
  renderWeekMenu(data);
  renderView(data);
}

// Motion: one transition per change, matched to what changed.

/**
 * Runs `update` inside a view transition: "open"/"close" for detail views,
 * "next"/"prev" for months. Falls back to a CSS entrance animation where view
 * transitions aren't supported, and to no motion when reduced motion is set.
 */
function withTransition(kind, update) {
  // Hidden tabs can't animate; browsers skip the transition there anyway.
  if (reducedMotion.matches || document.hidden) {
    update();
    return;
  }
  if (!document.startViewTransition) {
    update();
    playFallback(kind);
    return;
  }
  const root = document.documentElement;
  root.dataset.transition = kind;
  const transition = document.startViewTransition(update);
  transition.updateCallbackDone.catch(() => showNotice(errorMessages.RENDER_FAILED));
  // A skipped animation (e.g. the tab was hidden) still applies the update.
  transition.ready.catch(() => {});
  transition.finished.catch(() => {}).finally(() => {
    delete root.dataset.transition;
  });
}

function playFallback(kind) {
  const targets = kind === "next" || kind === "prev"
    ? [document.querySelector(".stats"), currentView() ? byId("detail-view") : null]
    : [currentView() ? byId("detail-view") : byId("home-view")];
  for (const target of targets) {
    if (!target) continue;
    target.classList.remove("enter-open", "enter-close", "enter-next", "enter-prev");
    void target.offsetWidth; // Restart the animation.
    target.classList.add(`enter-${kind}`);
    target.addEventListener("animationend", () => target.classList.remove(`enter-${kind}`), { once: true });
  }
}

// Data loading

function showNotice({ title, body }) {
  byId("skeleton").hidden = true;
  byId("notice-title").textContent = title;
  byId("notice-body").textContent = body;
  byId("notice").hidden = false;
}

function hideNotice() {
  byId("notice").hidden = true;
}

/** Loads the dashboard for the selected month; only the newest request is shown. */
async function loadDashboard(transition) {
  const requestId = ++latestRequest;
  inFlight += 1;
  const refreshButton = byId("refresh-button");
  refreshButton.disabled = true;
  byId("dashboard").classList.add("is-refreshing");

  try {
    const query = new URLSearchParams({ actorUserId });
    if (today) query.set("today", today);
    if (selectedMonth) query.set("month", selectedMonth);
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
    if (requestId !== latestRequest) return;

    if (!response.ok) {
      showNotice(errorMessages[body.error] ?? errorMessages.INTERNAL_ERROR);
      return;
    }

    const apply = () => {
      render(body);
      hasRendered = true;
      hideNotice();
      byId("skeleton").hidden = true;
      for (const id of ["dashboard", "refresh-area", "footer"]) byId(id).hidden = false;
    };
    if (transition && hasRendered) withTransition(transition, apply);
    else apply();
    byId("updated-at").textContent = `Updated ${new Date().toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit"
    })}`;
  } catch {
    // The server answered with data this page can't display, e.g. a server
    // process still running older code.
    showNotice(errorMessages.RENDER_FAILED);
  } finally {
    inFlight -= 1;
    if (inFlight === 0) {
      refreshButton.disabled = false;
      byId("dashboard").classList.remove("is-refreshing");
    }
  }
}

/** Switches the tiles and detail views to another month, keeping the open view. */
function changeMonth(month) {
  if (!lastData || month === lastData.monthView.month) return;
  const direction = month > lastData.monthView.month ? "next" : "prev";
  const isCurrent = month === lastData.today.slice(0, 7);
  selectedMonth = isCurrent ? null : month;
  revealCharts = Boolean(currentView());

  const url = new URL(window.location.href);
  if (selectedMonth) url.searchParams.set("month", selectedMonth);
  else url.searchParams.delete("month");
  window.history.replaceState(null, "", url);
  loadDashboard(direction);
}

function stepMonth(offset) {
  if (!lastData) return;
  const { months, month } = lastData.monthView;
  const target = months[months.indexOf(month) + offset];
  if (target) changeMonth(target);
}

if (!catererId || !actorUserId) {
  showNotice({
    title: "Which caterer?",
    body: "Open this page with your IDs in the address, for example /?catererId=<caterer id>&actorUserId=<owner user id>. The README lists the fictional development caterers."
  });
} else {
  byId("refresh-button").addEventListener("click", () => loadDashboard());
  byId("month-prev").addEventListener("click", () => stepMonth(-1));
  byId("month-next").addEventListener("click", () => stepMonth(1));

  window.addEventListener("hashchange", () => {
    if (!lastData) return;
    revealCharts = Boolean(currentView());
    withTransition(currentView() ? "open" : "close", () => renderView(lastData));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && currentView()) window.location.hash = "home";
  });

  revealCharts = Boolean(currentView());
  loadDashboard();
  setInterval(() => {
    if (!document.hidden && inFlight === 0) loadDashboard();
  }, REFRESH_INTERVAL_MS);
  // Catch up right away when the caterer comes back to the tab.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && inFlight === 0) loadDashboard();
  });
}
