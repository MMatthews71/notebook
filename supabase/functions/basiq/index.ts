// Basiq Open Banking proxy — Supabase Edge Function
// Deploy: supabase functions deploy basiq --no-verify-jwt

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const BASIQ_BASE    = "https://au-api.basiq.io";
const BASIQ_VERSION = "3.0";
// The API key from the Basiq dashboard is already base64-encoded — use it directly
const API_KEY       = (Deno.env.get("BASIQ_API_KEY") ?? "").trim();

// In-process token cache
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

// Extract a readable message from Basiq's error format (list or plain)
function basiqErr(data: Record<string, unknown>): string {
  if (data.type === "list" && Array.isArray(data.data)) {
    const first = data.data[0] as Record<string, unknown>;
    return `${first?.title ?? "Error"}: ${first?.detail ?? JSON.stringify(first)}`;
  }
  return data.title as string ?? data.detail as string ?? JSON.stringify(data);
}

// ── Basiq token ───────────────────────────────────────────────

async function getServerToken(): Promise<string> {
  const now = Date.now();
  if (_cachedToken && now < _tokenExpiry - 30_000) return _cachedToken;

  const res = await fetch(`${BASIQ_BASE}/token`, {
    method: "POST",
    headers: {
      // API key from Basiq dashboard is already base64 — use directly as Basic value
      "Authorization": `Basic ${API_KEY}`,
      "basiq-version": BASIQ_VERSION,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "scope=SERVER_ACCESS",
  });

  const data = await res.json() as Record<string, unknown>;
  if (!data.access_token) {
    throw new Error(`Token failed: ${basiqErr(data)}`);
  }
  _cachedToken = data.access_token as string;
  _tokenExpiry = now + ((data.expires_in as number ?? 3600) * 1000);
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

// ── Main handler ──────────────────────────────────────────────

serve(async (req: Request) => {
  // CORS pre-flight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    if (!API_KEY) {
      return json({ error: "BASIQ_API_KEY secret not set" }, 500);
    }

    const body = await req.json() as { action: string; [key: string]: string };
    const { action, ...params } = body;

    // Debug action — returns key metadata without exposing the key
    if (action === "debug") {
      return json({
        keyLength: API_KEY.length,
        keyFirst4: API_KEY.slice(0, 4),
        keyLast4:  API_KEY.slice(-4),
      });
    }

    const token = await getServerToken();

    let result: unknown;

    switch (action) {
      case "create_user": {
        const email = params.email || "user@notebook.local";
        const b: Record<string, string> = { email };
        if (params.firstName) b.firstName = params.firstName;
        if (params.lastName)  b.lastName  = params.lastName;
        result = await basiqPost("/users", token, b);
        // If Basiq returned an error list, surface it clearly
        const r = result as Record<string, unknown>;
        if (!r.id) {
          return json({ error: basiqErr(r) }, 400);
        }
        break;
      }
      case "auth_link": {
        if (!params.userId) return json({ error: "userId required" }, 400);
        // mobile is required by Basiq to generate the connect link
        const authBody: Record<string, string> = {};
        if (params.mobile) authBody.mobile = params.mobile;
        result = await basiqPost(`/users/${params.userId}/auth_link`, token, authBody);
        break;
      }
      case "balances": {
        if (!params.userId) return json({ error: "userId required" }, 400);
        result = await basiqGet(`/users/${params.userId}/accounts`, token);
        break;
      }
      case "connections": {
        if (!params.userId) return json({ error: "userId required" }, 400);
        result = await basiqGet(`/users/${params.userId}/connections`, token);
        break;
      }
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
