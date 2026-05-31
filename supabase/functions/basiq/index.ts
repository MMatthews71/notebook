// Basiq Open Banking proxy — Supabase Edge Function
// Deploy:  supabase functions deploy basiq
// Secret:  supabase secrets set BASIQ_API_KEY=your_key_here
//
// The API key is the base64-encoded credential string from basiq.io dashboard.
// It is used verbatim in the Authorization: Basic header.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const BASIQ_BASE = "https://au-api.basiq.io";
const BASIQ_VERSION = "3.0";
const API_KEY = Deno.env.get("BASIQ_API_KEY") ?? "";

// In-memory token cache (reused within the same function instance lifetime)
let _cachedToken: string | null = null;
let _tokenExpiry = 0;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Token ────────────────────────────────────────────────────

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

// ── Basiq API helpers ─────────────────────────────────────────

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

// ── Action handlers ───────────────────────────────────────────

async function handleCreateUser(token: string, params: Record<string, string>) {
  // email is required by Basiq; mobile is an alternative
  if (!params.email && !params.mobile) {
    params.email = "user@notebook.local";
  }
  const body: Record<string, string> = {};
  if (params.email)     body.email     = params.email;
  if (params.mobile)    body.mobile    = params.mobile;
  if (params.firstName) body.firstName = params.firstName;
  if (params.lastName)  body.lastName  = params.lastName;

  return basiqPost("/users", token, body);
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

// ── Main handler ──────────────────────────────────────────────

serve(async (req: Request) => {
  // CORS pre-flight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json() as { action: string; [key: string]: string };
    const { action, ...params } = body;

    if (!API_KEY) {
      return json({ error: "BASIQ_API_KEY secret not configured. Run: supabase secrets set BASIQ_API_KEY=your_key" }, 500);
    }

    const token = await getServerToken();

    let result: unknown;
    switch (action) {
      case "create_user":
        result = await handleCreateUser(token, params);
        break;
      case "auth_link":
        result = await handleAuthLink(token, params);
        break;
      case "balances":
        result = await handleBalances(token, params);
        break;
      case "connections":
        result = await handleConnections(token, params);
        break;
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
