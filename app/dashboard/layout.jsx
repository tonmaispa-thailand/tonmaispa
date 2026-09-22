// ============================================================
// TON MAI SPA — Dashboard Layout
// Auth is enforced by middleware.js (redirects to /login).
// This layout reads the profile for display + role, and renders
// the sidebar nav shared by every /dashboard/* page.
// ============================================================

import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getSettingsMap } from '@/lib/site-settings'
import { getAlarmState } from '@/lib/booking-alarm'
import DashNav from './DashNav'
import BookingAlarmBar from './BookingAlarmBar'

export const metadata = { robots: { index: false, follow: false } }

export default async function DashboardLayout({ children }) {
  const cookieStore = await cookies()
  const supabase = createServerComponentClient({ cookies: () => cookieStore })
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', session.user.id)
    .single()

  const admin = createSupabaseAdminClient()
  const [flags, alarm] = await Promise.all([
    getSettingsMap(admin, ['settings.insights_enabled', 'settings.campaigns_enabled']),
    // A transient failure here (e.g. a momentary DB hiccup) must never take
    // down the whole dashboard — fall back to "nothing pending" and let the
    // client-side poll in BookingAlarmBar pick it up on its next tick.
    getAlarmState(admin).catch(() => ({ bookings: [], enabled: false, volume: 70 })),
  ])

  return (
    <>
      <BookingAlarmBar initialBookings={alarm.bookings} initialEnabled={alarm.enabled} initialVolume={alarm.volume} />
      <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--color-bg)' }}>
        <DashNav
          fullName={profile?.full_name} role={profile?.role} email={session.user.email}
          insightsEnabled={flags['settings.insights_enabled'] === 'true'}
          campaignsEnabled={flags['settings.campaigns_enabled'] === 'true'}
        />
        <main style={{ flex: 1, padding: 'clamp(20px,3vw,40px)', minWidth: 0 }}>
          {children}
        </main>
      </div>
    </>
  )
}
