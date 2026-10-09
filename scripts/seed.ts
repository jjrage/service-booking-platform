/**
 * Seeds the Wrenfield demo business: staff with logins, crews, services, version-1 rules, and clients
 * with their homes. Safe to re-run: the previous Wrenfield tenant is deleted (cascading to all of its
 * data) and recreated; auth users are reused.
 *
 * Usage: npm run db:seed   (after npm run db:start or npm run db:reset)
 */
import { existsSync } from "node:fs";

import { createClient, type PostgrestError } from "@supabase/supabase-js";

import { parseEnv, publicEnvSchema, serverEnvSchema } from "@/config/env-schema";
import type { Database } from "@/db/database.types";
import {
  wrenfieldBadCardClients,
  wrenfieldCancellationRules,
  wrenfieldClientNotes,
  wrenfieldClients,
  wrenfieldCrews,
  wrenfieldPlans,
  wrenfieldPricingRules,
  wrenfieldScheduleRules,
  wrenfieldServices,
  wrenfieldStaff,
  wrenfieldTenant,
} from "@/demo/wrenfield";
import { toLocal } from "@/domain/time";

import { insertHistory } from "./seed-history";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const { NEXT_PUBLIC_SUPABASE_URL: supabaseUrl } = parseEnv(publicEnvSchema, process.env, "public");
const { SUPABASE_SECRET_KEY: secretKey } = parseEnv(serverEnvSchema, process.env, "server");

// A fixed password is fine for a local database; anywhere else it must come from the environment so the
// public repository never holds a working credential.
const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(supabaseUrl);
const demoPassword =
  process.env.DEMO_USER_PASSWORD ?? (isLocal ? "wrenfield-local-demo" : undefined);
if (!demoPassword) {
  throw new Error("Set DEMO_USER_PASSWORD to seed a database that is not the local one.");
}

const admin = createClient<Database>(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function must<T>(result: { data: T; error: PostgrestError | null }, what: string): NonNullable<T> {
  if (result.error) {
    throw new Error(`${what}: ${result.error.message}`);
  }
  if (result.data === null || result.data === undefined) {
    throw new Error(`${what}: no data returned`);
  }
  return result.data;
}

/** Returns the id of the auth user with this e-mail, creating it (or resetting its password). */
async function ensureUser(email: string, fullName: string): Promise<string> {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;

    const existing = data.users.find((user) => user.email === email);
    if (existing) {
      const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, {
        password: demoPassword,
        user_metadata: { full_name: fullName },
      });
      if (updateError) throw updateError;
      return existing.id;
    }
    if (data.users.length < 1000) break;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: demoPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  return data.user.id;
}

