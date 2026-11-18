CREATE TABLE recovery_codes (
    hash TEXT PRIMARY KEY,
    user TEXT NOT NULL REFERENCES users(id),
    expires INTEGER NOT NULL
);
CREATE INDEX recovery_user ON recovery_codes(user);
