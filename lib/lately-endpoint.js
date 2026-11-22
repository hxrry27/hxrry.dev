import { SOURCES, LatelyError, scrub, imageAllowed, request } from "./lately.js";

const MEMORY_SECONDS = 5;
const inflight = new Map();
const memory = new Map();

const cache = () => (typeof caches !== "undefined" && caches.default ? caches.default : null);
const keyFor = (ctx, name) => new Request(`${new URL(ctx.request.url).origin}/__lately/${name}`);
const later = (ctx, promise) => (ctx.waitUntil ? ctx.waitUntil(promise) : promise);
const store = (ctx, name, record, seconds) => {
  const c = cache();
  if (!c) return;
  later(ctx, c.put(keyFor(ctx, name), new Response(JSON.stringify(record), {
    headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${seconds}` },
  })).catch(() => {}));
};
const recall = async (ctx, name) => {
  const c = cache();
  if (!c) return null;
  try {
    const hit = await c.match(keyFor(ctx, name));
    return hit ? await hit.json() : null;
  } catch {
    return null;
  }
};

const fingerprint = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

const load = async (ctx, row) => {
  const { fetch: fetcher, service, ttl, keep } = SOURCES[row];
  const remembered = memory.get(row);
  if (remembered && remembered.expires > Date.now()) return remembered.record;
  if (inflight.has(row)) return inflight.get(row);

  const job = (async () => {
    const cached = await recall(ctx, row);
    if (cached) {
      memory.set(row, { expires: Date.now() + Math.min(MEMORY_SECONDS, ttl) * 1000, record: cached });
      return cached;
    }
    let record, seconds = ttl;
    try {
      const { state, item } = await fetcher(ctx.env || {});
      record = { service, status: item ? "ok" : "empty", state: item ? state : null, stale: false, item, fetchedAt: new Date().toISOString() };
      if (item && keep) store(ctx, `${row}-last-good`, record, keep);
    } catch (error) {
      const status = error instanceof LatelyError ? error.status : "upstream";
      console.log(`lately ${row}: ${status}: ${scrub(error.message, ctx.env || {})}`);
      const last = status === "unconfigured" || !keep ? null : await recall(ctx, `${row}-last-good`);
      if (last && last.item) {
        record = { ...last, state: last.state === "playing" ? "recent" : last.state, stale: true };
      } else {
        record = { service, status: status === "unconfigured" ? "unconfigured" : "unavailable", state: null, stale: false, item: null, fetchedAt: new Date().toISOString() };
      }
      seconds = Math.min(ttl, 60);
    }
    memory.set(row, { expires: Date.now() + Math.min(MEMORY_SECONDS, seconds) * 1000, record });
    store(ctx, row, record, seconds);
    return record;
  })().finally(() => inflight.delete(row));

  inflight.set(row, job);
  return job;
};

const json = (body, status, maxAge) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `public, max-age=${maxAge}`,
    "X-Content-Type-Options": "nosniff",
  },
});

export const serveRow = async (ctx, row) => {
  if (!SOURCES[row]) return json({ status: "not-found" }, 404, 60);
  const record = await load(ctx, row);
  const item = record.item;
  const { show, ttl } = SOURCES[row];
  const body = {
    service: record.service,
    status: record.status,            
    state: record.state,              
    stale: Boolean(record.stale),     
    fetchedAt: record.fetchedAt,
    item: item && show ? show(item) : item ? {
      title: item.title,
      subtitle: item.subtitle || "",
      url: item.url || "",
      at: item.at || null,
      image: item.imageUrl && imageAllowed(item.imageUrl) ? `/api/art/${row}?v=${fingerprint(item.imageUrl)}` : null,
      ...(Number.isFinite(item.minutes2weeks) ? { minutes2weeks: item.minutes2weeks } : {}),
    } : null,
  };
  const failed = record.status === "unavailable" || record.status === "unconfigured";
  return json(body, failed ? 503 : 200, Math.min(ttl, 300));
};

export const serveArt = async (ctx, row) => {
  const notFound = () => new Response("not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
  if (!SOURCES[row]) return notFound();
  const record = await load(ctx, row);
  const src = record.item && record.item.imageUrl;
  if (!src || !imageAllowed(src)) return notFound();

  const name = `art-${fingerprint(src)}`;
  const c = cache();
  if (c) {
    const hit = await c.match(keyFor(ctx, name)).catch(() => null);
    if (hit) return hit;
  }
  let upstream;
  try {
    upstream = await request(src);
  } catch {
    return notFound();
  }
  const type = (upstream.headers.get("content-type") || "").split(";")[0].trim();
  if (!upstream.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return notFound();
  const bytes = await upstream.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 1024 * 1024) return notFound();
  const response = new Response(bytes, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
  if (c) later(ctx, c.put(keyFor(ctx, name), response.clone()).catch(() => {}));
  return response;
};

export { LatelyError };
