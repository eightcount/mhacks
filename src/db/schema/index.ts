import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";
import {
  eventStyles,
  fulfillmentMethods,
  messageSenders,
  orderStatuses,
  userRoles
} from "../../types/domain.js";
import type { ProductSpec } from "../../validation/caterer-operations.js";
import type { FormProduct, PreorderItem } from "../../types/caterer-operations.js";

export const userRoleEnum = pgEnum("user_role", userRoles);
export const orderStatusEnum = pgEnum("order_status", orderStatuses);
export const messageSenderEnum = pgEnum("message_sender", messageSenders);
export const eventStyleEnum = pgEnum("event_style", eventStyles);
export const fulfillmentMethodEnum = pgEnum("fulfillment_method", fulfillmentMethods);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull()
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messagingIdentifier: varchar("messaging_identifier", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    role: userRoleEnum("role").notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex("users_messaging_identifier_unique").on(table.messagingIdentifier)
  ]
);

export const caterers = pgTable(
  "caterers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    businessName: varchar("business_name", { length: 255 }).notNull(),
    description: text("description").notNull(),
    cuisineTypes: text("cuisine_types").array().notNull(),
    location: varchar("location", { length: 255 }).notNull(),
    serviceAreas: text("service_areas").array().default([]).notNull(),
    serviceRadius: integer("service_radius").notNull(),
    minimumOrder: numeric("minimum_order", { precision: 12, scale: 2 }).notNull(),
    maximumCapacity: integer("maximum_capacity").notNull(),
    supportedEventStyles: eventStyleEnum("supported_event_styles")
      .array()
      .default(["CASUAL"])
      .notNull(),
    fulfillmentMethod: fulfillmentMethodEnum("fulfillment_method")
      .default("PICKUP")
      .notNull(),
    deliveryRadius: integer("delivery_radius"),
    deliveryFee: numeric("delivery_fee", { precision: 12, scale: 2 }),
    minimumDeliveryOrder: numeric("minimum_delivery_order", { precision: 12, scale: 2 }),
    active: boolean("active").default(true).notNull(),
    ...timestamps
  },
  (table) => [
    index("caterers_location_index").on(table.location),
    index("caterers_active_index").on(table.active),
    index("caterers_fulfillment_method_index").on(table.fulfillmentMethod),
    index("caterers_owner_user_id_index").on(table.ownerUserId),
    check("caterers_service_radius_nonnegative", sql`${table.serviceRadius} >= 0`),
    check("caterers_minimum_order_nonnegative", sql`${table.minimumOrder} >= 0`),
    check("caterers_maximum_capacity_positive", sql`${table.maximumCapacity} > 0`),
    check(
      "caterers_delivery_radius_nonnegative",
      sql`${table.deliveryRadius} is null or ${table.deliveryRadius} >= 0`
    ),
    check(
      "caterers_delivery_fee_nonnegative",
      sql`${table.deliveryFee} is null or ${table.deliveryFee} >= 0`
    ),
    check(
      "caterers_minimum_delivery_order_nonnegative",
      sql`${table.minimumDeliveryOrder} is null or ${table.minimumDeliveryOrder} >= 0`
    )
  ]
);

export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    catererId: uuid("caterer_id")
      .notNull()
      .references(() => caterers.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    dietaryTags: text("dietary_tags").array().default([]).notNull(),
    active: boolean("active").default(true).notNull(),
    ...timestamps
  },
  (table) => [
    index("menu_items_caterer_id_index").on(table.catererId),
    index("menu_items_active_index").on(table.active),
    check("menu_items_price_nonnegative", sql`${table.price} >= 0`)
  ]
);

