# DHUDDA HUB — Updated source & Cloudflare setup

এই build-এ তোমার ZIP-এর আগের LiveKit calling UI/code রেখে activation + profile + friend + private chat UI/backend যুক্ত করা হয়েছে।

## Cloudflare D1
1. Cloudflare Dashboard → Workers & Pages → D1 → Create database; নাম `dhudda-hub-db`।
2. `wrangler.toml`-এর `database_id`-এ ওই database-এর ID বসাও।
3. `npx wrangler d1 execute dhudda-hub-db --remote --file=worker/schema.sql`

## Worker configuration
`wrangler.toml`-এ `DB` ও `CHAT_ROOM` bindings এবং Durable Object migration আছে।
Worker secrets/vars:
- `LIVEKIT_URL` = তোমার LiveKit Cloud project-এর WSS URL
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `APP_ORIGIN` = `https://mahmudulislamrishad.github.io`
- `ADMIN_SECRET` = একটি দীর্ঘ random secret (secret হিসেবে সেট করবে)

Deploy করতে Wrangler CLI থেকে project directory-তে `npx wrangler deploy` চালাও। Worker URL বদলালে `app.js`-এর `API_BASE_URL`-ও বদলাতে হবে।

## Activation key তৈরি
Python 3 দিয়ে:
`python admin_keygen.py --regular 20 --vip 5`
এতে key list একবার terminal-এ দেখাবে এবং `dhudda-keys.sql` বানাবে। এরপর:
`npx wrangler d1 execute dhudda-hub-db --remote --file=dhudda-keys.sql`
Plaintext key নিরাপদে রাখবে; DB-তে শুধু SHA-256 hash থাকে।

## VIP revoke
POST `/api/vip-revoke`, header `X-Admin-Secret: <ADMIN_SECRET>`, JSON body `{"username":"account_name"}`। Admin secret কখনো frontend-এ রাখবে না।

## API routes
- `POST /api/activate` — key দিয়ে device activate এবং account তৈরি
- `GET /api/me`
- `GET /api/users?q=username`
- `GET /api/friends`
- `GET /api/requests`
- `POST /api/friend-request` — `{ "userId": "..." }`
- `POST /api/friend-accept` — `{ "requestId": "..." }`
- `POST /api/chat-ticket` — `{ "userId": "..." }`
- `GET /api/chat?ticket=...` — WebSocket relay; কেবল ciphertext payload forward করে
- `POST /api/vip-revoke` — admin-only

## গুরুত্বপূর্ণ সীমাবদ্ধতা ও নিরাপত্তা
- Chat-এর message body/history D1-এ লেখা হয় না; relay শুধু online WebSocket peers-এর মধ্যে ciphertext forward করে। দুইজন একই সময়ে online না থাকলে offline delivery নেই।
- Browser localStorage-এ private encryption key থাকে। Browser data clear/device হারালে private key হারাতে পারে।
- Encryption হলো WebCrypto ECDH P-256 + AES-GCM ভিত্তিক basic implementation; এটি Signal Protocol নয় এবং independent security audit করা হয়নি। Public-key authenticity/key verification, recovery, rotation, abuse controls ও rate limits আরও শক্ত করা দরকার।
- Device ID browser-generated; এটি hardware attestation নয়। Browser storage reset করলে নতুন device ID তৈরি হতে পারে।
- Activation key one-time; account creation-এ username/device conflict হলে key consumed হতে পারে।
- VIP badge server account metadata থেকে আসে; frontend একা verified status সেট করতে পারে না।
- Production deployment, D1 binding, Durable Object migration, LiveKit secrets এবং real two-device testing না হওয়া পর্যন্ত production-ready বলা যাবে না।
