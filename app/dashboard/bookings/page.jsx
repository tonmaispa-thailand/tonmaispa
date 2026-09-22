import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { annotateBookingCoverage, COVERAGE_REASON_LABELS } from '@/lib/scheduling'
import BookingsClient from './BookingsClient'

export const dynamic = 'force-dynamic'

function isTwilioConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
    process.env.TWILIO_AUTH_TOKEN?.trim() &&
    (process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() || process.env.TWILIO_WHATSAPP_FROM?.trim())
  )
}

function settingEnabled(value) {
  return ['true', '1', 'yes', 'on', 'enabled'].includes(String(value ?? '').trim().toLowerCase())
}

async function getData() {
  const admin = createSupabaseAdminClient()
  const [bookingsRes, treatmentsRes, therapistsRes, settingsRes] = await Promise.all([
    admin.from('bookings')
      .select('id, ref_code, guest_name, guest_phone, guest_email, customer_id, treatment_id, therapist_id, date, time_slot, duration, addon_minutes, price, status, source, notes, staff_notes, created_at, last_email_sent_at, last_email_status, last_whatsapp_sent_at, last_whatsapp_status, whatsapp_reminder_sent_at, whatsapp_reminder_status, whatsapp_followup_sent_at, whatsapp_followup_status, spa_treatments(name), therapists!bookings_therapist_id_fkey(name)')
      .order('date', { ascending: false })
      .order('time_slot', { ascending: false })
      .limit(500),
    admin.from('spa_treatments')
      .select('id, name, duration_options, prices')
      .eq('is_active', true)
      .order('sort_order'),
    admin.from('therapists')
      .select('id, name')
      .eq('is_active', true)
      .order('sort_order'),
    admin.from('site_content').select('value_text').eq('key', 'settings.twilio_whatsapp_enabled').maybeSingle(),
  ])
  const bookings = bookingsRes.data ?? []
  // Flag upcoming bookings whose assigned therapist no longer covers the slot
  // (shift cut, break/block added, deactivated) — the sick-day gap. id → label.
  const coverageMap = await annotateBookingCoverage(admin, bookings)
  const coverageIssues = {}
  for (const [id, reason] of coverageMap) {
    coverageIssues[id] = { reason, label: COVERAGE_REASON_LABELS[reason] ?? reason }
  }
  return {
    bookings,
    treatments: treatmentsRes.data ?? [],
    therapists: therapistsRes.data ?? [],
    twilioEnabled: settingEnabled(settingsRes.data?.value_text) && isTwilioConfigured(),
    coverageIssues,
  }
}

function stringParam(params, key) {
  const value = params?.[key]
  return Array.isArray(value) ? value[0] : value
}

export default async function BookingsPage({ searchParams }) {
  const params = await searchParams
  const { bookings, treatments, therapists, twilioEnabled, coverageIssues } = await getData()
  const prefill = {
    fromConversation: stringParam(params, 'fromConversation') === '1',
    conversationId: stringParam(params, 'conversationId') || '',
    guestName: stringParam(params, 'guestName') || '',
    guestPhone: stringParam(params, 'guestPhone') || '',
    guestEmail: stringParam(params, 'guestEmail') || '',
    customerId: stringParam(params, 'customerId') || '',
    bookingId: stringParam(params, 'bookingId') || '',
  }
  return (
    <div>
      <h1 style={{ font: '400 32px Cormorant Garamond,serif', color: '#1C1917', margin: '0 0 24px' }}>Bookings</h1>
      <BookingsClient initialBookings={bookings} treatments={treatments} therapists={therapists} twilioEnabled={twilioEnabled} prefill={prefill} coverageIssues={coverageIssues} />
    </div>
  )
}