export const availability = pgTable(
  "availability",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    catererId: uuid("caterer_id")
      .notNull()
      .references(() => caterers.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" }).notNull(),
    available: boolean("available").default(true).notNull(),
    capacityOverride: integer("capacity_override"),
    ...timestamps
  },
  (table) => [
    uniqueIndex("availability_caterer_date_unique").on(table.catererId, table.date),
    index("availability_date_index").on(table.date),
    check(
      "availability_capacity_override_positive",
      sql`${table.capacityOverride} is null or ${table.capacityOverride} > 0`
    )
  ]
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    catererId: uuid("caterer_id")
      .notNull()
      .references(() => caterers.id, { onDelete: "restrict" }),
    eventDate: date("event_date", { mode: "string" }).notNull(),
    guestCount: integer("guest_count").notNull(),
    budget: numeric("budget", { precision: 12, scale: 2 }).notNull(),
    estimatedTotal: numeric("estimated_total", { precision: 12, scale: 2 }).notNull(),
    requestedDishes: text("requested_dishes").array().default([]).notNull(),
    requestedCuisines: text("requested_cuisines").array().default([]).notNull(),
    eventStyle: eventStyleEnum("event_style").default("CASUAL").notNull(),
    dietaryRestrictions: text("dietary_restrictions").array().default([]).notNull(),
    eventLocation: varchar("event_location", { length: 255 }).notNull(),
    fulfillmentMethod: fulfillmentMethodEnum("fulfillment_method")
      .default("PICKUP")
      .notNull(),
    status: orderStatusEnum("status").default("DRAFT").notNull(),
    specialRequests: text("special_requests"),
    ...timestamps
  },
  (table) => [
    index("orders_customer_id_index").on(table.customerId),
    index("orders_caterer_id_index").on(table.catererId),
    index("orders_event_date_index").on(table.eventDate),
    index("orders_status_index").on(table.status),
    index("orders_event_location_index").on(table.eventLocation),
    check("orders_guest_count_positive", sql`${table.guestCount} > 0`),
    check("orders_budget_nonnegative", sql`${table.budget} >= 0`),
    check("orders_estimated_total_nonnegative", sql`${table.estimatedTotal} >= 0`)
  ]
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    menuItemId: uuid("menu_item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [
    uniqueIndex("order_items_order_menu_item_unique").on(table.orderId, table.menuItemId),
    index("order_items_order_id_index").on(table.orderId),
    check("order_items_quantity_positive", sql`${table.quantity} > 0`),
    check("order_items_unit_price_nonnegative", sql`${table.unitPrice} >= 0`)
  ]
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    externalConversationId: varchar("external_conversation_id", { length: 255 }).notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex("conversations_external_conversation_id_unique").on(
      table.externalConversationId
    ),
    index("conversations_user_id_index").on(table.userId)
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "restrict" }),
    sender: messageSenderEnum("sender").notNull(),
    content: text("content").notNull(),
    externalMessageId: varchar("external_message_id", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [
    uniqueIndex("messages_external_message_id_unique").on(table.externalMessageId),
    index("messages_conversation_id_index").on(table.conversationId)
  ]
);

/**
 * Structured, partial request state for the conversational agent. Keeping the
 * fields explicit makes state queryable and avoids treating LLM history as a
 * source of truth.
 */
export const cateringRequestStates = pgTable(
  "catering_request_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    eventDate: date("event_date", { mode: "string" }),
    budget: numeric("budget", { precision: 12, scale: 2 }),
    dishes: text("dishes").array().default([]).notNull(),
    cuisines: text("cuisines").array().default([]).notNull(),
    headcount: integer("headcount"),
    eventStyle: eventStyleEnum("event_style"),
    dietaryRestrictions: text("dietary_restrictions").array().default([]).notNull(),
    dietaryRestrictionsConfirmed: boolean("dietary_restrictions_confirmed")
      .default(false)
      .notNull(),
    location: varchar("location", { length: 255 }),
    fulfillmentMethod: fulfillmentMethodEnum("fulfillment_method"),
    recentSearchResultIds: uuid("recent_search_result_ids").array().default([]).notNull(),
    selectedCatererId: uuid("selected_caterer_id").references(() => caterers.id, {
      onDelete: "restrict"
    }),
    pendingOrderId: uuid("pending_order_id").references(() => orders.id, {
      onDelete: "restrict"
    }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("catering_request_states_conversation_id_unique").on(table.conversationId),
    index("catering_request_states_customer_id_index").on(table.customerId),
    index("catering_request_states_selected_caterer_id_index").on(table.selectedCatererId),
    check(
      "catering_request_states_budget_nonnegative",
      sql`${table.budget} is null or ${table.budget} >= 0`
    ),
    check(
      "catering_request_states_headcount_positive",
      sql`${table.headcount} is null or ${table.headcount} > 0`
    )
  ]
);

