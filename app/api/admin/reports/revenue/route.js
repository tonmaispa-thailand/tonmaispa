import { requireAdmin } from '@/lib/require-admin'
import { getRevenueSummary } from '@/lib/insights'

// GET /api/admin/reports/revenue?startDate&endDate — powers the Reports
// page's period filter. Reuses the same aggregation as Overview and the
// Revenue & Marketing Advisor so all three never disagree about what
// "revenue this period" means.
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

  const revenue = await getRevenueSummary(auth.admin, { startDate, endDate })
  return Response.json({ revenue })
}
