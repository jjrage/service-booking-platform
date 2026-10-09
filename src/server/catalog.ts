import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import {
  cancellationRulesSchema,
  pricingRulesSchema,
  scheduleRulesSchema,
  type CancellationRules,
  type PricingRules,
  type ScheduleRules,
} from "@/domain/rules";

import { adminDb } from "./db/admin";
import { unwrap } from "./db/errors";

/**
 * A business's public catalog: who they are, what they sell, and the rule versions in force. Everything here
 * is public (it is what the booking page shows), so it is cached across requests and refreshed when the
 * owner publishes new rules (updateTag(catalogTag(slug))).
 */

export type TenantInfo = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  contactEmail: string | null;
  phone: string | null;
  isDemo: boolean;
};

export type ServiceInfo = {
  id: string;
  code: string;
  name: string;
  description: string;
  bookingMode: "instant" | "quote_request" | "class";
};

export type Versioned<T> = { id: string; version: number; rules: T };

export type Catalog = {
  tenant: TenantInfo;
  services: ServiceInfo[];
  pricing: Versioned<PricingRules>;
  schedule: Versioned<ScheduleRules>;
  cancellation: Versioned<CancellationRules>;
};

export function catalogTag(slug: string) {
  return `catalog:${slug}`;
}

export async function getCatalog(slug: string): Promise<Catalog | null> {
  "use cache";
  cacheTag(catalogTag(slug));
  cacheLife("minutes");
  return loadCatalog(slug);
}

/** Uncached: for commands that must price with the rules in force right now. */
export async function loadCatalog(slug: string): Promise<Catalog | null> {
  const db = adminDb();
  const { data: tenant, error } = await db
    .from("tenants")
    .select("id, slug, name, timezone, currency, contact_email, phone, is_demo")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`load tenant ${slug}: ${error.message}`);
  if (!tenant) return null;

  const [services, versions] = await Promise.all([
    db
      .from("services")
      .select("id, code, name, description, booking_mode")
      .eq("tenant_id", tenant.id)
      .eq("active", true)
      .order("sort_order"),
    db
      .from("rule_versions")
      .select("id, kind, version, rules")
      .eq("tenant_id", tenant.id)
      .lte("effective_from", new Date().toISOString())
      .order("version", { ascending: false }),
  ]);

  const current = (kind: "pricing" | "schedule" | "cancellation") => {
    const row = unwrap(versions, "load rules").find((v) => v.kind === kind);
    if (!row) throw new Error(`${slug} has no ${kind} rules in force`);
    return row;
  };
  const pricing = current("pricing");
  const schedule = current("schedule");
  const cancellation = current("cancellation");

  return {
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      timezone: tenant.timezone,
      currency: tenant.currency,
      contactEmail: tenant.contact_email,
      phone: tenant.phone,
      isDemo: tenant.is_demo,
    },
    services: unwrap(services, "load services").map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      description: s.description ?? "",
      bookingMode: s.booking_mode,
    })),
    pricing: { ...pricing, rules: pricingRulesSchema.parse(pricing.rules) },
    schedule: { ...schedule, rules: scheduleRulesSchema.parse(schedule.rules) },
    cancellation: {
      ...cancellation,
      rules: cancellationRulesSchema.parse(cancellation.rules),
    },
  };
}

/** Active crews in a stable order. Not part of the public catalog: the browser never needs crew ids. */
export async function activeCrewIds(tenantId: string): Promise<string[]> {
  const rows = unwrap(
    await adminDb()
      .from("crews")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("name"),
    "load crews",
  );
  return rows.map((row) => row.id);
}
