import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const supabaseUrl = Deno.env.get("PROJECT_URL") ?? "";
const serviceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const privatePin = Deno.env.get("PRIVATE_CHEST_PIN") ?? "";
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_LISTS = 200;
const MAX_PRODUCTS = 5000;
const MAX_HISTORY = 20000;

type AnyRecord = Record<string, unknown>;
type State = {
  schemaVersion?: number;
  lists: AnyRecord[];
  products: AnyRecord[];
  history: AnyRecord[];
};
const empty = (): State => ({ schemaVersion: 2, lists: [], products: [], history: [] });

if (!supabaseUrl || !serviceKey) {
  console.error("Missing PROJECT_URL or SERVICE_ROLE_KEY secret");
}
const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function privateListIds(state: State): Set<string> {
  return new Set(state.lists.filter((list) => list?.isPrivate === true).map((list) => String(list.id)));
}

function publicView(state: State): State {
  const privateIds = privateListIds(state);
  const products = state.products.filter((product) => {
    const linked = Array.isArray(product.lists) ? product.lists.map(String) : [];
    return !linked.some((id) => privateIds.has(id));
  });
  const visibleIds = new Set(products.map((product) => String(product.id)));
  return {
    schemaVersion: state.schemaVersion || 2,
    // Cards stay visible by product decision; their metadata is public.
    lists: state.lists.map((list) => ({
      id: String(list.id),
      name: String(list.name || "Baú sem nome"),
      desc: String(list.desc || ""),
      cover: String(list.cover || "🏴‍☠️"),
      image: String(list.image || ""),
      isPrivate: list.isPrivate === true,
      created: list.created || "",
    })),
    products,
    history: state.history.filter((entry) => visibleIds.has(String(entry.productId))),
  };
}

async function readState(): Promise<State> {
  const { data, error } = await db.from("wanted_list_state").select("payload").eq("id", 1).maybeSingle();
  if (error) throw error;
  const p = data?.payload;
  if (!p || !Array.isArray(p.lists) || !Array.isArray(p.products) || !Array.isArray(p.history)) return empty();
  return p as State;
}

function getClientKey(req: Request): string {
  // Use only the Cloudflare client-IP header. Never fall back to
  // X-Forwarded-For, which can contain client-supplied values.
  // If the trusted gateway header is absent, use one shared bucket.
  const cfIp = req.headers.get("cf-connecting-ip")?.trim();
  return cfIp ? cfIp.slice(0, 80) : "unknown";
}

async function registerPinAttempt(ip: string): Promise<boolean> {
  const { data, error } = await db.rpc("wanted_list_register_pin_attempt", { p_ip_key: ip });
  if (error) throw error;
  return data === true;
}

async function clearPinFailures(ip: string): Promise<void> {
  const { error } = await db.rpc("wanted_list_clear_pin_attempts", { p_ip_key: ip });
  if (error) throw error;
}

async function validatePin(req: Request, supplied: unknown): Promise<boolean> {
  const ip = getClientKey(req);
  if (!(await registerPinAttempt(ip))) {
    throw new Response(JSON.stringify({ error: "PIN_RATE_LIMIT" }), {
      status: 429,
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  if (String(supplied ?? "") !== privatePin) return false;
  await clearPinFailures(ip);
  return true;
}

function validateState(value: unknown): State | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.lists) || !Array.isArray(v.products) || !Array.isArray(v.history)) return null;
  if (v.lists.length > MAX_LISTS || v.products.length > MAX_PRODUCTS || v.history.length > MAX_HISTORY) return null;
  if (![...v.lists, ...v.products, ...v.history].every((item) => item && typeof item === "object" && !Array.isArray(item))) return null;

  const ids = new Set<string>();
  for (const list of v.lists as AnyRecord[]) {
    if (typeof list.id !== "string" || !list.id || list.id.length > 128 || ids.has(list.id)) return null;
    ids.add(list.id);
    if (typeof list.name !== "string" || list.name.length > 200) return null;
    if (typeof list.desc === "string" && list.desc.length > 2000) return null;
    if (typeof list.image === "string" && list.image.length > 1_500_000) return null;
  }

  const productIds = new Set<string>();
  for (const product of v.products as AnyRecord[]) {
    if (typeof product.id !== "string" || !product.id || product.id.length > 128 || productIds.has(product.id)) return null;
    productIds.add(product.id);
    if (typeof product.name !== "string" || product.name.length > 300) return null;
    if (typeof product.store === "string" && product.store.length > 200) return null;
    if (typeof product.notes === "string" && product.notes.length > 5000) return null;
    if (typeof product.image === "string" && product.image.length > 1_500_000) return null;
    if (product.lists !== undefined && (!Array.isArray(product.lists) ||
      product.lists.length > MAX_LISTS || !product.lists.every((id) => typeof id === "string" && id.length <= 128))) return null;
    if (product.price !== undefined && (!Number.isFinite(Number(product.price)) || Number(product.price) < 0 || Number(product.price) > 1_000_000_000)) return null;
    if (product.url !== undefined && product.url !== "" && typeof product.url !== "string") return null;
  }
  for (const entry of v.history as AnyRecord[]) {
    if (typeof entry.productId !== "string" || entry.productId.length > 128) return null;
  }
  return {
    schemaVersion: Number.isInteger(v.schemaVersion) ? Number(v.schemaVersion) : 2,
    lists: v.lists as AnyRecord[],
    products: v.products as AnyRecord[],
    history: v.history as AnyRecord[],
  };
}

async function readLimitedJson(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw new Response("PAYLOAD_TOO_LARGE", { status: 413, headers: cors });
  if (!req.body) throw new Response("INVALID_JSON", { status: 400, headers: cors });

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Response("PAYLOAD_TOO_LARGE", { status: 413, headers: cors });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Response("INVALID_JSON", { status: 400, headers: cors });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    if (!supabaseUrl || !serviceKey) return json({ error: "SERVER_DATABASE_NOT_CONFIGURED" }, 500);
    if (!privatePin || privatePin.length < 16) return json({ error: "SERVER_PIN_NOT_CONFIGURED" }, 500);

    const body = await readLimitedJson(req) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "INVALID_REQUEST" }, 400);
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "load") {
      return json({ payload: publicView(await readState()) });
    }

    if (action === "unlock") {
      const valid = await validatePin(req, body.pin);
      if (!valid) return json({ error: "PIN_INVALID" }, 401);
      return json({ payload: await readState() });
    }

    if (action === "save") {
      const incoming = validateState(body.payload);
      if (!incoming) return json({ error: "INVALID_PAYLOAD" }, 400);

      // A non-empty PIN requests privileged replacement. Without it, the RPC
      // preserves all current private records while accepting public changes.
      const wantsPrivateWrite = typeof body.pin === "string" && body.pin.length > 0;
      let allowPrivate = false;
      if (wantsPrivateWrite) {
        allowPrivate = await validatePin(req, body.pin);
        if (!allowPrivate) return json({ error: "PIN_INVALID" }, 401);
      }

      const { error } = await db.rpc("wanted_list_save_state", {
        p_incoming: incoming,
        p_allow_private: allowPrivate,
      });
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("wanted-list-secure error:", error);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
});
