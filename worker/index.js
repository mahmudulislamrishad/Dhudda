const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
});

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeJson(value) {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

async function signJwt(payload, secret) {
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const body = encodeJson(payload);
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${base64url(new Uint8Array(signature))}`;
}

function corsHeaders(origin, env) {
  const allowed = [
    "https://mahmudulislamrishad.github.io",
    ...(env.APP_ORIGIN || "")
      .split(",")
      .map(v => v.trim().replace(/\/+$/, ""))
  ];

  const cleanOrigin = origin.trim().replace(/\/+$/, "");

  if (!allowed.includes(cleanOrigin)) return {};

  return {
    "Access-Control-Allow-Origin": cleanOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      if (!cors["Access-Control-Allow-Origin"]) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "dhudda-hub-api" }, 200, cors);
    }

    if (url.pathname !== "/api/token" || request.method !== "POST") {
      return json({ error: "Not found" }, 404, cors);
    }

    if (!cors["Access-Control-Allow-Origin"]) {
      return json({ error: "Origin not allowed" }, 403);
    }

    const required = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "APP_ORIGIN"];
    for (const key of required) {
      if (!env[key]) return json({ error: `Server configuration missing: ${key}` }, 500, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, cors);
    }

    const roomName = String(body?.roomName || "").trim();
    const participantName = String(body?.participantName || "").trim();
    if (!/^[a-zA-Z0-9_-]{2,50}$/.test(roomName)) {
      return json({ error: "Room name invalid (2-50 letters, numbers, _ or -)." }, 400, cors);
    }
    if (!participantName || participantName.length > 30) {
      return json({ error: "Name is required (maximum 30 characters)." }, 400, cors);
    }

    const now = Math.floor(Date.now() / 1000);
    const identity = `guest_${crypto.randomUUID()}`;
    const claims = {
      iss: env.LIVEKIT_API_KEY,
      sub: identity,
      name: participantName,
      nbf: now - 5,
      exp: now + 600,
      video: {
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true
      }
    };

    try {
      const token = await signJwt(claims, env.LIVEKIT_API_SECRET);
      return json({ serverUrl: env.LIVEKIT_URL, token }, 200, cors);
    } catch (error) {
      console.error("Token signing failed", error);
      return json({ error: "Could not create call token." }, 500, cors);
    }
  }
};
