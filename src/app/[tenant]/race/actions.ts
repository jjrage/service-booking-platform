"use server";

import { z } from "zod";

import { raceForWindow, type RaceResult } from "@/server/booking/race";
import { getCatalog } from "@/server/catalog";

const inputSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  contenders: z.union([z.literal(2), z.literal(10), z.literal(20)]),
});

export async function raceAction(input: z.input<typeof inputSchema>): Promise<RaceResult | null> {
  const { slug, contenders } = inputSchema.parse(input);
  const catalog = await getCatalog(slug);
  if (!catalog) return null;
  return raceForWindow(catalog, contenders);
}
