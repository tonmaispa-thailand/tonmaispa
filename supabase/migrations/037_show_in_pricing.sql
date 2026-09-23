-- ============================================================
-- TON MAI SPA — "Show in Pricing" flag
-- Run this manually in the Supabase SQL Editor.
--
-- The homepage's "Simple, inclusive pricing" section (PricingSection.jsx)
-- has, until now, shown exactly two HARDCODED cards (Sauna Day Pass, Ice
-- Bath add-on) sourced from settings.* prices, not from spa_treatments at
-- all — it's the one homepage section with no admin tick-box wired to it.
--
-- `show_in_pricing` fills that gap: an owner can pin up to 3 treatments
-- (in practice, `category='package'` items — a Package already has ONE
-- flat price per row, matching this section's single-price card format;
-- a regular massage's multi-duration pricing wouldn't fit it cleanly) to
-- appear here, alongside the two existing static cards.
--
-- Same naming/capping pattern as migration 035's `is_featured` (booking
-- Top 5): a boolean flag + a small hard cap enforced in the API (3 here,
-- vs. 5 there — this section's grid reads best with a handful of big,
-- simple offers, not a long list), NOT a fixed-size array or a join table.
--
-- Behavioural no-op on its own: NOT NULL DEFAULT false backfills every
-- existing row to false, so the homepage renders exactly as it does today
-- until an owner actually ticks something.
-- ============================================================

ALTER TABLE spa_treatments
  ADD COLUMN IF NOT EXISTS show_in_pricing boolean NOT NULL DEFAULT false;
