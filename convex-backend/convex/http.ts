import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

// Owner-only local gateway. This is not a Google credential or an admin key.
function authorised(request: Request) {
  const token = process.env.LIFEOS_NATIVE_TOKEN;
  return !!token && token.length >= 32 && request.headers.get("Authorization") === `Bearer ${token}`;
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

http.route({
  path: "/health/day", method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorised(request)) return json({ error: "Unauthorised" }, 401);
    // Convex documents have a size limit; do not store unbounded raw streams.
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 512_000) return json({ error: "Day too large" }, 413);
    try {
      const id = await ctx.runMutation(internal.health.upsert, JSON.parse(text));
      return json({ id });
    } catch {
      return json({ error: "Invalid day record" }, 400);
    }
  }),
});
http.route({
  path: "/health/day", method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!authorised(request)) return json({ error: "Unauthorised" }, 401);
    const url = new URL(request.url);
    const source = url.searchParams.get("source");
    const date = url.searchParams.get("date");
    if (!date || (source !== "google-health" && source !== "synthetic")) {
      return json({ error: "Invalid query" }, 400);
    }
    return json(await ctx.runQuery(internal.health.get, { source, date }));
  }),
});
http.route({
  path: "/health/days", method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!authorised(request)) return json({ error: "Unauthorised" }, 401);
    const url = new URL(request.url);
    const source = url.searchParams.get("source");
    const limit = Number(url.searchParams.get("limit") ?? "30");
    if ((source !== "google-health" && source !== "synthetic") ||
        !Number.isInteger(limit) || limit < 1 || limit > 90) {
      return json({ error: "Invalid query" }, 400);
    }
    return json(await ctx.runQuery(internal.health.recent, { source, limit }));
  }),
});
export default http;
