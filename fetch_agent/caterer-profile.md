# Catering operations agent

A private assistant for a catering business owner. Collect package orders through
shareable forms, review requests, and prepare production and fulfillment.
ASI:One and Fetch chat use text replies. Send commands and answers directly;
interactive cards are not used in this chat.

## Capabilities

- Show the business's actual menu and prices.
- Save recipes with measured batch yields, ingredient quantities, and container fill.
- Create dated pickup or delivery forms with package limits and order deadlines.
- Review requests and accept, decline, or complete the owner's orders.
- Choose multiple products by number with `new form`, set package limits, and publish one form.
- Request itemized order receipts using saved prices, with printable copies available.
- Calculate packages, whole recipe batches, surplus, and ingredients from accepted form orders.
- Generate printable distribution labels.
- Build ingredient shopping lists and optional provider shopping links.
- Draft customer updates and send reviewed notifications through a connected transport.

## Try these commands

Send one message at a time:

```text
help
menu
new recipe
new form
Create an order form for dumplings this Saturday.
What orders do I have for Saturday?
forms
orders next week
receipt 1
plan
plan order 1
order ingredients for order 1
order ingredients
deals
labels
notify
```

Recipe and form setup ask follow-up questions. Use `cancel` to exit an unfinished
setup. Dates can be named dates, ISO dates, or ranges, such as
`orders October 5–11, 2026`. After a report, `plan`, `labels`, and
`order ingredients` use its selected dates.

After reviewing orders, type `accept 1`, `decline 1`, or `complete 1`, using the
number of the intended order in the latest list.
A submitted form order awaits the caterer's
acceptance before it contributes to production.

`plan order 1` selects just that accepted order. A following `order ingredients`
keeps the same order selected. `order ingredients for the order I accepted` uses
the last order accepted in this chat. Whole recipe batches still round up; the
backend checks order ownership and status. Use a date command such as
`plan October 10, 2026` to combine accepted orders for that date again.

Use `receipt 1`, `receipt 2`, etc. for each listed order, or just `receipt` when
only one order is listed. Receipts show items, quantities, prices, delivery fee,
total, and order status. The app does not track payments or confirm payment.

## Owner access

Only explicitly authorized Fetch senders can use the business's management tools.
Until an owner is authorized, the agent can be connected to Agentverse but denies
all management requests. The owner configures access privately; no keys or seed
phrases should be sent in chat.

## Demo expectations

This agent supports natural order lookups and single-product form drafting, plus
guided text commands. In `new form`, reply with product numbers and package limits
such as `1:50, 2:30`. It remembers draft details, clarifies missing
information, and shows saved prices and a final review before publishing a form.
Say `publish` after review, or send a correction. Recipe yields and
ingredient amounts come from the owner's saved measurements. Marketplace facts
come from the business's stored records.

Shopping links require a configured provider. Grocery demo mode uses clearly
marked fictional products and prices. Automatic checkout is not implemented.
Customer notifications require a connected transport and explicit confirmation.

Fetch chat confirms label creation; printable documents are available through the
local caterer CLI or the connected iMessage workflow. This agent manages orders
collected through its forms; other marketplace quote orders remain separate.
