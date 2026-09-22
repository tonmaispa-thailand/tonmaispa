import { requireAdmin } from '@/lib/require-admin'
import { buildPeakTimesGrid } from '@/lib/peak-times'

// GET /api/admin/reports/peak-times?startDate&endDate
//
// A day-of-week × hour-of-day heatmap of booking VOLUME (demand), for shift
// planning — "when do we actually get busy", not "when did we get paid".
// Uses confirmed+completed (occupied a real slot), the same status set
// getTherapistUtilizationSummary already uses for "booked" time, deliberately
// NOT the completed-only rule the Revenue/Guests/Add-Ons tabs use — a
// confirmed-but-not-yet-completed booking still occupied a slot and is exactly
// the kind of demand a staffing decision needs to see. Grid-building itself
// (incl. the day-of-week date math) lives in lib/peak-times.js, unit-tested
// directly (scripts/test-peak-times.mjs) the same way lib/report-ranges.js is.
export async function GET(req) {
  const auth = await requireAdmin()
  if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(req.url)
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return Response.json({ error: 'startDate and endDate (YYYY-MM-DD) are required' }, { status: 400 })
  }
  if (startDate > endDate) {
    return Response.json({ error: 'startDate must not be after endDate' }, { status: 400 })
  }

  const { data, error } = await auth.admin.from('bookings')
    .select('date, time_slot')
    .in('status', ['confirmed', 'completed'])
    .gte('date', startDate).lte('date', endDate)
  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json(buildPeakTimesGrid(data ?? []))
}
