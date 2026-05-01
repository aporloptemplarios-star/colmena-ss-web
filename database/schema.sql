CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  discord_username TEXT NOT NULL,
  discord_id TEXT NOT NULL UNIQUE,
  server_name TEXT NOT NULL,
  server_discord_invite TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  terms_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  ss_policy_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL CHECK (plan IN ('SCANER', 'MONTHLY_SERVER')),
  payment_status TEXT NOT NULL DEFAULT 'PENDING',
  stripe_session_id TEXT,
  stripe_customer_id TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'eur',
  discord_invite_code TEXT,
  discord_joined BOOLEAN NOT NULL DEFAULT FALSE,
  role_assigned BOOLEAN NOT NULL DEFAULT FALSE,
  owner_notified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT
);
