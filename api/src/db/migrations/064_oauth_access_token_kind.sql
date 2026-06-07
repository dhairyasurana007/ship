-- Add token_kind to oauth_access_tokens for bearer auth and machine-token handling
-- This is a backfill migration because 058_oauth_tokens.sql may already be applied.

ALTER TABLE oauth_access_tokens
  ADD COLUMN IF NOT EXISTS token_kind TEXT NOT NULL DEFAULT 'user';
