import { and, count, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { caterers, menuItems, orders, users } from "../db/schema/index.js";
import { orderStatuses, type OrderStatus } from "../types/domain.js";

/** Call from an authenticated server route; this service exposes no database credentials. */
export async function getMarketplaceSummary() {
  const [customers, allCaterers, activeCaterers, allMenus, activeMenus, statusCounts, completedValue] = await Promise.all([
    db.select({ count: count() }).from(users).where(eq(users.role, "CUSTOMER")),
    db.select({ count: count() }).from(caterers),
    db.select({ count: count() }).from(caterers).where(eq(caterers.active, true)),
    db.select({ count: count() }).from(menuItems),
    db.select({ count: count() }).from(menuItems)
      .innerJoin(caterers, eq(menuItems.catererId, caterers.id))
      .where(and(eq(menuItems.active, true), eq(caterers.active, true))),
    db.select({ status: orders.status, count: count() }).from(orders).groupBy(orders.status),
    db.select({ amount: sql<string>`coalesce(sum(${orders.estimatedTotal}), 0)::text` })
      .from(orders).where(eq(orders.status, "COMPLETED"))
  ]);
  const ordersByStatus = Object.fromEntries(
    orderStatuses.map((status) => [status, 0])
  ) as Record<OrderStatus, number>;
  for (const row of statusCounts) ordersByStatus[row.status] = row.count;
  return {
    customerCount: customers[0]!.count,
    catererCount: allCaterers[0]!.count,
    activeCatererCount: activeCaterers[0]!.count,
    menuItemCount: allMenus[0]!.count,
    activeMenuItemCount: activeMenus[0]!.count,
    orderCount: statusCounts.reduce((total, row) => total + row.count, 0),
    ordersByStatus,
    completedOrderValue: completedValue[0]!.amount,
    generatedAt: new Date().toISOString()
  };
}
