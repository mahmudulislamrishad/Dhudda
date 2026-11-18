PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS activation_keys(
 key_hash TEXT PRIMARY KEY,
 key_type TEXT NOT NULL CHECK(key_type IN ('regular','vip')),
 created_at INTEGER NOT NULL,
 used_at INTEGER,
 used_device TEXT
);
CREATE TABLE IF NOT EXISTS users(
 id TEXT PRIMARY KEY,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL,
 is_verified INTEGER NOT NULL DEFAULT 0,
 device_id TEXT NOT NULL UNIQUE,
 public_key TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS friendships(
 id TEXT PRIMARY KEY,
 requester_id TEXT NOT NULL REFERENCES users(id),
 recipient_id TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL CHECK(status IN ('pending','accepted')),
 created_at INTEGER NOT NULL,
 UNIQUE(requester_id,recipient_id)
);
CREATE TABLE IF NOT EXISTS chat_tickets(
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 friendship_id TEXT NOT NULL REFERENCES friendships(id),
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_friend_recipient ON friendships(recipient_id,status);
CREATE INDEX IF NOT EXISTS idx_friend_requester ON friendships(requester_id,status);
