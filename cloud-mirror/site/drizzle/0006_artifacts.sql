CREATE TABLE artifacts (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('markdown', 'html')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner, id),
  UNIQUE (owner, request_id)
);
--> statement-breakpoint
CREATE TABLE artifact_shares (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  PRIMARY KEY (owner, id),
  UNIQUE (owner, request_id),
  FOREIGN KEY (owner, artifact_id) REFERENCES artifacts(owner, id)
);
--> statement-breakpoint
CREATE INDEX artifact_shares_document ON artifact_shares(owner, artifact_id, created_at);
