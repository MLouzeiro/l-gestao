import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";
import { users } from "./auth";

// Auditoria — append-only: policies somente INSERT e SELECT (sem UPDATE/DELETE).

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    module: text("module").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    result: text("result").notNull().default("SUCCESS"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("audit_logs_tenant_action_idx").on(t.tenantId, t.action),
    index("audit_logs_tenant_entity_idx").on(t.tenantId, t.entityType, t.entityId),
    index("audit_logs_tenant_user_idx").on(t.tenantId, t.userId),
    check("audit_logs_result_valid", sql`result IN ('SUCCESS', 'FAILURE')`),
  ],
);
