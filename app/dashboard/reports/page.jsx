import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getRevenueSummary } from '@/lib/insights'
import { reportRange } from '@/lib/report-ranges'
import ReportsClient from './ReportsClient'

export const dynamic = 'force-dynamic'

const DEFAULT_PRESET = 'this_month'

async function getData() {
  const admin = createSupabaseAdminClient()
  const defaultRange = reportRange(DEFAULT_PRESET)
  const [revenue, treatmentsRes, therapistsRes] = await Promise.all([
    getRevenueSummary(admin, defaultRange),
    // Filter-dropdown options for the Bookings tab — id+name only, active only,
    // same scope as every other admin picker (e.g. Treatments/Therapists pages).
    admin.from('spa_treatments').select('id, name').eq('is_active', true).order('sort_order'),
    admin.from('therapists').select('id, name').eq('is_active', true).order('sort_order'),
  ])
  return {
    defaultRange,
    revenue,
    treatments: treatmentsRes.data ?? [],
    therapists: therapistsRes.data ?? [],
  }
}

export default async function ReportsPage() {
  const { defaultRange, revenue, treatments, therapists } = await getData()
  return (
    <div>
      <h1 style={{ font: '400 32px Cormorant Garamond,serif', color: '#1C1917', margin: '0 0 8px' }}>Reports</h1>
      <p style={{ font: '400 13px Inter,sans-serif', color: '#6B6663', margin: '0 0 24px' }}>
        Revenue, therapists and bookings for any period — export any table to CSV to open in Excel or Sheets.
      </p>
      <ReportsClient
        defaultPreset={DEFAULT_PRESET}
        defaultRange={defaultRange}
        initialRevenue={revenue}
        treatments={treatments}
        therapists={therapists}
      />
    </div>
  )
}
