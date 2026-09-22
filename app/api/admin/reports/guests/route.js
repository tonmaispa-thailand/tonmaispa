import { requireAdmin } from '@/lib/require-admin'

const MAX_ROWS = 500

// GET /api/admin/reports/guests?startDate&endDate
//
// Two different notions of "value" are in play, and the response keeps them
// clearly separate rather than blending them into one ambiguous number:
//   - "In period" fields (visitsInPeriod, spendInPeriod) — computed fresh from
//     completed bookings within [startDate, endDate], matching every other
//     Reports tab's period semantics.
//   - "Lifetime" fields (lifetimeVisits, lifetimeValue) — read directly from
//     customers.visit_count / customers.lifetime_value, which a DB trigger
//     (migration 021) keeps in sync across the customer's ENTIRE history, not
//     just this period. Shown for context (e.g. "is this a big spender
//     overall, even if this period was quiet"), never summed into period KPIs.
// "Repeat" is classified from the LIFETIME counter (visit_count > 1) — of the
// guests who visited in this period, how many have ever been more than once.
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

  // customers.created_at is a timestamptz; compare against Bangkok-midnight
  // boundaries (converted to a fixed +07:00 offset — Thailand has no DST, see
  // lib/report-ranges.js) rather than raw UTC date strings, so a signup late
  // in the Bangkok evening isn't miscounted into the next day.
  const startUtc = new Date(`${startDate}T00:00:00+07:00`).toISOString()
  const endUtc = new Date(`${endDate}T23:59:59.999+07:00`).toISOString()

  const [bookingsRes, newCustomersRes] = await Promise.all([
    auth.admin.from('bookings')
      .select('customer_id, price')
      .eq('status', 'completed').gte('date', startDate).lte('date', endDate)
      .not('customer_id', 'is', null),
    auth.admin.from('customers')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startUtc).lte('created_at', endUtc),
  ])
  if (bookingsRes.error) return Response.json({ error: bookingsRes.error.message }, { status: 400 })
  if (newCustomersRes.error) return Response.json({ error: newCustomersRes.error.message }, { status: 400 })

  const byCustomer = new Map() // customer id -> { visits, spend } within the period
  for (const b of bookingsRes.data ?? []) {
    const cur = byCustomer.get(b.customer_id) ?? { visits: 0, spend: 0 }
    cur.visits += 1
    cur.spend += b.price ?? 0
    byCustomer.set(b.customer_id, cur)
  }

  const customerIds = [...byCustomer.keys()]
  let profiles = []
  if (customerIds.length) {
    const { data, error } = await auth.admin.from('customers')
      .select('id, display_name, primary_phone_e164, email, visit_count, lifetime_value, last_visit_at')
      .in('id', customerIds)
    if (error) return Response.json({ error: error.message }, { status: 400 })
    profiles = data ?? []
  }
  const profileById = new Map(profiles.map(p => [p.id, p]))

  // Full, untruncated list — every summary KPI below is computed from this,
  // BEFORE the display list is sorted+capped, so truncation never skews a KPI.
  const allGuests = customerIds.map(id => {
    const p = profileById.get(id)
    const period = byCustomer.get(id)
    return {
      id,
      name: p?.display_name || 'Unknown',
      phone: p?.primary_phone_e164 ?? '',
      email: p?.email ?? '',
      visitsInPeriod: period.visits,
      spendInPeriod: period.spend,
      lifetimeVisits: p?.visit_count ?? 0,
      lifetimeValue: p?.lifetime_value ?? 0,
      lastVisitAt: p?.last_visit_at ?? null,
      isRepeat: (p?.visit_count ?? 0) > 1,
    }
  })

  const totalGuestsInPeriod = allGuests.length
  const repeatGuestsInPeriod = allGuests.filter(g => g.isRepeat).length
  const totalSpendInPeriod = allGuests.reduce((s, g) => s + g.spendInPeriod, 0)

  const sorted = [...allGuests].sort((a, b) => b.spendInPeriod - a.spendInPeriod)
  const guests = sorted.slice(0, MAX_ROWS)

  return Response.json({
    guests,
    truncated: sorted.length > MAX_ROWS,
    summary: {
      totalGuestsInPeriod,
      newCustomersInPeriod: newCustomersRes.count ?? 0,
      repeatGuestsInPeriod,
      repeatRatePct: totalGuestsInPeriod ? +(repeatGuestsInPeriod / totalGuestsInPeriod * 100).toFixed(1) : 0,
      totalSpendInPeriod,
      avgSpendPerGuest: totalGuestsInPeriod ? Math.round(totalSpendInPeriod / totalGuestsInPeriod) : 0,
    },
  })
}
