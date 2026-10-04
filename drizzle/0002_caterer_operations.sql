CREATE TABLE "caterer_agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caterer_id" uuid NOT NULL,
	"session_id" varchar(200) NOT NULL,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "caterer_notification_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caterer_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"recipient" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_drafts_status_valid" CHECK ("caterer_notification_drafts"."status" in ('DRAFT', 'SENDING', 'SENT', 'FAILED'))
);

--> statement-breakpoint
CREATE TABLE "caterer_order_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caterer_id" uuid NOT NULL,
	"title" text NOT NULL,
	"fulfillment_date" date NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"fulfillment_method" "fulfillment_method" NOT NULL,
	"fulfillment_instructions" text NOT NULL,
	"minimum_order" numeric(12, 2) NOT NULL,
	"delivery_fee" numeric(12, 2) NOT NULL,
	"products" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_forms_minimum_nonnegative" CHECK ("caterer_order_forms"."minimum_order" >= 0),
	CONSTRAINT "order_forms_delivery_fee_nonnegative" CHECK ("caterer_order_forms"."delivery_fee" >= 0)
);

--> statement-breakpoint
CREATE TABLE "caterer_preorders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"caterer_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"customer_name" text NOT NULL,
	"customer_contact" text NOT NULL,
	"delivery_address" text NOT NULL,
	"fulfillment_date" date NOT NULL,
	"items" jsonb NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"status" "order_status" DEFAULT 'REQUESTED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preorders_total_nonnegative" CHECK ("caterer_preorders"."total" >= 0)
);

--> statement-breakpoint
CREATE TABLE "caterer_product_specs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caterer_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"spec" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "caterer_agent_sessions" ADD CONSTRAINT "caterer_agent_sessions_caterer_id_caterers_id_fk" FOREIGN KEY ("caterer_id") REFERENCES "public"."caterers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "caterer_notification_drafts" ADD CONSTRAINT "caterer_notification_drafts_caterer_id_caterers_id_fk" FOREIGN KEY ("caterer_id") REFERENCES "public"."caterers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "caterer_notification_drafts" ADD CONSTRAINT "caterer_notification_drafts_order_id_caterer_preorders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."caterer_preorders"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "caterer_order_forms" ADD CONSTRAINT "caterer_order_forms_caterer_id_caterers_id_fk" FOREIGN KEY ("caterer_id") REFERENCES "public"."caterers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "caterer_preorders" ADD CONSTRAINT "caterer_preorders_form_id_caterer_order_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."caterer_order_forms"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "caterer_preorders" ADD CONSTRAINT "caterer_preorders_caterer_id_caterers_id_fk" FOREIGN KEY ("caterer_id") REFERENCES "public"."caterers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "caterer_product_specs" ADD CONSTRAINT "caterer_product_specs_caterer_id_caterers_id_fk" FOREIGN KEY ("caterer_id") REFERENCES "public"."caterers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "caterer_product_specs" ADD CONSTRAINT "caterer_product_specs_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "caterer_agent_sessions_caterer_session_unique" ON "caterer_agent_sessions" USING btree ("caterer_id","session_id");
--> statement-breakpoint
CREATE INDEX "notification_drafts_caterer_index" ON "caterer_notification_drafts" USING btree ("caterer_id");
--> statement-breakpoint
CREATE INDEX "order_forms_caterer_date_index" ON "caterer_order_forms" USING btree ("caterer_id","fulfillment_date");
--> statement-breakpoint
CREATE UNIQUE INDEX "preorders_form_submission_unique" ON "caterer_preorders" USING btree ("form_id","submission_id");
--> statement-breakpoint
CREATE INDEX "preorders_caterer_date_status_index" ON "caterer_preorders" USING btree ("caterer_id","fulfillment_date","status");
--> statement-breakpoint
CREATE INDEX "product_specs_caterer_menu_index" ON "caterer_product_specs" USING btree ("caterer_id","menu_item_id");
