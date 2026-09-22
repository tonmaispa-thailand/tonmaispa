-- ============================================================
-- TON MAI SPA — Manually featured treatments (booking "Top 5")
-- Run this manually in the Supabase SQL Editor.
--
-- The booking widget's "Choose a treatment" step does NOT list every service —
-- it shows a FIVE-item shortlist (BookingEngine.jsx → `bestSellingTreatments`).
-- That shortlist is ranked AUTOMATICALLY by real booking volume over a rolling
-- 45-day window (see /api/bookings/popular-treatments), with the curated
-- `sort_order` only breaking ties or filling the remaining gaps.
--
-- The gap that motivates this column: the owner cannot deliberately put a
-- chosen treatment in front of guests. A brand-new signature service — or one
-- they simply want to push this month — has no booking history, so it can
-- never crack the auto Top 5 on its own.
--
-- `is_featured` is the manual override: a ticked treatment is PINNED into the
-- shortlist ahead of the auto-ranked ones. The remaining slots (up to five
-- total) are still auto-filled by booking volume, so this is ADDITIVE — it does
-- not replace the popularity logic, it just seeds it.
--
-- Naming: reuses the same flag name already established on blog_posts
-- (024_blog_posts.sql → `is_featured`) so "featured = hand-picked to surface"
-- means one consistent thing across the schema.
--
-- Behavioural no-op on its own: NOT NULL DEFAULT false backfills every existing
-- row to false, so with nothing ticked the Top 5 is computed exactly as today.
-- ============================================================

ALTER TABLE spa_treatments
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;
