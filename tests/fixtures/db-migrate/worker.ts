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
      const rows = await env.DB.prepare("SELECT name, sha256, applied_at, fingerprint FROM _forge_migrations ORDER BY id").all<{
        name: string;
        sha256: string;
        applied_at: number;
        fingerprint: string | null;
      }>();
      return json(rows.results);
    }
    if (url.pathname === "/schema-health") return json(await checkSchemaHealth(env.DB));
    return new Response("not found", { status: 404 });
  },
};