async function main() {
  console.log(`Seeding ${wrenfieldTenant.name} into ${supabaseUrl}`);

  must(
    await admin.from("tenants").delete().eq("slug", wrenfieldTenant.slug).select("id"),
    "remove previous demo tenant",
  );

  const tenant = must(
    await admin
      .from("tenants")
      .insert({
        slug: wrenfieldTenant.slug,
        name: wrenfieldTenant.name,
        timezone: wrenfieldTenant.timezone,
        contact_email: wrenfieldTenant.contactEmail,
        phone: wrenfieldTenant.phone,
        is_demo: true,
      })
      .select("id")
      .single(),
    "create tenant",
  );

  // Staff and crews ---------------------------------------------------------------------------------------
  const staffIds = new Map<string, string>();
  for (const member of wrenfieldStaff) {
    staffIds.set(member.key, await ensureUser(member.email, member.fullName));
  }

  must(
    await admin
      .from("memberships")
      .insert(
        wrenfieldStaff.map((member) => ({
          tenant_id: tenant.id,
          user_id: staffIds.get(member.key)!,
          role: member.role,
          display_name: member.fullName,
        })),
      )
      .select("user_id"),
    "create memberships",
  );

  const crews = must(
    await admin
      .from("crews")
      .insert(
        wrenfieldCrews.map((crew) => ({
          tenant_id: tenant.id,
          name: crew.name,
          color: crew.color,
        })),
      )
      .select("id, name"),
    "create crews",
  );
  const crewIdByKey = new Map(
    wrenfieldCrews.map((crew) => [crew.key, crews.find((row) => row.name === crew.name)!.id]),
  );

  must(
    await admin
      .from("crew_members")
      .insert(
        wrenfieldStaff
          .filter((member) => member.crew)
          .map((member) => ({
            tenant_id: tenant.id,
            crew_id: crewIdByKey.get(member.crew!)!,
            user_id: staffIds.get(member.key)!,
          })),
      )
      .select("user_id"),
    "assign cleaners to crews",
  );

  // Services and rules ----------------------------------------------------------------------------------
  const services = must(
    await admin
      .from("services")
      .insert(
        wrenfieldServices.map((service, index) => ({
          tenant_id: tenant.id,
          code: service.code,
          name: service.name,
          description: service.description,
          booking_mode: service.bookingMode,
          checklist: "checklist" in service ? [...service.checklist] : [],
          sort_order: index,
        })),
      )
      .select("id, code"),
    "create services",
  );

  const ownerId = staffIds.get("owner")!;
  const ruleRows = must(
    await admin
      .from("rule_versions")
      .insert(
        [
          { kind: "pricing" as const, rules: wrenfieldPricingRules },
          { kind: "schedule" as const, rules: wrenfieldScheduleRules },
          { kind: "cancellation" as const, rules: wrenfieldCancellationRules },
        ].map((rule) => ({
          tenant_id: tenant.id,
          kind: rule.kind,
          version: 1,
          rules: rule.rules,
          note: "Initial rules",
          created_by: ownerId,
          // Effective from the start of the demo history, so seeded past bookings can reference them.
          effective_from: "2026-01-01T00:00:00Z",
        })),
      )
      .select("id, kind"),
    "publish initial rules",
  );
  const ruleId = (kind: string) => ruleRows.find((r) => r.kind === kind)!.id;

  // Clients and homes ------------------------------------------------------------------------------------
  const seededClients = [];
  for (const client of wrenfieldClients) {
    const userId = client.loginKey ? await ensureUser(client.email, client.fullName) : null;

    const clientRow = must(
      await admin
        .from("clients")
        .insert({
          tenant_id: tenant.id,
          user_id: userId,
          full_name: client.fullName,
          email: client.email,
          phone: client.phone,
          source: "import",
        })
        .select("id")
        .single(),
      `create client ${client.fullName}`,
    );

    const property = must(
      await admin
        .from("properties")
        .insert({
          tenant_id: tenant.id,
          client_id: clientRow.id,
          address_line1: client.home.addressLine1,
          city: client.home.city,
          state: "NC",
          zip: client.home.zip,
          bedrooms: client.home.bedrooms,
          full_baths: client.home.fullBaths,
          half_baths: client.home.halfBaths,
          sqft: client.home.sqft,
          has_pets: client.home.hasPets,
          pet_notes: client.home.petNotes ?? null,
          access_notes: client.home.accessNotes ?? null,
          parking_notes: client.home.parkingNotes ?? null,
        })
        .select("id")
        .single(),
      `create home for ${client.fullName}`,
    );
    seededClients.push({
      id: clientRow.id,
      propertyId: property.id,
      fullName: client.fullName,
      home: {
        bedrooms: client.home.bedrooms,
        fullBaths: client.home.fullBaths,
        halfBaths: client.home.halfBaths,
        sqft: client.home.sqft,
      },
      zip: client.home.zip,
    });

    for (const body of wrenfieldClientNotes[client.fullName] ?? []) {
      must(
        await admin
          .from("client_notes")
          .insert({
            tenant_id: tenant.id,
            client_id: clientRow.id,
            author_id: staffIds.get("dispatcher")!,
            body,
          })
          .select("id"),
        `note about ${client.fullName}`,
      );
    }
  }

  // History and upcoming visits ----------------------------------------------------------------------------
  const now = new Date().toISOString();
  const history = await insertHistory(
    admin,
    tenant.id,
    {
      today: toLocal(now, wrenfieldTenant.timezone).date,
      now,
      timeZone: wrenfieldTenant.timezone,
      crews: wrenfieldCrews.map((crew) => ({
        key: crew.key,
        id: crewIdByKey.get(crew.key)!,
      })),
      clients: seededClients,
      serviceIds: Object.fromEntries(services.map((s) => [s.code, s.id])),
      rules: {
        pricing: { id: ruleId("pricing"), rules: wrenfieldPricingRules },
        schedule: { id: ruleId("schedule"), rules: wrenfieldScheduleRules },
        cancellation: {
          id: ruleId("cancellation"),
          rules: wrenfieldCancellationRules,
        },
      },
      staff: { dispatcherId: staffIds.get("dispatcher")! },
    },
    wrenfieldPlans.map((plan) => ({ ...plan })),
    wrenfieldBadCardClients,
  );

  console.log(
    `Done: ${wrenfieldStaff.length} staff, ${wrenfieldCrews.length} crews, ` +
      `${wrenfieldServices.length} services, ${wrenfieldClients.length} clients, ` +
      `${history.plans} plans, ${history.bookings} bookings, ${history.payments} payments.`,
  );
  if (isLocal) {
    console.log(`Demo logins use the password "${demoPassword}" (local only).`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
