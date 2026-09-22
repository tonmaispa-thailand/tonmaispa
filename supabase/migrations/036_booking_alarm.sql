-- ============================================================
-- TON MAI SPA — Booking alarm: who created this booking
-- Run this manually in the Supabase SQL Editor.
--
-- New feature: while the dashboard is open, an audio alarm loops for any
-- booking that arrived WITHOUT a staff member already knowing about it —
-- guest-placed online bookings and chatbot bookings — until staff presses
-- Confirm or Cancel. A booking staff enters themselves (phone call,
-- walk-in) must NEVER trigger it, since staff is the one typing it in.
--
-- WHY A NEW COLUMN, not deriving this from existing fields: neither
-- `status` nor `source` is a reliable enough signal on its own.
--   - `status`: the dashboard's own "add booking" form defaults to
--     'confirmed' but still exposes a status dropdown — a staff member
--     COULD pick 'pending' for a walk-in they're entering right now, and
--     that must still never alarm.
--   - `source`: 'chatbot' is set both when the AI books a guest directly
--     (app/lib/chat-booking.js — should alarm) AND when a staff member
--     manually creates a booking FROM a chat conversation view
--     (app/dashboard/bookings/BookingsClient.jsx's prefill.fromConversation
--     — must NOT alarm). The value alone can't tell those apart.
-- `staff_created` instead records WHO/WHICH PATH actually inserted the row:
-- true only from POST /api/admin/bookings (behind requireAdmin, i.e. a
-- logged-in staff member submitting the dashboard's own create-booking
-- form), false everywhere else (default) — the public POST /api/bookings
-- route and the chatbot's booking-confirmation path never set it.
--
-- Behavioural no-op on its own: every existing booking backfills to false,
-- which is correct — none of them were created through the new
-- staff_created=true code path (added in the same change as this column).
-- ============================================================

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS staff_created boolean NOT NULL DEFAULT false;

-- Settings the alarm reads (site_content, same pattern as every other
-- settings.* toggle). Defaulted ON at a moderate volume since this feature
-- is being added because the owner wants it working immediately — not an
-- opt-in nobody will discover. Both keys are on the OWNER_ALLOWED_KEYS list
-- in app/dashboard/settings/SettingsClient.jsx (and enforced again in
-- app/api/admin/settings/route.js), same as settings.maintenance_mode —
-- so both `owner` and `super_admin` can change them, unlike most other
-- settings.* keys which are super_admin-only.
INSERT INTO site_content (key, value_text, page)
VALUES
  ('settings.booking_alarm_enabled', 'true', 'settings'),
  ('settings.booking_alarm_volume',  '70',   'settings')
ON CONFLICT (key) DO NOTHING;
