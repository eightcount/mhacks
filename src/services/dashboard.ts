import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { availability, menuItems, orderItems, orders, users } from "../db/schema/index.js";
import {
  getCatererDashboardSchema,
  type GetCatererDashboardInput
} from "../validation/index.js";
import { assertCatererOwner, getMenu } from "./caterers.js";
import {
  availabilityPeriod,
  summarizeCatererDashboard,
  type CatererDashboard,
  type DashboardOrderRecord
} from "./dashboard-summary.js";

function localIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

async function loadOrderDetails(orderIds: string[], customerIds: string[]) {
  if (orderIds.length === 0) {
    return { itemRows: [], customerRows: [] };
  }

  const [itemRows, customerRows] = await Promise.all([
    db
      .select({ item: orderItems, menuItem: { name: menuItems.name } })
      .from(orderItems)
      .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(inArray(orderItems.orderId, orderIds)),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, customerIds))
  ]);
  return { itemRows, customerRows };
}

/**
 * Read-only dashboard for a caterer owner, built from the caterer's stored
 * orders, menu, and availability. Draft orders are excluded because they have
 * not been sent to the caterer yet.
 */
export async function getCatererDashboard(
  input: GetCatererDashboardInput
): Promise<CatererDashboard> {
  const parsed = getCatererDashboardSchema.parse(input);
  const caterer = await assertCatererOwner(parsed.catererId, parsed.actorUserId);
  const today = parsed.today ?? localIsoDate(new Date());
  const window = availabilityPeriod(today);

  const [[owner], catererOrders, menu, availabilityEntries] = await Promise.all([
    db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, caterer.ownerUserId))
      .limit(1),
    db
      .select()
      .from(orders)
      .where(and(eq(orders.catererId, caterer.id), ne(orders.status, "DRAFT"))),
    getMenu(caterer.id, { includeInactive: true }),
    db
      .select()
      .from(availability)
      .where(
        and(
          eq(availability.catererId, caterer.id),
          gte(availability.date, window.start),
          lte(availability.date, window.end)
        )
      )
  ]);

  const { itemRows, customerRows } = await loadOrderDetails(
    catererOrders.map((order) => order.id),
    [...new Set(catererOrders.map((order) => order.customerId))]
  );
  const customerNames = new Map(customerRows.map((customer) => [customer.id, customer.name]));
  const itemsByOrderId = new Map<string, DashboardOrderRecord["items"][number][]>();
  for (const row of itemRows) {
    const items = itemsByOrderId.get(row.item.orderId) ?? [];
    items.push(row);
    itemsByOrderId.set(row.item.orderId, items);
  }

  const records: DashboardOrderRecord[] = catererOrders.map((order) => ({
    order,
    customerName: customerNames.get(order.customerId) ?? "Unknown customer",
    items: itemsByOrderId.get(order.id) ?? []
  }));

  return summarizeCatererDashboard({
    caterer,
    ownerName: owner?.name ?? "",
    orders: records,
    menu,
    availability: availabilityEntries,
    today
  });
}
