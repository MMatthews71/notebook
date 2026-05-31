// Basiq Open Banking proxy — Supabase Edge Function
// Deploy:  supabase functions deploy basiq --no-verify-jwt
// Secrets: supabase secrets set BASIQ_API_KEY=your_key_here
//
// Security model:
//   Every request must include X-Banking-Secret matching the value
//   stored in the basiq_secrets table for that userId.
//   The secret is generated once per device and never exposed in source code.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BASIQ_BASE    = "https://au-api.basiq.io";
const BASIQ_VERSION = "3.0";
const API_KEY       = Deno.env.get("BASIQ_API_KEY") ?? "";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// In-process token cache (lives for the duration of a warm instance)
let _cachedToken = "";
let _tokenExpiry = 0;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-banking-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Supabase admin client ────────────────────────────────────

function adminDb() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

// ── Secret validation ────────────────────────────────────────

async function validateSecret(userId: string, secret: string): Promise<boolean> {
  if (!userId || !secret) return false;
  const db = adminDb();
  const { data, error } = await db
    .from("basiq_secrets")
    .select("widget_secret")
    .eq("basiq_user_id", userId)
    .single();
  if (error || !data) return false;
  // Constant-time-ish comparison (good enough for a personal app)
  return data.widget_secret === secret;
}

async function storeSecret(userId: string, secret: string) {
  const db = adminDb();
  await db.from("basiq_secrets").upsert(
    { basiq_user_id: userId, widget_secret: secret, updated_at: new Date().toISOString() },
    { onConflict: "basiq_user_id" },
  );
}

// ── Basiq token ──────────────────────────────────────────────

async function getServerToken(): Promise<string> {
  const now = Date.now();
  if (_cachedToken && now < _tokenExpiry - 30_000) return _cachedToken;

  const res = await fetch(`${BASIQ_BASE}/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${API_KEY}`,
      "basiq-version": BASIQ_VERSION,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "scope=SERVER_ACCESS",
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Token request failed: ${JSON.stringify(data)}`);
  }
  _cachedToken = data.access_token as string;
  _tokenExpiry = now + (data.expires_in ?? 3600) * 1000;
  return _cachedToken;
}

// ── Basiq API helpers ────────────────────────────────────────

async function basiqGet(path: string, token: string) {
  const res = await fetch(`${BASIQ_BASE}${path}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "basiq-version": BASIQ_VERSION,
    },
  });
  return res.json();
}

async function basiqPost(path: string, token: string, body: unknown = {}) {
  const res = await fetch(`${BASIQ_BASE}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "basiq-version": BASIQ_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── Action handlers ──────────────────────────────────────────

// create_user is the ONLY action that doesn't require a pre-existing secret —
// it creates both the Basiq user and registers the secret atomically.
async function handleCreateUser(
  token: string,
  params: Record<string, string>,
) {
  const { widgetSecret, email = "user@notebook.local", firstName, lastName, mobile } = params;
  if (!widgetSecret) throw new Error("widgetSecret is required for create_user");

  const body: Record<string, string> = {};
  if (email)     body.email     = email;
  if (mobile)    body.mobile    = mobile;
  if (firstName) body.firstName = firstName;
  if (lastName)  body.lastName  = lastName;

  const data = await basiqPost("/users", token, body);
  if (!data.id) throw new Error(data.title ?? data.detail ?? "Failed to create Basiq user");

  // Store the device secret alongside the new userId
  await storeSecret(data.id, widgetSecret);
  return data;
}

async function handleAuthLink(token: string, params: Record<string, string>) {
  const { userId } = params;
  if (!userId) throw new Error("userId is required");
  return basiqPost(`/users/${userId}/auth_link`, token, {});
}

async function handleBalances(token: string, params: Record<string, string>) {
  const { userId } = params;
  if (!userId) throw new Error("userId is required");
  return basiqGet(`/users/${userId}/accounts`, token);
}

async function handleConnections(token: string, params: Record<string, string>) {
  const { userId } = params;
  if (!userId) throw new Error("userId is required");
  return basiqGet(`/users/${userId}/connections`, token);
}

// ── Main handler ─────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    if (!API_KEY) {
      return json(
        { error: "BASIQ_API_KEY secret not set. Run: supabase secrets set BASIQ_API_KEY=your_key" },
        500,
      );
    }

    const body = await req.json() as { action: string; [key: string]: string };
    const { action, ...params } = body;
    const incomingSecret = req.headers.get("x-banking-secret") ?? "";

    // create_user: no pre-existing userId to look up yet — the secret is
    // passed in the body and stored alongside the new userId.
    if (action === "create_user") {
      const token = await getServerToken();
      const result = await handleCreateUser(token, { ...params, widgetSecret: incomingSecret });
      return json(result);
    }

    // All other actions require a valid userId + matching secret.
    const { userId } = params;
    if (!userId) return json({ error: "userId is required" }, 400);
    if (!incomingSecret) return json({ error: "Missing X-Banking-Secret header" }, 401);

    const ok = await validateSecret(userId, incomingSecret);
    if (!ok) return json({ error: "Invalid or missing banking secret" }, 401);

    const token = await getServerToken();

    let result: unknown;
    switch (action) {
      case "auth_link":   result = await handleAuthLink(token, params);   break;
      case "balances":    result = await handleBalances(token, params);    break;
      case "connections": result = await handleConnections(token, params); break;
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }

    return json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[basiq]", msg);
    return json({ error: msg }, 500);
  }
});
