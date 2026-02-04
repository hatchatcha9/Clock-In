CREATE TABLE "admin_employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "employee_code" varchar(8);--> statement-breakpoint
ALTER TABLE "admin_employees" ADD CONSTRAINT "admin_employees_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_employees" ADD CONSTRAINT "admin_employees_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_employees_admin_id_employee_id_unique" ON "admin_employees" USING btree ("admin_id","employee_id");--> statement-breakpoint
CREATE INDEX "idx_admin_employees_admin_id" ON "admin_employees" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "idx_admin_employees_employee_id" ON "admin_employees" USING btree ("employee_id");--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_employee_code_unique" UNIQUE("employee_code");