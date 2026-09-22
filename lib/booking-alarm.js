// Shared query behind the new-booking alarm — used by both
// app/api/admin/bookings/alarm/route.js (polled client-side) and
// app/dashboard/layout.jsx (server-rendered initial state, so the alarm bar
// never flashes empty-then-populated on first paint). One implementation so
// the two can never drift on what "needs the alarm" means.
import { getSettingsMap } from './site-settings'
import { nowInSpaTz } from './scheduling'

export async function getAlarmState(admin) {
  // Scoped to today-or-future dates only — a pending booking for a date
  // that's already passed can no longer be walked in for, so it's stale
  // data needing cleanup, not something to blare an alarm over. Also means
  // this feature doesn't retroactively alarm over a backlog of old pending
  // bookings the moment it ships (every pre-existing row backfilled
  // staff_created=false, since the column didn't exist before — see
  // migration 036).
  const { date: today } = nowInSpaTz()

  const [{ data, error }, settings] = await Promise.all([
    admin.from('bookings')
      .select('id, ref_code, guest_name, guest_phone, date, time_slot, duration, spa_treatments(name)')
      .eq('status', 'pending')
      .eq('staff_created', false)
      .gte('date', today)
      .order('created_at', { ascending: true })
      .limit(50),
    getSettingsMap(admin, ['settings.booking_alarm_enabled', 'settings.booking_alarm_volume']),
  ])
  if (error) throw error

  // Clamped + NaN-guarded here, once, so every consumer (this API route and
  // the dashboard layout's server-rendered initial state) always gets a
  // playable number regardless of what's actually stored — a malformed or
  // out-of-range value_text must never crash the client-side AudioContext.
  // Number(null) and Number('') both coerce to 0 (finite), not NaN — so a
  // missing/null/empty value_text must be treated as "no value" BEFORE the
  // Number() coercion, or it would silently resolve to 0 (mute) instead of
  // the documented 70 default. An explicit "0" (a deliberate mute set via
  // the settings slider) still passes through as 0 — only a genuinely
  // absent/blank value_text falls back.
  const rawText = settings['settings.booking_alarm_volume']
  const rawVolume = rawText === null || rawText === undefined || String(rawText).trim() === '' ? NaN : Number(rawText)
  const volume = Number.isFinite(rawVolume) ? Math.max(0, Math.min(100, rawVolume)) : 70

  return {
    bookings: data ?? [],
    enabled: settings['settings.booking_alarm_enabled'] !== 'false', // missing row = on (matches the migration's own seeded default)
    volume,
  }
}
