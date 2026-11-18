# DHUDDA HUB API (pre-production)

This service signs short-lived LiveKit room tokens. Keep `LIVEKIT_API_SECRET` only in the hosting provider's private environment variables. Never commit `.env` or secrets to GitHub.

## Deploy
1. Create a separate service from this repository.
2. Set the service root directory to `backend`.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `APP_ORIGIN` as private environment variables. `APP_ORIGIN` must exactly match the GitHub Pages origin, without a trailing slash.
6. After deployment, test `/health`.
7. Put the deployed API base URL in `API_BASE_URL` at the top of the root `app.js` and redeploy GitHub Pages.

## Important launch blocker
The current endpoint creates guest tokens from a supplied display name. It has CORS and basic rate limiting, but it is **not full production authentication** and does not prevent arbitrary guests from joining a room if they know its name. Before a public launch, add verified user login, room invitations/membership checks, abuse controls, and persistent distributed rate limiting. The in-memory rate limiter is suitable only for a small beta.
