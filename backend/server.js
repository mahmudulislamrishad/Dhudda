import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { AccessToken } from '@livekit/server-sdk';

const required = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'APP_ORIGIN'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin: process.env.APP_ORIGIN.split(',').map(v => v.trim()),
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '10kb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'dhudda-hub-api' }));

app.post('/api/token', async (req, res) => {
  try {
    const roomName = String(req.body?.roomName || '').trim();
    const participantName = String(req.body?.participantName || '').trim();

    if (!/^[a-zA-Z0-9_-]{2,50}$/.test(roomName)) {
      return res.status(400).json({ error: 'Room name invalid (2-50 letters, numbers, _ or -).' });
    }
    if (!participantName || participantName.length > 30) {
      return res.status(400).json({ error: 'Name is required (maximum 30 characters).' });
    }

    // Guest identity for initial beta. Before public launch, replace this with
    // a verified account/session identity and enforce room membership here.
    const identity = `guest_${randomUUID()}`;
    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { identity, name: participantName, ttl: '10m' }
    );
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    });

    return res.json({ serverUrl: process.env.LIVEKIT_URL, token: await token.toJwt() });
  } catch (error) {
    console.error('Token issue failed:', error);
    return res.status(500).json({ error: 'Could not create call token.' });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => console.log(`DHUDDA HUB API listening on ${port}`));
