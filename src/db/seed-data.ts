import type { OrderStatus } from "../types/domain.js";

export const demoCustomerId = "11000000-0000-4000-8000-000000000006";
export const demoCatererIds = [
  "22000000-0000-4000-8000-000000000001",
  "22000000-0000-4000-8000-000000000002",
  "22000000-0000-4000-8000-000000000003",
  "22000000-0000-4000-8000-000000000004"
];

export function seedId(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export function offsetSeedDate(referenceDate: string, days: number): string {
  const date = new Date(`${referenceDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// These names and messaging identifiers are fictional, with no phone numbers or emails.
export const dashboardCustomers = [
  "Dana Cloud", "Ellis Juniper", "Quinn Hollow", "Robin Cedar",
  "Casey Lake", "Jamie Vale", "Reese Wren", "Taylor Marsh"
].map((name, index) => ({
  id: seedId("11000000", index + 7),
  messagingIdentifier: `test:customer:dashboard-${index + 1}`,
  name,
  role: "CUSTOMER" as const
}));

export interface DashboardOrderPlan {
  id: string;
  customerId: string;
  catererId: string;
  eventDate: string;
  guestCount: number;
  status: OrderStatus;
  createdAt: Date;
}

/** Stable IDs let repeat runs add missing fixtures without resetting existing orders. */
export function buildDashboardOrderPlans(referenceDate: string): DashboardOrderPlan[] {
  const statuses: OrderStatus[] = [
    "DRAFT", "REQUESTED", "ACCEPTED", "DECLINED", "CANCELLED", "COMPLETED"
  ];
  const customerIds = [demoCustomerId, ...dashboardCustomers.map((customer) => customer.id)];
  return Array.from({ length: 24 }, (_, index) => {
    const status = statuses[index % statuses.length]!;
    const eventDate = offsetSeedDate(
      referenceDate,
      status === "COMPLETED" ? -7 * (Math.floor(index / 6) + 1) : index + 2
    );
    return {
      id: seedId("44000000", index + 2),
      customerId: customerIds[index % customerIds.length]!,
      catererId: demoCatererIds[(index + Math.floor(index / 6)) % demoCatererIds.length]!,
      eventDate,
      guestCount: 20 + ((index + Math.floor(index / 4)) % 4) * 5,
      status,
      createdAt: new Date(`${
        status === "COMPLETED"
          ? offsetSeedDate(eventDate, -7)
          : offsetSeedDate(referenceDate, -30 + index)
      }T12:00:00.000Z`)
    };
  });
}
