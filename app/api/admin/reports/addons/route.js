import { requireAdmin } from '@/lib/require-admin'

// GET /api/admin/reports/addons?startDate&endDate
//
// booking_addons has no date/status of its own — every row is scoped to the
// period by joining its parent booking. `bookings!inner(...)` (inner join,
// not the default left join) is PostgREST's way to make filters on an
// embedded table's columns restrict the OUTER query. booking_addons is
// currently empty in production (the add-on upsell in BookingEngine hasn't
// been used yet), so this was verified with two throwaway rows attached to
// real existing bookings — one inside a test date range, one outside — and
// confirmed the query returned only the in-range row before both throwaway
// rows were deleted. booking_addons.booking_id has a single FK to bookings,
// so — unlike the therapists embed elsewhere in Reports — there's no
// ambiguous-relationship disambiguation needed here.
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

  const [addonsRes, completedRes] = await Promise.all([
    auth.admin.from('booking_addons')
      .select('booking_id, name, price, duration, bookings!inner(date, status)')
      .eq('bookings.status', 'completed')
      .gte('bookings.date', startDate).lte('bookings.date', endDate),
    auth.admin.from('bookings').select('id', { count: 'exact', head: true })
      .eq('status', 'completed').gte('date', startDate).lte('date', endDate),
  ])
  if (addonsRes.error) return Response.json({ error: addonsRes.error.message }, { status: 400 })
  if (completedRes.error) return Response.json({ error: completedRes.error.message }, { status: 400 })

  const rows = addonsRes.data ?? []
  const totalCompletedBookings = completedRes.count ?? 0

  const byName = new Map()
  const bookingsWithAddon = new Set()
  let totalRevenue = 0
  let totalMinutes = 0
  for (const r of rows) {
    const cur = byName.get(r.name) ?? { name: r.name, count: 0, revenue: 0, minutes: 0 }
    cur.count += 1
    cur.revenue += r.price ?? 0
    cur.minutes += r.duration ?? 0
    byName.set(r.name, cur)
    totalRevenue += r.price ?? 0
    totalMinutes += r.duration ?? 0
    if (r.booking_id) bookingsWithAddon.add(r.booking_id)
  }

  return Response.json({
    addons: [...byName.values()].sort((a, b) => b.revenue - a.revenue),
    summary: {
      totalAddonRevenue: totalRevenue,
      totalAddonMinutes: totalMinutes,
      totalAddonLineItems: rows.length,
      // Distinct bookings with >=1 add-on, not line items — a booking with two
      // add-ons must not count twice toward "how many bookings upsold".
      bookingsWithAddon: bookingsWithAddon.size,
      totalCompletedBookings,
      attachRatePct: totalCompletedBookings ? +(bookingsWithAddon.size / totalCompletedBookings * 100).toFixed(1) : 0,
    },
  })
}
