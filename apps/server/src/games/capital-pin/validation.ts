import { z } from "zod";

import { CAPITALS } from "./capitals.js";
import type { Capital } from "./types.js";

const capitalSchema = z.object({
  id: z.string().min(1),
  city: z.string().min(1),
  country: z.string().min(1),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

/**
 * Validate the complete capital dataset at startup. Throws with a descriptive
 * message on any violation. Rules: valid shape, unique ids, unique
 * (city, country) pairs, in-range coordinates, non-empty names, and a minimum
 * dataset size so a round never runs out of unique capitals.
 */
export function validateCapitalDataset(capitals: readonly Capital[] = CAPITALS): void {
  for (const capital of capitals) {
    const parsed = capitalSchema.safeParse(capital);
    if (!parsed.success) {
      throw new Error(
        `Invalid capital entry ${JSON.stringify(capital)}: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      );
    }
  }

  const ids = new Set<string>();
  const pairs = new Set<string>();
  for (const c of capitals) {
    if (ids.has(c.id)) {
      throw new Error(`Duplicate capital id: ${c.id}`);
    }
    ids.add(c.id);

    const key = `${c.city.toLowerCase()}|${c.country.toLowerCase()}`;
    if (pairs.has(key)) {
      throw new Error(`Duplicate capital city/country pair: ${c.city}, ${c.country}`);
    }
    pairs.add(key);
  }

  if (capitals.length < 120) {
    throw new Error(
      `Capital dataset must contain at least 120 entries (found ${capitals.length}).`,
    );
  }
}
