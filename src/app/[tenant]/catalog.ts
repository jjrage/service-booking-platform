import "server-only";

import { notFound } from "next/navigation";

import { getCatalog, type Catalog } from "@/server/catalog";

/** The catalog for a route's [tenant] segment, or the 404 page. */
export async function requireCatalog(params: Promise<{ tenant: string }>): Promise<Catalog> {
  const { tenant } = await params;
  const catalog = /^[a-z0-9-]{2,40}$/.test(tenant) ? await getCatalog(tenant) : null;
  if (!catalog) notFound();
  return catalog;
}
