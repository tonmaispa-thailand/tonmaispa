import { requireAdmin } from '@/lib/require-admin'
import { checkSlotCapacity, capacityErrorFromDb, getFreeTherapistIds, getQualifiedTherapistIds } from '@/lib/scheduling'
import { logBookingAction } from '@/lib/booking-logs'

const EDITABLE_FIELDS = [
  'guest_name', 'guest_phone', 'guest_email',
  'treatment_id', 'therapist_id', 'date', 'time_slot', 'duration',
  'status', 'source', 'notes', 'staff_notes',
]

// Fields that, if changed, require re-checking that a qualified therapist
// and a room are actually free for the new window — same rule the public
// site and chatbot already follow, so editing a booking can never silently
// create a double-booking. `excludeBookingId` treats this booking's own
// current slot as free rather than counting it against itself.
const CAPACITY_FIELDS = ['treatment_id', 'date', 'time_slot', 'duration', 'addon_minutes']

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

function missingConfirmationFields(booking) {
  const missing = []
  if (!String(booking.guest_name ?? '').trim()) missing.push('guest name')
  if (!isValidE164Phone(booking.guest_phone)) missing.push('phone with country code, e.g. +66869643159')
  if (!isValidEmail(booking.guest_email)) missing.push('valid email')
  return missing
}

export async function GET(req, { params }) {
  const auth = await requireAdmin()
  if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })

  const { id } = params
  const { data, error } = await auth.admin
    .from('bookings')
    .select('*, spa_treatments(name, duration_options)')
    .eq('id', id)
    .maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 400 })
  if (!data) return Response.json({ error: 'Booking not found' }, { status: 404 })
  return Response.json({ booking: data })
}

export async function PATCH(req, { params }) {
  const auth = await requireAdmin()
  if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })

  const { id } = params
  const body = await req.json()
  const updates = Object.fromEntries(Object.entries(body).filter(([k]) => EDITABLE_FIELDS.includes(k)))
  if ('guest_phone' in updates) updates.guest_phone = normalizeE164Input(updates.guest_phone)

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data: before, error: beforeError } = await auth.admin
    .from('bookings').select('*').eq('id', id).maybeSingle()
  if (beforeError || !before) return Response.json({ error: 'Booking not found' }, { status: 404 })

  const touchesCapacity = CAPACITY_FIELDS.some(f => f in updates && updates[f] !== before[f])
  // Overbook flag lifecycle: an explicit "save anyway" marks the row
  // overbooked (bypasses the DB capacity trigger, auditable); moving a
  // previously-overbooked row to a new slot WITHOUT the flag clears it, so
  // the new slot gets fully re-validated instead of inheriting the bypass.
  if (body.overbook) updates.overbooked = true
  else if (touchesCapacity && before.overbooked) updates.overbooked = false
  if (touchesCapacity && !body.overbook) {
    const merged = { ...before, ...updates }
    const capacity = await checkSlotCapacity(auth.admin, {
      treatmentId: merged.treatment_id,
      date: merged.date,
      startTime: merged.time_slot.slice(0, 5),
      endTime: addMinutes(merged.time_slot.slice(0, 5), merged.duration + (merged.addon_minutes ?? 0)),
      excludeBookingId: id,
    })
    if (!capacity.ok) {
      const reason = capacity.reason === 'closed'
        ? 'The spa is marked closed on this date (see Availability → blocked dates).'
        : capacity.reason === 'no_room'
        ? 'All treatment rooms are occupied at this new time.'
        : 'No qualified therapist is free at this new time.'
      return Response.json({
        error: `${reason} Tick "save anyway" to overbook this slot deliberately.`,
        code: 'SLOT_FULL',
      }, { status: 409 })
    }
  }

  // Assigning a specific therapist re-validates that person in real time
  // (qualified + on shift + no overlapping booking), same rules as the
  // availability engine. `force_therapist` is the staff's explicit override —
  // logged like overbook, never the default path.
  const therapistChanged = 'therapist_id' in updates && updates.therapist_id && updates.therapist_id !== before.therapist_id
  if (therapistChanged && !body.force_therapist) {
    const merged = { ...before, ...updates }
    const startTime = merged.time_slot.slice(0, 5)
    // Same full occupancy the capacity re-check above uses: an add-on tail
    // really does tie this therapist up past the billed duration, and the DB
    // trigger will reject the write on that basis anyway — checking the
    // shorter window here would only trade this precise message for a
    // confusing "slot just filled up".
    const endTime = addMinutes(startTime, merged.duration + (merged.addon_minutes ?? 0))
    const qualifiedIds = await getQualifiedTherapistIds(auth.admin, merged.treatment_id)
    const notQualified = !qualifiedIds.includes(updates.therapist_id)
    const freeIds = notQualified ? [] : await getFreeTherapistIds(auth.admin, {
      therapistIds: [updates.therapist_id], date: merged.date, startTime, endTime, excludeBookingId: id,
    })
    if (notQualified || !freeIds.includes(updates.therapist_id)) {
      return Response.json({
        error: notQualified
          ? 'This therapist is not marked as qualified for this treatment.'
          : 'This therapist is off shift or already booked during this time.',
        code: 'THERAPIST_UNAVAILABLE',
      }, { status: 409 })
    }
  }

  const mergedForValidation = { ...before, ...updates }
  if (mergedForValidation.status === 'confirmed') {
    const missing = missingConfirmationFields(mergedForValidation)
    if (missing.length) {
      return Response.json({ error: `Cannot confirm booking yet. Required: ${missing.join(', ')}.` }, { status: 400 })
    }
  }

  const { data, error } = await auth.admin.from('bookings').update(updates).eq('id', id).select('*, spa_treatments(name), therapists!bookings_therapist_id_fkey(name)').single()
  if (error) {
    // DB trigger backstop (race caught between pre-check and write, or a
    // status reactivation into a now-full slot) — same SLOT_FULL flow.
    if (capacityErrorFromDb(error)) {
      return Response.json({
        error: 'This slot just filled up while saving. Tick "save anyway" to overbook it deliberately.',
        code: 'SLOT_FULL',
      }, { status: 409 })
    }
    return Response.json({ error: error.message }, { status: 400 })
  }

  const changedFields = Object.keys(updates).filter(k => updates[k] !== before[k])
  if (changedFields.length) {
    const isOnlyStatus = changedFields.length === 1 && changedFields[0] === 'status'
    const isOnlyTherapist = changedFields.length === 1 && changedFields[0] === 'therapist_id'
    const detail = isOnlyStatus
      ? `status: ${before.status} → ${updates.status}`
      : isOnlyTherapist
      ? `therapist assigned: ${data.therapists?.name ?? updates.therapist_id ?? 'unassigned'}${body.force_therapist ? ' (forced despite unavailability)' : ''}`
      : changedFields.map(f => `${f}: ${before[f] ?? '—'} → ${updates[f] ?? '—'}`).join('; ')
    await logBookingAction(auth.admin, {
      bookingId: id,
      actorEmail: auth.session.user.email,
      action: isOnlyStatus ? 'status_changed' : isOnlyTherapist ? 'therapist_assigned' : 'edited',
      detail,
    })
  }

  return Response.json({ ok: true, booking: data })
}
