-- The singleton admin credential stores only the PBKDF2 hash, never a raw password.
CREATE TABLE IF NOT EXISTS filtrox_admin_credentials (
    account_key VARCHAR(16) PRIMARY KEY CHECK (account_key = 'owner'),
    password_hash TEXT NOT NULL CHECK (char_length(password_hash) BETWEEN 50 AND 200),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
