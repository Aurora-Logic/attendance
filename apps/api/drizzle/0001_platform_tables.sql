CREATE TYPE "public"."export_job_status" AS ENUM('QUEUED', 'RUNNING', 'DONE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."file_purpose" AS ENUM('PUNCH_PHOTO', 'PUNCH_PHOTO_THUMB', 'EXPORT', 'ATTACHMENT', 'ORG_LOGO', 'IMPORT');--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('ACTIVE', 'PENDING_REBIND', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('INVITED', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('DISCONNECTED', 'CONNECTED', 'STALE', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."integration_system" AS ENUM('TALLY');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."setting_scope" AS ENUM('ORG', 'LOCATION');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('ACTIVE', 'ON_NOTICE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('PERMANENT', 'CONTRACT', 'PROBATION', 'INTERN');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"impersonator_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"report_key" text NOT NULL,
	"filters" jsonb NOT NULL,
	"status" "export_job_status" DEFAULT 'QUEUED' NOT NULL,
	"file_id" uuid,
	"row_count" integer,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint NOT NULL,
	"checksum" text NOT NULL,
	"purpose" "file_purpose" NOT NULL,
	"uploaded_by" uuid,
	"expires_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"report_key" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"label" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "device_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"employee_id" uuid,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"requested_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"device_fingerprint" text,
	"ip" text,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid,
	"email" text NOT NULL,
	"password_hash" text,
	"status" "user_status" DEFAULT 'INVITED' NOT NULL,
	"totp_secret" text,
	"totp_confirmed_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "external_refs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"system" "integration_system" NOT NULL,
	"entity_type" text NOT NULL,
	"external_guid" text NOT NULL,
	"external_alter_id" bigint,
	"internal_type" text NOT NULL,
	"internal_id" uuid NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"system" "integration_system" NOT NULL,
	"name" text NOT NULL,
	"status" "integration_status" DEFAULT 'DISCONNECTED' NOT NULL,
	"agent_token_hash" text,
	"last_heartbeat_at" timestamp with time zone,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"payload" jsonb,
	"read_at" timestamp with time zone,
	"channels_sent" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address" text,
	"timezone" text,
	"geofence_lat" double precision,
	"geofence_lng" double precision,
	"geofence_radius_m" integer DEFAULT 100 NOT NULL,
	"ip_allowlist" text[] DEFAULT '{}'::text[] NOT NULL,
	"holiday_calendar_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"date_format" text DEFAULT 'dd-MM-yyyy' NOT NULL,
	"week_start" smallint DEFAULT 1 NOT NULL,
	"leave_year_start_month" smallint DEFAULT 4 NOT NULL,
	"logo_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"scope" "setting_scope" DEFAULT 'ORG' NOT NULL,
	"scope_id" uuid,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"head_employee_id" uuid,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "designations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"grade" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_code" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"work_email" text,
	"personal_email" text,
	"mobile" text,
	"date_of_joining" date NOT NULL,
	"date_of_leaving" date,
	"employment_type" "employment_type" DEFAULT 'PERMANENT' NOT NULL,
	"status" "employee_status" DEFAULT 'ACTIVE' NOT NULL,
	"department_id" uuid,
	"designation_id" uuid,
	"location_id" uuid,
	"reporting_manager_id" uuid,
	"default_shift_id" uuid,
	"weekly_off_pattern_id" uuid,
	"holiday_calendar_id" uuid,
	"is_field_staff" boolean DEFAULT false NOT NULL,
	"tally_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_refs" ADD CONSTRAINT "external_refs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_employee_id_employees_id_fk" FOREIGN KEY ("head_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_departments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "designations" ADD CONSTRAINT "designations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_designation_id_designations_id_fk" FOREIGN KEY ("designation_id") REFERENCES "public"."designations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_reporting_manager_id_employees_id_fk" FOREIGN KEY ("reporting_manager_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("org_id","entity_type","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("org_id","actor_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "export_jobs_requester_idx" ON "export_jobs" USING btree ("org_id","requested_by","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "files_org_purpose_idx" ON "files" USING btree ("org_id","purpose");--> statement-breakpoint
CREATE INDEX "files_expiry_idx" ON "files" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "saved_views_lookup_idx" ON "saved_views" USING btree ("org_id","report_key","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_employee_fingerprint_uq" ON "devices" USING btree ("employee_id","fingerprint") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("org_id",lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "password_resets_token_uq" ON "password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_resets_user_idx" ON "password_resets" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_key_uq" ON "permissions" USING btree ("key");--> statement-breakpoint
CREATE INDEX "role_permissions_permission_idx" ON "role_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_org_name_uq" ON "roles" USING btree ("org_id","name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_family_idx" ON "sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email")) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_employee_uq" ON "users" USING btree ("employee_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "users_org_status_idx" ON "users" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "external_refs_external_uq" ON "external_refs" USING btree ("org_id","system","entity_type","external_guid") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "external_refs_internal_uq" ON "external_refs" USING btree ("org_id","system","internal_type","internal_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "external_refs_alter_idx" ON "external_refs" USING btree ("org_id","system","entity_type","external_alter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_uq" ON "integration_connections" USING btree ("org_id","system","name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_prefs_uq" ON "notification_preferences" USING btree ("user_id","event_type","channel") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE read_at IS NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("org_id","user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "locations_org_code_uq" ON "locations" USING btree ("org_id","code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "locations_org_idx" ON "locations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_scope_key_uq" ON "settings" USING btree ("org_id","scope",coalesce("scope_id", '00000000-0000-0000-0000-000000000000'::uuid),"key") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_org_code_uq" ON "departments" USING btree ("org_id","code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "departments_org_idx" ON "departments" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "designations_org_code_uq" ON "designations" USING btree ("org_id","code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "designations_org_idx" ON "designations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_org_code_uq" ON "employees" USING btree ("org_id","employee_code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "employees_org_status_idx" ON "employees" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "employees_org_department_idx" ON "employees" USING btree ("org_id","department_id");--> statement-breakpoint
CREATE INDEX "employees_org_location_idx" ON "employees" USING btree ("org_id","location_id");--> statement-breakpoint
CREATE INDEX "employees_org_manager_idx" ON "employees" USING btree ("org_id","reporting_manager_id");