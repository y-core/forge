// Served in place of another fixture's `main`, under that fixture's bindings.
interface Env {
  DB: D1Database;
  SITE_ORIGIN: string;
  MODE?: string;
}

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    const row = await env.DB.prepare("SELECT 'from-entry' AS answer").first<{ answer: string }>();
    return Response.json({ answer: row?.answer ?? null, siteOrigin: env.SITE_ORIGIN, mode: env.MODE ?? null });
  },
} satisfies ExportedHandler<Env>;
