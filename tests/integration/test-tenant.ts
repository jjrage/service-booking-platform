import {
  wrenfieldCancellationRules,
  wrenfieldPricingRules,
  wrenfieldScheduleRules,
  wrenfieldServices,
} from "@/demo/wrenfield";

import { createAdminClient } from "./admin-client";

/**
 * A throwaway business with the demo rules, for tests that exercise the server's booking and payment code
 * against the real database. Removed (with everything it owns) by cleanup().
 */
export async function createTestTenant(options: { crews: number }) {
  const admin = createAdminClient();
  const slug = `it-${crypto.randomUUID().slice(0, 8)}`;

  const { data: tenant, error } = await admin
    .from("tenants")
    .insert({
      slug,
      name: `Integration test ${slug}`,
      timezone: "America/New_York",
    })
    .select("id")
    .single();
  if (error) throw error;

  const crews = await admin
    .from("crews")
    .insert(
      Array.from({ length: options.crews }, (_, i) => ({
        tenant_id: tenant.id,
        name: `Crew ${i + 1}`,
      })),
    )
    .select("id, name");
  if (crews.error) throw crews.error;

  const services = await admin.from("services").insert(
    wrenfieldServices.map((service, index) => ({
      tenant_id: tenant.id,
      code: service.code,
      name: service.name,
      booking_mode: service.bookingMode,
      sort_order: index,
    })),
  );
  if (services.error) throw services.error;

  const rules = await admin.from("rule_versions").insert(
    [
      { kind: "pricing" as const, rules: wrenfieldPricingRules },
      { kind: "schedule" as const, rules: wrenfieldScheduleRules },
      { kind: "cancellation" as const, rules: wrenfieldCancellationRules },
    ].map((rule) => ({
      tenant_id: tenant.id,
      kind: rule.kind,
      version: 1,
      rules: rule.rules,
      effective_from: "2026-01-01T00:00:00Z",
    })),
  );
  if (rules.error) throw rules.error;

  return {
    admin,
    slug,
    tenantId: tenant.id,
    crewIds: crews.data
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => c.id),
    async cleanup() {
      await admin.from("tenants").delete().eq("id", tenant.id);
    },
  };
}
