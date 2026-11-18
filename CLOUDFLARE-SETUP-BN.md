# DHUDDA HUB — Cloudflare Worker setup

এই Worker GitHub repository root থেকে deploy করার জন্য। Cloudflare setup screen-এ **Path `/`**, **Build command খালি**, **Deploy command `npx wrangler deploy`** রাখুন। `wrangler.toml` root-এ আছে এবং entry point `worker/index.js`।

## Deploy-এর পরে Secrets / Variables
Cloudflare Worker → Settings → Variables and Secrets-এ নিচেরগুলো যোগ করুন:

- `LIVEKIT_URL` — LiveKit project-এর WebSocket URL (যেমন `wss://...`)
- `LIVEKIT_API_KEY` — LiveKit API key
- `LIVEKIT_API_SECRET` — LiveKit API secret (**Secret হিসেবে encrypt করুন**)
- `APP_ORIGIN` — `https://mahmudulislamrishad.github.io` (শুধু origin, শেষে `/` নয়)

কোনো Secret GitHub-এ commit করবেন না।

## Frontend connection
Deploy সফল হলে Worker-এর `https://...workers.dev` URL কপি করুন। `app.js`-এর `API_BASE_URL`-এ সেই URL বসিয়ে GitHub-এ commit করুন।

## Test
Browser-এ `https://YOUR-WORKER-URL/health` খুললে `{ "ok": true, ... }` আসা উচিত।

## Important limitations
এই Worker guest token issue করে; production public launch-এর আগে verified login, room authorization, abuse controls এবং stronger rate limiting যোগ করতে হবে। PWA/Picture-in-Picture সব Android device-এ background camera/mic চালু রাখার নিশ্চয়তা দেয় না। নির্ভরযোগ্য background calling-এর জন্য আলাদা native Android app/service এবং platform testing এখনো প্রয়োজন। এই ZIP APK নয়।
