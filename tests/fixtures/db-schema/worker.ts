// `forge db` resolves its scratch database from a wrangler config, and a wrangler config names a
// `main`. Nothing fetches this fixture; the entry exists so the config is valid.
export default { fetch: () => new Response("db-schema fixture", { status: 200 }) };
