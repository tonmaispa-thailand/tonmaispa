-- 034_ai_credentials.sql
--
-- BYOK (bring-your-own-key) AI provider credentials. Instead of a fixed
-- MINIMAX_API_KEY env var, an owner/super_admin can point the whole AI stack
-- (chatbot, analytics, blog writing, translate, critique) at their own
-- Anthropic-compatible provider — MiniMax, Anthropic direct, or an OpenRouter
-- "Anthropic Skin" endpoint — by storing { base_url, model, api_key } here.
--
-- SECURITY — why this is a NEW table, not a site_content row:
-- site_content carries `public_read_site_content ... USING (true)` (002), so
-- the anon key that ships in the browser can read every row. An API key stored
-- there would leak to the public. This table follows the twilio_messages
-- precedent (021): RLS ENABLED with NO policies, so anon/authenticated clients
-- can reach nothing — only trusted server routes holding the service-role key
-- can read or write it. The key is never sent back to the browser; the Settings
-- UI shows a masked status only. With no row present, the app falls back to the
-- platform env MINIMAX_API_KEY (see lib/minimax.js).
--
-- Singleton: this is a single-tenant install, so one row (id = 1) holds the
-- active provider config. Writes upsert onto id = 1.

CREATE TABLE IF NOT EXISTS ai_credentials (
  id          smallint    PRIMARY KEY DEFAULT 1,
  -- Optional label for the UI preset that was used: minimax | anthropic |
  -- openrouter | custom. Purely descriptive — base_url is what actually routes.
  provider    text,
  base_url    text        NOT NULL,
  model       text        NOT NULL,
  api_key     text        NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Who last changed it (audit). SET NULL if that profile is later removed.
  updated_by  uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  -- Enforce a single active config row.
  CONSTRAINT ai_credentials_singleton CHECK (id = 1)
);

-- Same lockdown as twilio_messages (021): RLS on, zero policies. Anon and
-- authenticated clients get nothing; only the service-role key can read/write.
ALTER TABLE ai_credentials ENABLE ROW LEVEL SECURITY;
