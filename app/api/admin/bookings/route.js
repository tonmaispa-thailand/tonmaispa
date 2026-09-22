import { requireAdmin } from '@/lib/require-admin'
import { checkSlotCapacity, capacityErrorFromDb } from '@/lib/scheduling'
import { upsertCustomer } from '@/lib/customers'

function addMinutes(time, mins) {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + mins
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim())
}

function normalizeE164Input(value) {
  const compact = String(value ?? '').trim().replace(/[\s().-]/g, '')
  if (!compact) return ''
  return compact.startsWith('+') ? compact : `+${compact}`
}

function isValidE164Phone(value) {
  return /^\+[1-9]\d{6,14}$/.test(normalizeE164Input(value))
}

function missingConfirmationFields({ guest_name, guest_phone, guest_email }) {
  const missing = []
  if (!String(guest_name ?? '').trim()) missing.push('guest name')
  if (!isValidE164Phone(guest_phone)) missing.push('phone with country code, e.g. +66869643159')
  if (!isValidEmail(guest_email)) missing.push('valid email')
  return missing
}

// POST /api/admin/bookings — staff-created bookings (phone, walk-in, etc).
// Unlike the public /api/bookings route, this skips Turnstile/rate-limiting
// (already behind requireAdmin). Slot capacity (qualified therapist free +
// room free) IS enforced here too — a full slot must never be silently
// overbooked. Staff can still overbook deliberately, but only by passing
// overbook: true (the dashboard asks for explicit confirmation first).
export async function POST(req) {
  const auth = await requireAdmin()
  if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })

  const body = await req.json()
  const { guest_name, guest_phone, guest_email, treatment_id, therapist_id, date, time_slot, duration, status, source, notes, overbook } = body
  const normalizedPhone = normalizeE164Input(guest_phone)

  if (!guest_name || !normalizedPhone || !treatment_id || !date || !time_slot || !duration) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const requestedStatus = status || 'confirmed'
  if (requestedStatus === 'confirmed') {
    const missing = missingConfirmationFields({ guest_name, guest_phone: normalizedPhone, guest_email })
    if (missing.length) {
      return Response.json({ error: `Cannot confirm booking yet. Required: ${missing.join(', ')}.` }, { status: 400 })
    }
  }

  const [{ data: treatment }, capacity] = await Promise.all([
    auth.admin.from('spa_treatments').select('prices').eq('id', treatment_id).maybeSingle(),
    checkSlotCapacity(auth.admin, {
      treatmentId: treatment_id, date, startTime: time_slot, endTime: addMinutes(time_slot, duration),
    }),
  ])
  const price = treatment?.prices?.[String(duration)] ?? null

  if (!capacity.ok && !overbook) {
    const reason = capacity.reason === 'closed'
      ? 'The spa is marked closed on this date (see Availability → blocked dates).'
      : capacity.reason === 'no_room'
      ? 'All treatment rooms are occupied at this time.'
      : 'No qualified therapist is free at this time.'
    return Response.json({
      error: `${reason} Tick "book anyway" to overbook this slot deliberately.`,
      code: 'SLOT_FULL',
    }, { status: 409 })
  }

  // Auto-assign only when staff didn't pick a therapist explicitly. On a
  // deliberate overbook there may be no free therapist — saved as null so
  // staff can resolve the assignment manually afterward.
  const autoTherapistIds = therapist_id ? null : capacity.therapistIds
  const customerId = await upsertCustomer(auth.admin, { name: guest_name, phone: normalizedPhone, email: guest_email })

  const { data: booking, error } = await auth.admin
    .from('bookings')
    .insert({
      guest_name,
      guest_phone: normalizedPhone,
      guest_email:  guest_email || null,
      customer_id:  customerId,
      treatment_id,
      therapist_id: therapist_id || autoTherapistIds?.[0] || null,
      secondary_therapist_id: therapist_id ? null : (autoTherapistIds?.[1] ?? null),
      date,
      time_slot,
      duration,
      price,
      status:       requestedStatus,
      source:       source || 'phone',
      notes:        notes || null,
      // Deliberate staff overbook — bypasses the DB capacity trigger and is
      // auditable on the row.
      overbooked:   Boolean(overbook),
      // A staff member is submitting this form right now, so they already
      // know about the booking — the dashboard's new-booking alarm (see
      // migration 036) must never fire for it, regardless of what status
      // or source they picked above.
      staff_created: true,
    })
    .select('id, ref_code, guest_name, guest_phone, guest_email, date, time_slot, duration, status, source, notes, spa_treatments(name)')
    .single()

  if (error) {
    // DB trigger backstop caught a race the pre-check missed — surface it
    // as the same SLOT_FULL flow so the UI can offer "book anyway".
    if (capacityErrorFromDb(error)) {
      return Response.json({
        error: 'This slot just filled up while saving. Tick "book anyway" to overbook it deliberately.',
        code: 'SLOT_FULL',
      }, { status: 409 })
    }
    return Response.json({ error: error.message }, { status: 400 })
  }
  return Response.json({ ok: true, booking })
}
