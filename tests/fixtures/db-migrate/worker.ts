// The database `forge db migrate --target local` wrote, read back through the binding a Worker
// would use: what tables exist, and what the companion tables recorded.
import { checkSchemaHealth } from "../../../src/storage/db/health";

interface Env {
  DB: D1Database;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/tables") {
      const rows = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>();
      return json(rows.results.map((row) => row.name));
    }
    if (url.pathname === "/migrations") {
      const rows = await env.DB.prepare("SELECT applied_name, sha256 FROM forge_migrations ORDER BY applied_name").all<{
        applied_name: string;
        sha256: string;
      }>();
      return json(rows.results);
    }
    if (url.pathname === "/schema-health") return json(await checkSchemaHealth(env.DB));
    if (url.pathname === "/meta") {
      const rows = await env.DB.prepare("SELECT key, value FROM forge_schema_meta ORDER BY key").all<{ key: string; value: string }>();
      return json(Object.fromEntries(rows.results.map((row) => [row.key, row.value])));
    }
    return new Response("not found", { status: 404 });
  },
};
