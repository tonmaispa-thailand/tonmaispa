import { requireAdmin } from '@/lib/require-admin'

const MAX_ROWS = 1000

// GET /api/admin/reports/bookings?startDate&endDate&status&source&treatmentId&therapistId
// Filtered, exportable booking list for a period. Server-side filtering
// (not client-side over a pre-fetched list, like the Treatments admin page
// does) because a report period can span a year of bookings.
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

  const status = searchParams.get('status')
  const source = searchParams.get('source')
  const treatmentId = searchParams.get('treatmentId')
  const therapistId = searchParams.get('therapistId')

  // Disambiguated embed: bookings has TWO FKs to therapists (therapist_id +
  // secondary_therapist_id), so an unqualified therapists(name) fails with
  // PGRST201 (ambiguous embed) — same fix as app/dashboard/bookings/page.jsx
  // and app/api/admin/bookings/[id]/route.js.
  // Fetch one extra row past the cap so "did we truncate" can't false-positive
  // when the real result set lands exactly on MAX_ROWS (an earlier version
  // used `data.length === MAX_ROWS`, which reported truncated=true even when
  // that WAS the whole result — no 1001st row to prove more existed).
  let query = auth.admin.from('bookings')
    .select('id, ref_code, guest_name, date, time_slot, duration, price, status, source, spa_treatments(name), therapists!bookings_therapist_id_fkey(name)')
    .gte('date', startDate).lte('date', endDate)
    .order('date', { ascending: false }).order('time_slot', { ascending: false })
    .limit(MAX_ROWS + 1)

  if (status) query = query.eq('status', status)
  if (source) query = query.eq('source', source)
  if (treatmentId) query = query.eq('treatment_id', treatmentId)
  if (therapistId) query = query.eq('therapist_id', therapistId)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 400 })

  const rows = data ?? []
  const truncated = rows.length > MAX_ROWS
  return Response.json({ bookings: truncated ? rows.slice(0, MAX_ROWS) : rows, truncated })
}
