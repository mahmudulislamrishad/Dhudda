const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
});

const encoder = new TextEncoder();
const ITERATIONS = 100000;

function base64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function passwordHash(password, saltText) {
  const salt = saltText ? fromBase64url(saltText) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt,
    iterations: ITERATIONS,
    hash: "SHA-256"
  }, key, 256);

  return { salt: saltText || base64url(salt), hash: toHex(bits) };
}

function encodeJson(value) {
  return base64url(encoder.encode(JSON.stringify(value)));
}

async function makeJwt(payload, secret) {
  const head = encodeJson({ alg: "HS256", typ: "JWT" });
  const body = encodeJson(payload);
  const unsigned = `${head}.${body}`;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(unsigned));
  return `${unsigned}.${base64url(signature)}`;
}

function cors(origin, env) {
  const allowed = [
    "https://mahmudulislamrishad.github.io",
    ...(env.APP_ORIGIN || "").split(",").map(x => x.trim().replace(/\/+$/, ""))
  ];

  if (!origin || !allowed.includes(origin.replace(/\/+$/, ""))) return {};

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Admin-Secret",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function run(env, sql, ...values) {
  return env.DB.prepare(sql).bind(...values).run();
}

async function getAuth(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;

  return env.DB.prepare(
    "SELECT u.id,u.username,u.display_name,u.is_verified,u.public_key FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?"
  ).bind(await sha256(token), Date.now()).first();
}

