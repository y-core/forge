import { createD1Client, sql } from "@y-core/forge/storage/db";

import type { SiteSummary } from "../model/site";

/** The site's name, and whether its database answers. */
export async function siteSummary(db: D1Database, name: string): Promise<SiteSummary> {
  const ping = await createD1Client(db).queryOne<{ ok: number }>(sql`SELECT 1 AS ok`);
  return { name, databaseUp: ping.ok && ping.data?.ok === 1 };
}
