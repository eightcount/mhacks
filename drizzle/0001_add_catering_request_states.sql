CREATE TABLE IF NOT EXISTS "catering_request_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE RESTRICT,
  "customer_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "event_date" date,
  "budget" numeric(12, 2),
  "dishes" text[] DEFAULT '{}' NOT NULL,
  "cuisines" text[] DEFAULT '{}' NOT NULL,
  "headcount" integer,
  "event_style" "event_style",
  "dietary_restrictions" text[] DEFAULT '{}' NOT NULL,
  "dietary_restrictions_confirmed" boolean DEFAULT false NOT NULL,
  "location" varchar(255),
  "fulfillment_method" "fulfillment_method",
  "recent_search_result_ids" uuid[] DEFAULT '{}' NOT NULL,
  "selected_caterer_id" uuid REFERENCES "caterers"("id") ON DELETE RESTRICT,
  "pending_order_id" uuid REFERENCES "orders"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "catering_request_states_budget_nonnegative" CHECK ("budget" IS NULL OR "budget" >= 0),
  CONSTRAINT "catering_request_states_headcount_positive" CHECK ("headcount" IS NULL OR "headcount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catering_request_states_conversation_id_unique" ON "catering_request_states" USING btree ("conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catering_request_states_customer_id_index" ON "catering_request_states" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catering_request_states_selected_caterer_id_index" ON "catering_request_states" USING btree ("selected_caterer_id");