function newSessionToken() {
  return crypto.randomUUID() + crypto.randomUUID();
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = cors(origin, env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: headers["Access-Control-Allow-Origin"] ? 204 : 403,
        headers
      });
    }

    if (origin && !headers["Access-Control-Allow-Origin"]) {
      return json({ error: "Origin not allowed" }, 403, headers);
    }

    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, service: "dhudda-hub-api" }, 200, headers);
      }

      // Audio / Video call token
      if (url.pathname === "/api/token" && request.method === "POST") {
        for (const name of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]) {
          if (!env[name]) {
            return json({ error: `Server configuration missing: ${name}` }, 500, headers);
          }
        }

        const body = await readBody(request);
        const room = String(body?.roomName || "").trim();
        const name = String(body?.participantName || "").trim();

        if (!/^[a-zA-Z0-9_-]{2,50}$/.test(room) || !name || name.length > 30) {
          return json({ error: "Invalid room or participant name" }, 400, headers);
        }

        const now = Math.floor(Date.now() / 1000);
        const claims = {
          iss: env.LIVEKIT_API_KEY,
          sub: `guest_${crypto.randomUUID()}`,
          name,
          nbf: now - 5,
          exp: now + 600,
          video: {
            roomJoin: true,
            room,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true
          }
        };

        return json({
          serverUrl: env.LIVEKIT_URL,
          token: await makeJwt(claims, env.LIVEKIT_API_SECRET)
        }, 200, headers);
      }

      // Registration
      if (url.pathname === "/api/activate" && request.method === "POST") {
        const body = await readBody(request);

        const key = String(body?.key || "").trim().toUpperCase();
        const device = String(body?.deviceId || "");
        const username = String(body?.username || "").trim().toLowerCase();
        const display = String(body?.displayName || "").trim();
        const password = String(body?.password || "");
        const publicKey = String(body?.publicKey || "");

        if (!/^DH-[A-Z0-9]{5}(?:-[A-Z0-9]{5}){3}$/.test(key)) {
          return json({ error: "Activation Key format সঠিক নয়।" }, 400, headers);
        }

        if (!/^[a-f0-9-]{50,80}$/i.test(device)) {
          return json({ error: "Device information invalid." }, 400, headers);
        }

        if (!/^[a-z0-9_]{3,20}$/.test(username)) {
          return json({ error: "Username 3-20 characters হতে হবে।" }, 400, headers);
        }

        if (!display || display.length > 40) {
          return json({ error: "Display Name 1-40 characters হতে হবে।" }, 400, headers);
        }

        if (password.length < 8 || password.length > 128) {
          return json({ error: "Password কমপক্ষে 8 characters হতে হবে।" }, 400, headers);
        }

        if (publicKey.length < 20 || publicKey.length > 1200) {
          return json({ error: "Public key invalid." }, 400, headers);
        }

        const duplicate = await env.DB.prepare(
          "SELECT id FROM users WHERE username=? COLLATE NOCASE OR device_id=? LIMIT 1"
        ).bind(username, device).first();

        if (duplicate) {
          return json({ error: "এই Username অথবা Device দিয়ে আগে Account তৈরি হয়েছে।" }, 409, headers);
        }

        const passwordData = await passwordHash(password);
        const keyHash = await sha256(key);

        const claim = await env.DB.prepare(
          "UPDATE activation_keys SET used_at=?,used_device=? WHERE key_hash=? AND used_at IS NULL RETURNING key_type"
        ).bind(Date.now(), device, keyHash).all();

        if (!claim.results?.length) {
          return json({ error: "Activation Key invalid অথবা আগে ব্যবহার হয়েছে।" }, 400, headers);
        }

        const userId = crypto.randomUUID();
        const token = newSessionToken();
        const now = Date.now();
        const keyType = claim.results[0].key_type;

        try {
          await run(env,
            "INSERT INTO users(id,username,display_name,is_verified,device_id,public_key,created_at,password_salt,password_hash) VALUES(?,?,?,?,?,?,?,?,?)",
            userId, username, display, keyType === "vip" ? 1 : 0,
            device, publicKey, now, passwordData.salt, passwordData.hash
          );

          await run(env,
            "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
            await sha256(token), userId, now + 2592000000
          );
        } catch (error) {
          console.error("Account creation failed:", error);

          await run(env,
            "UPDATE activation_keys SET used_at=NULL,used_device=NULL WHERE key_hash=? AND used_device=?",
            keyHash, device
          ).catch(() => {});

          return json({
            error: "Account তৈরি হয়নি। Username আগে ব্যবহৃত হলে অন্য Username দিন।"
          }, 500, headers);
        }

        return json({
          token,
          user: {
            id: userId,
            username,
            display_name: display,
            is_verified: keyType === "vip" ? 1 : 0,
            public_key: publicKey
          }
        }, 200, headers);
      }

      // Login
      if (url.pathname === "/api/login" && request.method === "POST") {
        const body = await readBody(request);
        const username = String(body?.username || "").trim().toLowerCase();
        const password = String(body?.password || "");

        if (!username || !password) {
          return json({ error: "Username এবং Password দিন।" }, 400, headers);
        }

        const user = await env.DB.prepare(
          "SELECT id,username,display_name,is_verified,public_key,password_salt,password_hash FROM users WHERE username=? COLLATE NOCASE"
        ).bind(username).first();

        if (!user || !user.password_salt || !user.password_hash) {
          return json({ error: "Username অথবা Password ভুল।" }, 401, headers);
        }

        const check = await passwordHash(password, user.password_salt);

        if (check.hash !== user.password_hash) {
          return json({ error: "Username অথবা Password ভুল।" }, 401, headers);
        }

        const token = newSessionToken();

        await run(env,
          "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
          await sha256(token), user.id, Date.now() + 2592000000
        );

        return json({
          token,
          user: {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            is_verified: user.is_verified,
            public_key: user.public_key
          }
        }, 200, headers);
      }
            // VIP revoke
      if (url.pathname === "/api/vip-revoke" && request.method === "POST") {
        if (!env.ADMIN_SECRET || request.headers.get("X-Admin-Secret") !== env.ADMIN_SECRET) {
          return json({ error: "Forbidden" }, 403, headers);
        }

        const body = await readBody(request);
        const username = String(body?.username || "").trim().toLowerCase();

        if (!username) {
          return json({ error: "Username required" }, 400, headers);
        }

        const result = await run(env,
          "UPDATE users SET is_verified=0 WHERE username=?",
          username
        );

        return json({ ok: result.meta.changes === 1 }, 200, headers);
      }

      const me = await getAuth(request, env);

      if (!me) {
        return json({ error: "Login required" }, 401, headers);
      }

      if (url.pathname === "/api/me" && request.method === "GET") {
        return json({ user: me }, 200, headers);
      }

      // Search users
      if (url.pathname === "/api/users" && request.method === "GET") {
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();

        if (q.length < 2) {
          return json({ users: [] }, 200, headers);
        }

        const result = await env.DB.prepare(
          "SELECT id,username,display_name,is_verified,public_key FROM users WHERE username LIKE ? AND id<>? LIMIT 20"
        ).bind(`%${q}%`, me.id).all();

        return json({ users: result.results }, 200, headers);
      }

      // Friends
      if (url.pathname === "/api/friends" && request.method === "GET") {
        const result = await env.DB.prepare(
          "SELECT u.id,u.username,u.display_name,u.is_verified,u.public_key FROM friendships f JOIN users u ON u.id=CASE WHEN f.requester_id=? THEN f.recipient_id ELSE f.requester_id END WHERE (f.requester_id=? OR f.recipient_id=?) AND f.status='accepted'"
        ).bind(me.id, me.id, me.id).all();

        return json({ friends: result.results }, 200, headers);
      }

      // Friend requests
      if (url.pathname === "/api/requests" && request.method === "GET") {
        const result = await env.DB.prepare(
          "SELECT f.id,u.id AS user_id,u.username,u.display_name,u.is_verified FROM friendships f JOIN users u ON u.id=f.requester_id WHERE f.recipient_id=? AND f.status='pending'"
        ).bind(me.id).all();

        return json({ requests: result.results }, 200, headers);
      }

      if (url.pathname === "/api/friend-request" && request.method === "POST") {
        const body = await readBody(request);
        const target = String(body?.userId || "");

        if (!target || target === me.id) {
          return json({ error: "Invalid user" }, 400, headers);
        }

        const other = await env.DB.prepare(
          "SELECT id FROM users WHERE id=?"
        ).bind(target).first();

        if (!other) {
          return json({ error: "User not found" }, 404, headers);
        }

        try {
          await run(env,
            "INSERT INTO friendships(id,requester_id,recipient_id,status,created_at) VALUES(?,?,?,'pending',?)",
            crypto.randomUUID(), me.id, target, Date.now()
          );
        } catch {
          return json({ error: "Friend request already exists or you are already friends" }, 409, headers);
        }

        return json({ ok: true }, 200, headers);
      }

      if (url.pathname === "/api/friend-accept" && request.method === "POST") {
        const body = await readBody(request);
        const requestId = String(body?.requestId || "");

        const result = await run(env,
          "UPDATE friendships SET status='accepted' WHERE id=? AND recipient_id=? AND status='pending'",
          requestId, me.id
        );

        return json({ ok: result.meta.changes === 1 }, 200, headers);
      }

      // Chat ticket
      if (url.pathname === "/api/chat-ticket" && request.method === "POST") {
        const body = await readBody(request);
        const other = String(body?.userId || "");

        const friendship = await env.DB.prepare(
          "SELECT id FROM friendships WHERE status='accepted' AND ((requester_id=? AND recipient_id=?) OR (requester_id=? AND recipient_id=?))"
        ).bind(me.id, other, other, me.id).first();

        if (!friendship) {
          return json({ error: "Friends only" }, 403, headers);
        }

        const ticket = newSessionToken();

        await run(env,
          "INSERT INTO chat_tickets(token_hash,user_id,friendship_id,expires_at) VALUES(?,?,?,?)",
          await sha256(ticket), me.id, friendship.id, Date.now() + 60000
        );

        return json({ ticket }, 200, headers);
      }

      
      // WebSocket chat - ticket authentication
      if (url.pathname === "/api/chat" && request.method === "GET") {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
          return json({ error: "WebSocket required" }, 426, headers);
        }

        const ticket = url.searchParams.get("ticket") || "";
        if (!ticket) {
          return json({ error: "Ticket required" }, 401, headers);
        }

        const ticketHash = await sha256(ticket);

        const record = await env.DB.prepare(
          "SELECT user_id, friendship_id FROM chat_tickets WHERE token_hash=? AND expires_at>?"
        ).bind(ticketHash, Date.now()).first();

        if (!record) {
          return json({ error: "Invalid or expired chat ticket" }, 401, headers);
        }

        await run(env, "DELETE FROM chat_tickets WHERE token_hash=?", ticketHash);

        const forwardUrl = new URL(request.url);
        forwardUrl.protocol = "https:";
        forwardUrl.hostname = "chat.internal";
        forwardUrl.pathname = "/connect";
        forwardUrl.search = "";

        const forwardRequest = new Request(forwardUrl.toString(), request);
        forwardRequest.headers.set("X-User-Id", record.user_id);

        return env.CHAT_ROOM
          .get(env.CHAT_ROOM.idFromName(record.friendship_id))
          .fetch(forwardRequest);
      }


      return json({ error: "Not found" }, 404, headers);

    } catch (error) {
      console.error("Worker request failed:", error?.stack || error);
      return json({ error: "Server error" }, 500, headers);
    }
  }
};

export class ChatRoom {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      userId: request.headers.get("X-User-Id") || ""
    });

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  webSocketMessage(socket, message) {
    if (typeof message !== "string" || message.length > 16000) {
      socket.close(1009, "Message too large");
      return;
    }

    let packet;

    try {
      packet = JSON.parse(message);
    } catch {
      socket.close(1003, "Invalid JSON");
      return;
    }

    if (
      packet.type !== "ciphertext" ||
      typeof packet.data !== "string" ||
      packet.data.length > 14000
    ) {
      socket.close(1008, "Encrypted payload only");
      return;
    }

    for (const peer of this.ctx.getWebSockets()) {
      if (peer !== socket) {
        try {
          peer.send(JSON.stringify({
            type: "ciphertext",
            data: packet.data
          }));
        } catch {}
      }
    }
  }

  webSocketClose(socket) {
    try {
      socket.close();
    } catch {}
  }
}