// Product definitions are immutable revisions so fulfilled orders retain the
// recipe/container definition used when their order form was published.
export const catererProductSpecs = pgTable("caterer_product_specs", {
  id: uuid("id").defaultRandom().primaryKey(),
  catererId: uuid("caterer_id").notNull().references(() => caterers.id, {onDelete: "restrict"}),
  menuItemId: uuid("menu_item_id").notNull().references(() => menuItems.id, {onDelete: "restrict"}),
  productName: text("product_name").notNull(),
  spec: jsonb("spec").$type<ProductSpec>().notNull(),
  createdAt: timestamp("created_at", {withTimezone: true}).defaultNow().notNull()
}, table => [index("product_specs_caterer_menu_index").on(table.catererId, table.menuItemId)]);

export const catererOrderForms = pgTable("caterer_order_forms", {
  id: uuid("id").defaultRandom().primaryKey(),
  catererId: uuid("caterer_id").notNull().references(() => caterers.id, {onDelete: "restrict"}),
  title: text("title").notNull(),
  fulfillmentDate: date("fulfillment_date").notNull(),
  closesAt: timestamp("closes_at", {withTimezone: true}).notNull(),
  fulfillmentMethod: fulfillmentMethodEnum("fulfillment_method").notNull(),
  fulfillmentInstructions: text("fulfillment_instructions").notNull(),
  minimumOrder: numeric("minimum_order", {precision: 12, scale: 2}).notNull(),
  deliveryFee: numeric("delivery_fee", {precision: 12, scale: 2}).notNull(),
  products: jsonb("products").$type<FormProduct[]>().notNull(),
  active: boolean("active").default(true).notNull(),
  ...timestamps
}, table => [index("order_forms_caterer_date_index").on(table.catererId, table.fulfillmentDate),
  check("order_forms_minimum_nonnegative", sql`${table.minimumOrder} >= 0`),
  check("order_forms_delivery_fee_nonnegative", sql`${table.deliveryFee} >= 0`)]);

export const catererPreorders = pgTable("caterer_preorders", {
  id: uuid("id").defaultRandom().primaryKey(),
  formId: uuid("form_id").notNull().references(() => catererOrderForms.id, {onDelete: "restrict"}),
  catererId: uuid("caterer_id").notNull().references(() => caterers.id, {onDelete: "restrict"}),
  submissionId: uuid("submission_id").notNull(),
  customerName: text("customer_name").notNull(),
  customerContact: text("customer_contact").notNull(),
  deliveryAddress: text("delivery_address").notNull(),
  fulfillmentDate: date("fulfillment_date").notNull(),
  items: jsonb("items").$type<PreorderItem[]>().notNull(),
  total: numeric("total", {precision: 12, scale: 2}).notNull(),
  status: orderStatusEnum("status").default("REQUESTED").notNull(),
  ...timestamps
}, table => [uniqueIndex("preorders_form_submission_unique").on(table.formId, table.submissionId),
  index("preorders_caterer_date_status_index").on(table.catererId, table.fulfillmentDate, table.status),
  check("preorders_total_nonnegative", sql`${table.total} >= 0`)]);

export const catererNotificationDrafts = pgTable("caterer_notification_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  catererId: uuid("caterer_id").notNull().references(() => caterers.id, {onDelete: "restrict"}),
  orderId: uuid("order_id").notNull().references(() => catererPreorders.id, {onDelete: "restrict"}),
  recipient: text("recipient").notNull(),
  body: text("body").notNull(),
  status: text("status").default("DRAFT").notNull(),
  ...timestamps
}, table => [index("notification_drafts_caterer_index").on(table.catererId),
  check("notification_drafts_status_valid", sql`${table.status} in ('DRAFT', 'SENDING', 'SENT', 'FAILED')`)]);

export const catererAgentSessions = pgTable("caterer_agent_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  catererId: uuid("caterer_id").notNull().references(() => caterers.id, {onDelete: "restrict"}),
  sessionId: varchar("session_id", {length: 200}).notNull(),
  draft: jsonb("draft").$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps
}, table => [uniqueIndex("caterer_agent_sessions_caterer_session_unique").on(table.catererId, table.sessionId)]);
