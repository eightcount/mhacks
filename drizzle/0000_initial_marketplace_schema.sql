DO $$ BEGIN
  CREATE TYPE "user_role" AS ENUM ('CUSTOMER', 'CATERER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "order_status" AS ENUM ('DRAFT', 'REQUESTED', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "message_sender" AS ENUM ('CUSTOMER', 'CATERER', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "event_style" AS ENUM ('BUFFET', 'FAMILY_STYLE', 'INDIVIDUAL_MEALS', 'DROP_OFF', 'FORMAL', 'CASUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "fulfillment_method" AS ENUM ('PICKUP', 'DELIVERY', 'EITHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "messaging_identifier" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "role" "user_role" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "caterers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "business_name" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "cuisine_types" text[] NOT NULL,
  "location" varchar(255) NOT NULL,
  "service_areas" text[] DEFAULT '{}' NOT NULL,
  "service_radius" integer NOT NULL,
  "minimum_order" numeric(12, 2) NOT NULL,
  "maximum_capacity" integer NOT NULL,
  "supported_event_styles" "event_style"[] DEFAULT ARRAY['CASUAL']::"event_style"[] NOT NULL,
  "fulfillment_method" "fulfillment_method" DEFAULT 'PICKUP' NOT NULL,
  "delivery_radius" integer,
  "delivery_fee" numeric(12, 2),
  "minimum_delivery_order" numeric(12, 2),
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "caterers_service_radius_nonnegative" CHECK ("service_radius" >= 0),
  CONSTRAINT "caterers_minimum_order_nonnegative" CHECK ("minimum_order" >= 0),
  CONSTRAINT "caterers_maximum_capacity_positive" CHECK ("maximum_capacity" > 0),
  CONSTRAINT "caterers_delivery_radius_nonnegative" CHECK ("delivery_radius" IS NULL OR "delivery_radius" >= 0),
  CONSTRAINT "caterers_delivery_fee_nonnegative" CHECK ("delivery_fee" IS NULL OR "delivery_fee" >= 0),
  CONSTRAINT "caterers_minimum_delivery_order_nonnegative" CHECK ("minimum_delivery_order" IS NULL OR "minimum_delivery_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "menu_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "caterer_id" uuid NOT NULL REFERENCES "caterers"("id") ON DELETE RESTRICT,
  "name" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "price" numeric(12, 2) NOT NULL,
  "dietary_tags" text[] DEFAULT '{}' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "menu_items_price_nonnegative" CHECK ("price" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "availability" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "caterer_id" uuid NOT NULL REFERENCES "caterers"("id") ON DELETE RESTRICT,
  "date" date NOT NULL,
  "available" boolean DEFAULT true NOT NULL,
  "capacity_override" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "availability_capacity_override_positive" CHECK ("capacity_override" IS NULL OR "capacity_override" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "caterer_id" uuid NOT NULL REFERENCES "caterers"("id") ON DELETE RESTRICT,
  "event_date" date NOT NULL,
  "guest_count" integer NOT NULL,
  "budget" numeric(12, 2) NOT NULL,
  "estimated_total" numeric(12, 2) NOT NULL,
  "requested_dishes" text[] DEFAULT '{}' NOT NULL,
  "requested_cuisines" text[] DEFAULT '{}' NOT NULL,
  "event_style" "event_style" DEFAULT 'CASUAL' NOT NULL,
  "dietary_restrictions" text[] DEFAULT '{}' NOT NULL,
  "event_location" varchar(255) NOT NULL,
  "fulfillment_method" "fulfillment_method" DEFAULT 'PICKUP' NOT NULL,
  "status" "order_status" DEFAULT 'DRAFT' NOT NULL,
  "special_requests" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "orders_guest_count_positive" CHECK ("guest_count" > 0),
  CONSTRAINT "orders_budget_nonnegative" CHECK ("budget" >= 0),
  CONSTRAINT "orders_estimated_total_nonnegative" CHECK ("estimated_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "menu_item_id" uuid NOT NULL REFERENCES "menu_items"("id") ON DELETE RESTRICT,
  "quantity" integer NOT NULL,
  "unit_price" numeric(12, 2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "order_items_unit_price_nonnegative" CHECK ("unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "external_conversation_id" varchar(255) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE RESTRICT,
  "sender" "message_sender" NOT NULL,
  "content" text NOT NULL,
  "external_message_id" varchar(255) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_messaging_identifier_unique" ON "users" USING btree ("messaging_identifier");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caterers_location_index" ON "caterers" USING btree ("location");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caterers_active_index" ON "caterers" USING btree ("active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caterers_fulfillment_method_index" ON "caterers" USING btree ("fulfillment_method");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caterers_owner_user_id_index" ON "caterers" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "menu_items_caterer_id_index" ON "menu_items" USING btree ("caterer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "menu_items_active_index" ON "menu_items" USING btree ("active");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "availability_caterer_date_unique" ON "availability" USING btree ("caterer_id", "date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "availability_date_index" ON "availability" USING btree ("date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_customer_id_index" ON "orders" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_caterer_id_index" ON "orders" USING btree ("caterer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_event_date_index" ON "orders" USING btree ("event_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_status_index" ON "orders" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_event_location_index" ON "orders" USING btree ("event_location");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_items_order_menu_item_unique" ON "order_items" USING btree ("order_id", "menu_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_order_id_index" ON "order_items" USING btree ("order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_external_conversation_id_unique" ON "conversations" USING btree ("external_conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_user_id_index" ON "conversations" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messages_external_message_id_unique" ON "messages" USING btree ("external_message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_conversation_id_index" ON "messages" USING btree ("conversation_id");
