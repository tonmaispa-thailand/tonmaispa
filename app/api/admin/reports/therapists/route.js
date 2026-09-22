import { requireAdmin } from '@/lib/require-admin'
import { getTherapistUtilizationSummary, getTherapistTreatmentBreakdown } from '@/lib/insights'

// GET /api/admin/reports/therapists?startDate&endDate — merges the existing
// occupancy summary (booked vs. scheduled time; confirmed+completed) with the
// new realized-revenue-only treatment breakdown, joined by therapist id.
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

  const [utilization, breakdown] = await Promise.all([
    getTherapistUtilizationSummary(auth.admin, { startDate, endDate }),
    getTherapistTreatmentBreakdown(auth.admin, { startDate, endDate }),
  ])

  const breakdownById = new Map(breakdown.map(b => [b.id, b]))
  const therapists = utilization.map(u => {
    const b = breakdownById.get(u.id)
    return {
      id: u.id,
      name: u.name,
      scheduledHours: u.scheduledHours,
      bookedHours: u.bookedHours,
      occupancyPct: u.occupancyPct,
      completedBookings: b?.bookingCount ?? 0,
      revenue: b?.revenue ?? 0,
      treatments: b?.treatments ?? [],
    }
  }).sort((a, b) => b.revenue - a.revenue)

  return Response.json({ therapists })
}
