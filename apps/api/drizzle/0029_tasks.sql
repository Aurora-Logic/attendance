CREATE TYPE "public"."task_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TABLE "task_board_columns" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"subject_type" text,
	"subject_id" uuid,
	"subject_label" text,
	"assignee_id" uuid,
	"owner_id" uuid,
	"due_date" date,
	"priority" "task_priority" DEFAULT 'MEDIUM' NOT NULL,
	"column_id" uuid NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "task_board_columns" ADD CONSTRAINT "task_board_columns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_employees_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_id_employees_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_column_id_task_board_columns_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."task_board_columns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_board_columns_org_name_uq" ON "task_board_columns" USING btree ("org_id","name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "task_board_columns_org_sort_idx" ON "task_board_columns" USING btree ("org_id","sort_order");--> statement-breakpoint
CREATE INDEX "tasks_org_assignee_due_idx" ON "tasks" USING btree ("org_id","assignee_id","due_date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "tasks_org_owner_idx" ON "tasks" USING btree ("org_id","owner_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "tasks_org_column_idx" ON "tasks" USING btree ("org_id","column_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "tasks_org_subject_idx" ON "tasks" USING btree ("org_id","subject_type","subject_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "tasks_org_due_open_idx" ON "tasks" USING btree ("org_id","due_date") WHERE deleted_at IS NULL;