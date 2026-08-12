-- Phase 1: the attendance module's tables (technical design section 4.2), every index
-- listed in section 4.3, and the three guarantees that only the database can make --
-- no overlapping roster assignments, no mutable punch, no mutable leave ledger.
--
-- The generated portion runs first; everything after the "hand-written" banner
-- near the end is written by hand because Drizzle cannot express it.
--
-- Reverse with: DROP TABLE for each table created here, in reverse dependency
-- order, then DROP TYPE for each enum, then the four ALTER TABLE ... DROP
-- CONSTRAINT statements listed at the foot of this file. Nothing here is
-- destructive to existing data: every statement is CREATE or ADD.

CREATE TYPE "public"."approval_action" AS ENUM('APPROVE', 'REJECT', 'DELEGATE', 'ESCALATE');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ESCALATED');--> statement-breakpoint
CREATE TYPE "public"."approval_type" AS ENUM('LEAVE', 'REGULARIZATION', 'ON_DUTY', 'FLAGGED_PUNCH', 'DEVICE_REBIND');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('HOLIDAY', 'WEEKLY_OFF', 'ON_LEAVE', 'PRESENT', 'HALF_DAY', 'ON_DUTY', 'PENDING', 'ABSENT');--> statement-breakpoint
CREATE TYPE "public"."leave_accrual_method" AS ENUM('NONE', 'MONTHLY', 'YEARLY', 'ON_JOINING');--> statement-breakpoint
CREATE TYPE "public"."leave_day_portion" AS ENUM('FULL', 'FIRST_HALF', 'SECOND_HALF');--> statement-breakpoint
CREATE TYPE "public"."leave_movement_type" AS ENUM('OPENING', 'ACCRUAL', 'AVAILED', 'ADJUSTMENT', 'CARRY_FORWARD', 'ENCASHMENT', 'LAPSE', 'REVERSAL');--> statement-breakpoint
CREATE TYPE "public"."half_day_part" AS ENUM('FIRST_HALF', 'SECOND_HALF');--> statement-breakpoint
CREATE TYPE "public"."punch_source" AS ENUM('WEB', 'MOBILE', 'OFFLINE_SYNC');--> statement-breakpoint
CREATE TYPE "public"."punch_type" AS ENUM('IN', 'OUT');--> statement-breakpoint
CREATE TYPE "public"."regularization_kind" AS ENUM('MISSING_IN', 'MISSING_OUT', 'WRONG_TIME', 'FORGOT_TO_PUNCH');--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"type" "approval_type" NOT NULL,
	"requester_user_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "approval_steps" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"step_no" integer NOT NULL,
	"approver_user_id" uuid NOT NULL,
	"delegated_from_user_id" uuid,
	"action" "approval_action",
	"reason" text,
	"acted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attendance_days" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"shift_id" uuid,
	"scheduled_in" timestamp with time zone,
	"scheduled_out" timestamp with time zone,
	"first_in_punch_id" uuid,
	"last_out_punch_id" uuid,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"ot_minutes" integer DEFAULT 0 NOT NULL,
	"status" "attendance_status" NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"early_exit_minutes" integer DEFAULT 0 NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"leave_request_id" uuid,
	"is_manual_override" boolean DEFAULT false NOT NULL,
	"override_reason" text,
	"override_by" uuid,
	"override_at" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "attendance_days_worked_minutes_non_negative" CHECK (worked_minutes >= 0),
	CONSTRAINT "attendance_days_override_has_reason" CHECK (is_manual_override = false OR override_reason IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "attendance_period_locks" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"locked_by" uuid,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unlocked_by" uuid,
	"unlocked_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "attendance_period_locks_month_valid" CHECK (month BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE TABLE "holiday_calendars" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"year" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"is_restricted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "restricted_holiday_elections" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"holiday_id" uuid NOT NULL,
	"leave_year" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comp_off_credits" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"earned_for_date" date NOT NULL,
	"days" numeric(6, 2) NOT NULL,
	"expires_on" date NOT NULL,
	"consumed_by_leave_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "leave_balances" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"leave_year" integer NOT NULL,
	"opening" numeric(6, 2) DEFAULT 0 NOT NULL,
	"accrued" numeric(6, 2) DEFAULT 0 NOT NULL,
	"availed" numeric(6, 2) DEFAULT 0 NOT NULL,
	"adjusted" numeric(6, 2) DEFAULT 0 NOT NULL,
	"carried_forward" numeric(6, 2) DEFAULT 0 NOT NULL,
	"closing" numeric(6, 2) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "leave_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"leave_year" integer NOT NULL,
	"movement_type" "leave_movement_type" NOT NULL,
	"days" numeric(6, 2) NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "leave_request_days" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"leave_request_id" uuid NOT NULL,
	"date" date NOT NULL,
	"portion" "leave_day_portion" DEFAULT 'FULL' NOT NULL,
	"is_counted" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"total_days" numeric(6, 2) NOT NULL,
	"reason" text,
	"attachment_file_id" uuid,
	"approval_request_id" uuid,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "leave_requests_range_ordered" CHECK (to_date >= from_date)
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"accrual_method" "leave_accrual_method" DEFAULT 'NONE' NOT NULL,
	"annual_entitlement" numeric(6, 2) DEFAULT 0 NOT NULL,
	"carry_forward_allowed" boolean DEFAULT false NOT NULL,
	"carry_forward_cap" numeric(6, 2),
	"negative_balance_limit" numeric(6, 2) DEFAULT 0 NOT NULL,
	"is_encashable" boolean DEFAULT false NOT NULL,
	"allows_half_day" boolean DEFAULT true NOT NULL,
	"min_days" numeric(6, 2),
	"max_days" numeric(6, 2),
	"notice_days" integer DEFAULT 0 NOT NULL,
	"attachment_required_after_days" numeric(6, 2),
	"counts_sandwich_days" boolean DEFAULT false NOT NULL,
	"requires_two_step_approval" boolean DEFAULT false NOT NULL,
	"applicable_employment_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "punches" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"attendance_date" date NOT NULL,
	"punch_type" "punch_type" NOT NULL,
	"server_time" timestamp with time zone DEFAULT now() NOT NULL,
	"client_time" timestamp with time zone,
	"clock_skew_seconds" integer,
	"photo_file_id" uuid NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"gps_accuracy_m" double precision,
	"distance_from_geofence_m" double precision,
	"ip" text,
	"device_fingerprint" text,
	"source" "punch_source" NOT NULL,
	"user_agent" text,
	"app_version" text,
	"is_half_day_marked" boolean DEFAULT false NOT NULL,
	"half_day_part" "half_day_part",
	"outside_window" boolean DEFAULT false NOT NULL,
	"outside_geofence" boolean DEFAULT false NOT NULL,
	"device_mismatch" boolean DEFAULT false NOT NULL,
	"reason" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "attendance_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"attendance_date" date NOT NULL,
	"regularization_id" uuid,
	"adjusted_in" timestamp with time zone,
	"adjusted_out" timestamp with time zone,
	"reason" text NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "attendance_adjustments_moves_something" CHECK (adjusted_in IS NOT NULL OR adjusted_out IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "on_duty_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"reason" text NOT NULL,
	"site_name" text,
	"approval_request_id" uuid,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "on_duty_requests_range_ordered" CHECK (to_date >= from_date)
);
--> statement-breakpoint
CREATE TABLE "regularizations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" "regularization_kind" NOT NULL,
	"requested_in" timestamp with time zone,
	"requested_out" timestamp with time zone,
	"reason" text NOT NULL,
	"attachment_file_id" uuid,
	"approval_request_id" uuid,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shift_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "shift_assignments_range_ordered" CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"crosses_midnight" boolean DEFAULT false NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"grace_in_before" integer DEFAULT 30 NOT NULL,
	"grace_in_after" integer DEFAULT 10 NOT NULL,
	"late_after" integer DEFAULT 10 NOT NULL,
	"grace_out_before" integer DEFAULT 10 NOT NULL,
	"grace_out_after" integer DEFAULT 120 NOT NULL,
	"early_exit_before" integer DEFAULT 10 NOT NULL,
	"min_half_day_minutes" integer DEFAULT 240 NOT NULL,
	"min_full_day_minutes" integer DEFAULT 480 NOT NULL,
	"ot_after_minutes" integer DEFAULT 30 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "shifts_day_thresholds_ordered" CHECK (min_half_day_minutes <= min_full_day_minutes)
);
--> statement-breakpoint
CREATE TABLE "weekly_off_patterns" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_delegated_from_user_id_users_id_fk" FOREIGN KEY ("delegated_from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_first_in_punch_id_punches_id_fk" FOREIGN KEY ("first_in_punch_id") REFERENCES "public"."punches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_last_out_punch_id_punches_id_fk" FOREIGN KEY ("last_out_punch_id") REFERENCES "public"."punches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_override_by_users_id_fk" FOREIGN KEY ("override_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_period_locks" ADD CONSTRAINT "attendance_period_locks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_period_locks" ADD CONSTRAINT "attendance_period_locks_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_period_locks" ADD CONSTRAINT "attendance_period_locks_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_period_locks" ADD CONSTRAINT "attendance_period_locks_unlocked_by_users_id_fk" FOREIGN KEY ("unlocked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_calendars" ADD CONSTRAINT "holiday_calendars_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_calendar_id_holiday_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."holiday_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restricted_holiday_elections" ADD CONSTRAINT "restricted_holiday_elections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restricted_holiday_elections" ADD CONSTRAINT "restricted_holiday_elections_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restricted_holiday_elections" ADD CONSTRAINT "restricted_holiday_elections_holiday_id_holidays_id_fk" FOREIGN KEY ("holiday_id") REFERENCES "public"."holidays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comp_off_credits" ADD CONSTRAINT "comp_off_credits_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comp_off_credits" ADD CONSTRAINT "comp_off_credits_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comp_off_credits" ADD CONSTRAINT "comp_off_credits_consumed_by_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("consumed_by_leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request_days" ADD CONSTRAINT "leave_request_days_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request_days" ADD CONSTRAINT "leave_request_days_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_attachment_file_id_files_id_fk" FOREIGN KEY ("attachment_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punches" ADD CONSTRAINT "punches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punches" ADD CONSTRAINT "punches_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punches" ADD CONSTRAINT "punches_photo_file_id_files_id_fk" FOREIGN KEY ("photo_file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_adjustments" ADD CONSTRAINT "attendance_adjustments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_adjustments" ADD CONSTRAINT "attendance_adjustments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_adjustments" ADD CONSTRAINT "attendance_adjustments_regularization_id_regularizations_id_fk" FOREIGN KEY ("regularization_id") REFERENCES "public"."regularizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_adjustments" ADD CONSTRAINT "attendance_adjustments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "on_duty_requests" ADD CONSTRAINT "on_duty_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "on_duty_requests" ADD CONSTRAINT "on_duty_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "on_duty_requests" ADD CONSTRAINT "on_duty_requests_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regularizations" ADD CONSTRAINT "regularizations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regularizations" ADD CONSTRAINT "regularizations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regularizations" ADD CONSTRAINT "regularizations_attachment_file_id_files_id_fk" FOREIGN KEY ("attachment_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regularizations" ADD CONSTRAINT "regularizations_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_off_patterns" ADD CONSTRAINT "weekly_off_patterns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_requests_queue_idx" ON "approval_requests" USING btree ("org_id","status","current_step");--> statement-breakpoint
CREATE INDEX "approval_requests_subject_idx" ON "approval_requests" USING btree ("org_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "approval_requests_requester_idx" ON "approval_requests" USING btree ("org_id","requester_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_steps_request_step_uq" ON "approval_steps" USING btree ("approval_request_id","step_no") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "approval_steps_approver_idx" ON "approval_steps" USING btree ("org_id","approver_user_id");--> statement-breakpoint
CREATE INDEX "attendance_days_muster_idx" ON "attendance_days" USING btree ("org_id","date","employee_id");--> statement-breakpoint
CREATE INDEX "attendance_days_timeline_idx" ON "attendance_days" USING btree ("org_id","employee_id","date");--> statement-breakpoint
CREATE INDEX "attendance_days_absent_idx" ON "attendance_days" USING btree ("org_id","date") WHERE status = 'ABSENT';--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_days_employee_date_uq" ON "attendance_days" USING btree ("employee_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_period_locks_uq" ON "attendance_period_locks" USING btree ("org_id",coalesce("location_id", '00000000-0000-0000-0000-000000000000'::uuid),"year","month") WHERE deleted_at IS NULL AND unlocked_at IS NULL;--> statement-breakpoint
CREATE INDEX "attendance_period_locks_period_idx" ON "attendance_period_locks" USING btree ("org_id","year","month") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "holiday_calendars_org_name_year_uq" ON "holiday_calendars" USING btree ("org_id","name","year") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "holiday_calendars_org_year_idx" ON "holiday_calendars" USING btree ("org_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_calendar_date_uq" ON "holidays" USING btree ("calendar_id","date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "holidays_org_date_idx" ON "holidays" USING btree ("org_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "restricted_elections_employee_holiday_uq" ON "restricted_holiday_elections" USING btree ("employee_id","holiday_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "restricted_elections_year_idx" ON "restricted_holiday_elections" USING btree ("org_id","employee_id","leave_year");--> statement-breakpoint
CREATE UNIQUE INDEX "comp_off_credits_employee_date_uq" ON "comp_off_credits" USING btree ("employee_id","earned_for_date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "comp_off_credits_expiry_idx" ON "comp_off_credits" USING btree ("org_id","expires_on");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_balances_uq" ON "leave_balances" USING btree ("employee_id","leave_type_id","leave_year") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "leave_balances_org_year_idx" ON "leave_balances" USING btree ("org_id","leave_year");--> statement-breakpoint
CREATE INDEX "leave_ledger_balance_idx" ON "leave_ledger" USING btree ("org_id","employee_id","leave_type_id","leave_year");--> statement-breakpoint
CREATE INDEX "leave_ledger_reference_idx" ON "leave_ledger" USING btree ("org_id","reference_type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_request_days_uq" ON "leave_request_days" USING btree ("leave_request_id","date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "leave_request_days_date_idx" ON "leave_request_days" USING btree ("org_id","date");--> statement-breakpoint
CREATE INDEX "leave_requests_range_idx" ON "leave_requests" USING btree ("org_id","employee_id","from_date","to_date");--> statement-breakpoint
CREATE INDEX "leave_requests_status_idx" ON "leave_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_org_code_uq" ON "leave_types" USING btree ("org_id","code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "leave_types_org_active_idx" ON "leave_types" USING btree ("org_id","is_active");--> statement-breakpoint
CREATE INDEX "punches_employee_date_idx" ON "punches" USING btree ("org_id","employee_id","attendance_date","server_time");--> statement-breakpoint
CREATE INDEX "punches_org_date_idx" ON "punches" USING btree ("org_id","attendance_date");--> statement-breakpoint
CREATE UNIQUE INDEX "punches_employee_idempotency_uq" ON "punches" USING btree ("employee_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "attendance_adjustments_day_idx" ON "attendance_adjustments" USING btree ("org_id","employee_id","attendance_date");--> statement-breakpoint
CREATE INDEX "on_duty_requests_range_idx" ON "on_duty_requests" USING btree ("org_id","employee_id","from_date","to_date");--> statement-breakpoint
CREATE INDEX "on_duty_requests_status_idx" ON "on_duty_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "regularizations_employee_date_idx" ON "regularizations" USING btree ("org_id","employee_id","date");--> statement-breakpoint
CREATE INDEX "regularizations_org_date_idx" ON "regularizations" USING btree ("org_id","date");--> statement-breakpoint
CREATE INDEX "shift_assignments_employee_idx" ON "shift_assignments" USING btree ("org_id","employee_id","effective_from");--> statement-breakpoint
CREATE INDEX "shift_assignments_shift_idx" ON "shift_assignments" USING btree ("org_id","shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_org_code_uq" ON "shifts" USING btree ("org_id","code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "shifts_org_active_idx" ON "shifts" USING btree ("org_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_off_patterns_org_name_uq" ON "weekly_off_patterns" USING btree ("org_id","name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "weekly_off_patterns_org_idx" ON "weekly_off_patterns" USING btree ("org_id");
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Everything below this line is hand-written. Drizzle has no builder for an
-- exclusion constraint, a trigger, or a foreign key onto a table its schema
-- deliberately does not import, so these are not in the snapshot and a future
-- `drizzle-kit generate` will neither recreate nor drop them.
-- ---------------------------------------------------------------------------

-- REQ-C-04: "Overlapping assignments are rejected."
--
-- Rejected by Postgres, not by a service. Validation in the service layer is
-- checked-then-written, and two requests that both pass the check before
-- either commits will both write -- the roster is exactly the kind of thing a
-- bulk import (REQ-C-05) does concurrently. An exclusion constraint is
-- evaluated by the index at write time, so the second writer loses.
--
-- btree_gist supplies the gist operator class for `uuid WITH =`; gist natively
-- handles only the range half of this.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

-- `[]` because effective_from and effective_to are both inclusive: an
-- assignment ending on the 10th and another starting on the 10th do overlap,
-- and the half-open default would let them both stand. A null effective_to
-- makes the range unbounded, which is what an open-ended assignment means.
--
-- Keyed on employee_id alone rather than (org_id, employee_id): the employee
-- id already determines the organisation, and adding org_id would weaken the
-- constraint to "no overlap within an org" for no gain.
--
-- Partial on deleted_at so a soft-deleted assignment does not permanently
-- reserve its date range (REQ-M-04 means rows are never really gone).
ALTER TABLE "shift_assignments"
  ADD CONSTRAINT "shift_assignments_no_overlap"
  EXCLUDE USING gist (
    "employee_id" WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&
  ) WHERE ("deleted_at" IS NULL);--> statement-breakpoint

COMMENT ON CONSTRAINT "shift_assignments_no_overlap" ON "shift_assignments" IS
  'REQ-C-04: one employee cannot hold two shift assignments on the same date.';--> statement-breakpoint

-- REQ-D-12: punches are immutable. No updates, no deletes.
--
-- The same `vyuha_forbid_mutation()` created in migration 0000 and attached to
-- audit_logs in 0002, for the same reason stated there: an editable punch log
-- is worth nothing in a dispute, and a convention enforced only in a service
-- layer survives until the first repair script. A correction is an adjusting
-- record (REQ-F-03); an Admin "void" writes one rather than touching the punch
-- (05-decisions, Access).
--
-- Statement-level, so `DELETE FROM punches` fails even when it would have
-- matched no rows -- a statement that silently succeeds because the table
-- happened to be empty teaches the wrong lesson.
CREATE TRIGGER punches_append_only
  BEFORE UPDATE OR DELETE ON "punches"
  FOR EACH STATEMENT
  EXECUTE FUNCTION vyuha_forbid_mutation();--> statement-breakpoint

-- TRUNCATE bypasses UPDATE/DELETE triggers entirely, so it needs its own.
CREATE TRIGGER punches_no_truncate
  BEFORE TRUNCATE ON "punches"
  FOR EACH STATEMENT
  EXECUTE FUNCTION vyuha_forbid_mutation();--> statement-breakpoint

COMMENT ON TABLE "punches" IS
  'Append-only (REQ-D-12). Guarded by the punches_append_only trigger.';--> statement-breakpoint

-- REQ-G-03: "an immutable ledger". Technical design section 4.2 marks leave_ledger
-- append-only in the same breath as punches and audit_logs, and a balance that
-- can be edited behind the ledger is a balance nobody can defend.
CREATE TRIGGER leave_ledger_append_only
  BEFORE UPDATE OR DELETE ON "leave_ledger"
  FOR EACH STATEMENT
  EXECUTE FUNCTION vyuha_forbid_mutation();--> statement-breakpoint

CREATE TRIGGER leave_ledger_no_truncate
  BEFORE TRUNCATE ON "leave_ledger"
  FOR EACH STATEMENT
  EXECUTE FUNCTION vyuha_forbid_mutation();--> statement-breakpoint

COMMENT ON TABLE "leave_ledger" IS
  'Append-only (REQ-G-03). Guarded by the leave_ledger_append_only trigger.';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The four foreign keys migration 0001 deferred.
--
-- Why they were deferred: `employees` and `locations` live in `platform/`, and
-- technical design section 1 forbids platform from importing a module. Declaring
-- `references(() => shifts.id)` on `employees.default_shift_id` would have
-- meant `platform/db/schema/people.schema.ts` importing
-- `modules/attendance/schema/shift.schema.ts` -- the exact dependency the
-- ESLint boundary rule exists to prevent, and the one that would make CRM and
-- ERP impossible to add later without untangling it.
--
-- The columns were therefore created in 0001 as bare uuids with a comment
-- pointing here, and the constraints are added now, in SQL, where no import is
-- involved. The Drizzle schema still does not know about them; that is the
-- price, and it is paid in one place rather than in the module graph.
--
-- SET NULL rather than RESTRICT: deleting a shift or a calendar should not be
-- blocked by an employee pointing at it. The employee falls back to having no
-- default, which the day engine reports as a configuration error rather than
-- guessing a shift.
--
-- Reverse with:
--   ALTER TABLE "employees" DROP CONSTRAINT "employees_default_shift_id_shifts_id_fk";
--   ALTER TABLE "employees" DROP CONSTRAINT "employees_weekly_off_pattern_id_weekly_off_patterns_id_fk";
--   ALTER TABLE "employees" DROP CONSTRAINT "employees_holiday_calendar_id_holiday_calendars_id_fk";
--   ALTER TABLE "locations" DROP CONSTRAINT "locations_holiday_calendar_id_holiday_calendars_id_fk";
-- ---------------------------------------------------------------------------
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_default_shift_id_shifts_id_fk"
  FOREIGN KEY ("default_shift_id") REFERENCES "public"."shifts"("id")
  ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_weekly_off_pattern_id_weekly_off_patterns_id_fk"
  FOREIGN KEY ("weekly_off_pattern_id") REFERENCES "public"."weekly_off_patterns"("id")
  ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_holiday_calendar_id_holiday_calendars_id_fk"
  FOREIGN KEY ("holiday_calendar_id") REFERENCES "public"."holiday_calendars"("id")
  ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_holiday_calendar_id_holiday_calendars_id_fk"
  FOREIGN KEY ("holiday_calendar_id") REFERENCES "public"."holiday_calendars"("id")
  ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- The day engine's roster lookup: "the assignment covering this date". A
-- gist index over the same expression as the exclusion constraint would serve
-- it, but the constraint already created one -- this is the plain btree for
-- the open-ended-assignment case, which the range index answers poorly.
CREATE INDEX "shift_assignments_coverage_idx"
  ON "shift_assignments" ("employee_id", "effective_from", "effective_to")
  WHERE "deleted_at" IS NULL;
