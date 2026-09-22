import { requireAdmin } from '@/lib/require-admin'
import { getAlarmState } from '@/lib/booking-alarm'

// GET /api/admin/bookings/alarm — polled by every open dashboard tab
// (app/dashboard/layout.jsx renders the alarm player for every logged-in
// role, not just owner/super_admin — the SETTINGS to turn it on/off and set
// the volume are owner/super_admin-only, per app/api/admin/settings, but the
// alarm itself is an operational alert every staff member needs to hear).
//
// A booking needs the alarm when it's `pending` AND was NOT staff_created
// (migration 036) — i.e. it arrived from the public site or the chatbot
// without any staff member already knowing about it. Confirming or
// cancelling a booking (PATCH /api/admin/bookings/[id]) changes its status
// away from 'pending', which is the only thing that removes it from this
// list — there is no separate "snooze"/dismiss. Query logic lives in
// lib/booking-alarm.js, shared with the dashboard layout's initial render.
export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })

  try {
    return Response.json(await getAlarmState(auth.admin))
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 })
  }
}
