CREATE TABLE IF NOT EXISTS vc_time (
  guild_id TEXT,
  user_id TEXT,
  total_ms INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS warnings (
  guild_id TEXT,
  user_id TEXT,
  count INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS bad_words (
  guild_id TEXT,
  word TEXT
);
