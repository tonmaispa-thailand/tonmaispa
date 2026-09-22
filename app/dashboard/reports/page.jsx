import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getRevenueSummary } from '@/lib/insights'
import { reportRange } from '@/lib/report-ranges'
import ReportsClient from './ReportsClient'

export const dynamic = 'force-dynamic'

const DEFAULT_PRESET = 'this_month'

async function getData() {
  const admin = createSupabaseAdminClient()
  const defaultRange = reportRange(DEFAULT_PRESET)
  const revenue = await getRevenueSummary(admin, defaultRange)
  return { defaultRange, revenue }
}

export default async function ReportsPage() {
  const { defaultRange, revenue } = await getData()
  return (
    <div>
      <h1 style={{ font: '400 32px Cormorant Garamond,serif', color: '#1C1917', margin: '0 0 8px' }}>Reports</h1>
      <p style={{ font: '400 13px Inter,sans-serif', color: '#6B6663', margin: '0 0 24px' }}>
        Revenue and treatment performance for any period — export to CSV to open in Excel or Sheets.
      </p>
      <ReportsClient defaultPreset={DEFAULT_PRESET} defaultRange={defaultRange} initialRevenue={revenue} />
    </div>
  )
}
