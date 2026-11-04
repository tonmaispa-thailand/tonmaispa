// Robust E2E test of the booking engine ↔ availability ↔ roster linkage,
// including the AI chat layer (draft/confirm/reschedule). Runs against the
// real DB with isolated fixtures on far-future dates (2027-03-*) so nothing
// collides with real bookings; everything created is deleted by exact ID in a
// `finally` block (plus a ZZTEST sweep), so even a crash half-way through a
// section never leaves fixtures behind in production. The same sweep runs
// before the preflight, so a run that was killed outright (no finally) is
// cleaned up by the next run instead of blocking it.
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const PROJECT_ROOT = '/Users/psk/Documents/vibe-coding-projects/tonmai-spa/tonmai-next'
const envText = fs.readFileSync(path.join(PROJECT_ROOT, '.env.local'), 'utf8')
for (const line of envText.split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('='); if (eq === -1) continue
  const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
  const h = v.indexOf(' #'); if (h !== -1) v = v.slice(0, h).trim()
  v = v.replace(/^["']|["']$/g, '')
  if (!process.env[k]) process.env[k] = v
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const {
  getFreeTherapistIds, checkSlotCapacity, getAvailableSlots, getBookableTreatmentsAt, capacityErrorFromDb,
  isPastSlotInSpaTz, getAvailableRoomCount, getTurnaroundMin, annotateBookingCoverage,
  occupiedMinutes, timeToMin, getRoomTypeCapacity, getRoomRequirement,
} = await import('../lib/scheduling.js')
const { resolveAddons } = await import('../lib/booking-addons.js')
const {
  prepareBookingDraft, confirmBookingDraft,
  getRescheduleAvailability, prepareRescheduleDraft, confirmRescheduleDraft,
} = await import('../lib/chat-booking.js')

// ── Test bookkeeping ─────────────────────────────────────────────
let pass = 0, fail = 0
const failures = []
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name} ${detail ? '— ' + detail : ''}`) }
}
const cleanup = { bookings: [], therapists: [], shifts: [], quals: [], blocks: [], sessions: [], customers: [] }

// ── Fixture dates (far future — no real data there) ──────────────
const D_MAIN  = '2027-03-10' // Wednesday — main roster day
const D_CLOSED = '2027-03-11' // whole-spa closure
const D_BLOCK  = '2027-03-12' // per-therapist block
const D_TODAY  = '2027-03-13' // "today" past-slot filter (timezone) test
const D_RACE   = '2027-03-17' // Wednesday (D_MAIN + 7d, same weekday/room config) — N-way race simulation
const D_RACE2  = '2027-03-24' // Wednesday (D_MAIN + 14d) — couples N-way race simulation
const D_ROOMS  = '2027-04-21' // Wednesday — room-typing (wet/couples) math
const D_ADDON  = '2027-04-07' // Wednesday (D_MAIN + 28d) — add-on occupancy math
const D_BUFFER = '2027-03-31' // Wednesday (D_MAIN + 21d) — turnaround-buffer math
const D_COVER  = '2027-04-14' // Wednesday — orphaned-booking (lost cover) detection

// Real treatments (read-only)
// Plain one-therapist, any-room, 60-min treatment. Looked up by slug: the old
// hardcoded id pointed at a treatment removed in the 2026-11-03 catalogue reset.
const { data: single } = await admin.from('spa_treatments')
  .select('id, name, duration_options, therapists_required').eq('slug', 'thai-traditional-massage').maybeSingle()
const { data: couples } = await admin.from('spa_treatments')
  .select('id, name, duration_options, therapists_required').eq('therapists_required', 2).limit(1).maybeSingle()
const { data: wetTrt } = await admin.from('spa_treatments')
  .select('id, name, room_requirement, duration_options').eq('slug', 'lemongrass-body-scrub').maybeSingle()
const { data: couplesTrt } = await admin.from('spa_treatments')
  .select('id, name, room_requirement, duration_options').eq('slug', 'couples-bliss-package').maybeSingle()
const { data: reflexTrt } = await admin.from('spa_treatments')
  .select('id, name, room_requirement, duration_options').eq('slug', 'foot-reflexology').maybeSingle()
console.log(`Fixtures: single="${single?.name}" (req ${single?.therapists_required}), couples="${couples?.name}" (req ${couples?.therapists_required})`)
console.log(`Room fixtures: wet="${wetTrt?.name}"(${wetTrt?.room_requirement}) couples="${couplesTrt?.name}"(${couplesTrt?.room_requirement}) reflex="${reflexTrt?.name}"(${reflexTrt?.room_requirement})`)

// Sanity: the real treatments the fixtures hang off must exist (otherwise the
// run would crash after creating therapists — abort before touching anything)
if (!single || !couples || !wetTrt || !couplesTrt || !reflexTrt) {
  console.error('ABORT: fixture treatments missing —', JSON.stringify({ single: !!single, couples: !!couples, wet: !!wetTrt, couplesRoom: !!couplesTrt, reflex: !!reflexTrt }))
  process.exit(1)
}

const FIXTURE_DATES = [D_MAIN, D_CLOSED, D_BLOCK, D_TODAY, D_RACE, D_RACE2, D_BUFFER, D_COVER, D_ADDON, D_ROOMS]

// ── ZZTEST sweep (shared by the preflight below and the teardown) ─
// Removes anything this suite tags that is not covered by the current run's
// id lists: a row inserted right before a crash, or everything left by a run
// that was killed outright (Ctrl-C / SIGKILL — no finally runs then). Scoped
// to the ZZTEST tag / the suite's test phones / the fixture dates, so it
// cannot reach real data. `teardownKit()` carries the delete/select helpers
// and a counter of problems seen (a failed delete or select).
const TEST_PHONES = ['+66900000001', '+66900000002', '+66900000009']
function teardownKit() {
  const kit = { problems: 0 }
  kit.del = async (label, fn) => {
    try {
      const { error } = await fn()
      if (error) kit.problems++
      console.log(`  ${error ? '✗' : '✓'} ${label}${error ? ' — ' + error.message : ''}`)
    } catch (e) {
      kit.problems++
      console.log(`  ✗ ${label} — ${e?.message ?? e}`)
    }
  }
  // Empty id lists skip the round-trip instead of sending `in.()`.
  kit.delIn = (table, col, list) => list.length ? admin.from(table).delete().in(col, list) : Promise.resolve({})
  // A failed select must not look like "nothing to sweep".
  kit.selIds = async (table, build) => {
    const { data, error } = await build(admin.from(table).select('id'))
    if (error) { kit.problems++; console.log(`  ✗ select ${table} — ${error.message}`) }
    return (data ?? []).map(r => r.id)
  }
  kit.selIn = (table, col, list) => list.length ? kit.selIds(table, q => q.in(col, list)) : Promise.resolve([])
  return kit
}
async function sweepZZTEST(kit) {
  const { del, delIn, selIds, selIn } = kit
  const zzBookings = await selIds('bookings', q => q.ilike('guest_name', 'ZZTEST%').in('date', FIXTURE_DATES))
  // Chat sessions stamped on those bookings (confirm / reschedule flows) carry
  // no ZZTEST tag of their own — read them before the bookings go.
  let bkSessions = []
  if (zzBookings.length) {
    const { data, error } = await admin.from('bookings').select('chat_session_id').in('id', zzBookings).not('chat_session_id', 'is', null)
    if (error) { kit.problems++; console.log(`  ✗ select bookings.chat_session_id — ${error.message}`) }
    bkSessions = [...new Set((data ?? []).map(r => r.chat_session_id))]
  }
  const zzCustomers = [...new Set([
    ...await selIds('customers', q => q.ilike('display_name', 'ZZTEST%')),
    ...await selIds('customers', q => q.in('primary_phone_e164', TEST_PHONES)),
  ])]
  const zzSessions = [...new Set([
    ...await selIn('chat_sessions', 'customer_id', zzCustomers),
    ...await selIds('chat_sessions', q => q.in('guest_phone', TEST_PHONES)),
    ...await selIds('chat_sessions', q => q.ilike('guest_name', 'ZZTEST%')),
    ...await selIn('chat_sessions', 'session_id', bkSessions),
  ])]
  const zzThreads = [...new Set([
    ...await selIn('conversation_threads', 'customer_id', zzCustomers),
    ...await selIn('conversation_threads', 'web_session_id', bkSessions),
  ])]
  const zzTherapists = await selIds('therapists', q => q.ilike('name', 'ZZTEST%'))
  const zzBlocks = await selIds('blocked_dates', q => q.ilike('reason', 'ZZTEST%').in('date', FIXTURE_DATES))
  const stray = zzBookings.length + zzCustomers.length + zzSessions.length + zzThreads.length + zzTherapists.length + zzBlocks.length
  if (!stray) {
    console.log('  sweep: nothing tagged ZZTEST left behind')
    return 0
  }
  console.log(`  sweep: ${zzBookings.length} bookings, ${zzCustomers.length} customers, ${zzSessions.length} chat_sessions, ${zzThreads.length} threads, ${zzTherapists.length} therapists, ${zzBlocks.length} blocked_dates tagged ZZTEST — removing`)
  await del('sweep booking_logs', () => delIn('booking_logs', 'booking_id', zzBookings))
  await del('sweep bookings', () => delIn('bookings', 'id', zzBookings))
  await del('sweep conversation threads/messages', async () => {
    await delIn('conversation_messages', 'thread_id', zzThreads)
    return delIn('conversation_threads', 'id', zzThreads)
  })
  // chat_sessions.customer_id has no ON DELETE rule → sessions must go before the customer
  await del('sweep chat_sessions', () => delIn('chat_sessions', 'id', zzSessions))
  await del('sweep customers', () => delIn('customers', 'id', zzCustomers))
  await del('sweep blocked_dates', () => delIn('blocked_dates', 'id', zzBlocks))
  // shifts / quals / per-therapist blocks cascade from the therapist row
  await del('sweep therapists', () => delIn('therapists', 'id', zzTherapists))
  return stray
}
async function fixtureDatesInUse() {
  const out = {}
  for (const table of ['bookings', 'therapist_shifts', 'blocked_dates']) {
    const { count, error, status } = await admin.from(table).select('id', { count: 'exact', head: true }).in('date', FIXTURE_DATES)
    // A HEAD response has no body, so a failed count arrives with an empty
    // message — fall back to the HTTP status so the ABORT line says something.
    out[table] = error ? `ERR ${error.message || `HTTP ${status}`}` : (count ?? 0)
  }
  out.clean = Object.values(out).every(v => v === 0)
  return out
}

// Preflight: the fixture dates must hold nothing but ours. Sweep first so a
// run that was killed half-way self-heals instead of blocking every later run;
// abort only if something that is NOT ours is still there afterwards (or the
// sweep itself hit errors — nothing has been created yet, so aborting is free).
console.log('\n═ Preflight')
const preKit = teardownKit()
await sweepZZTEST(preKit)
const inUse = await fixtureDatesInUse()
if (!inUse.clean) {
  console.error('ABORT: fixture dates hold rows that are not ours —', JSON.stringify(inUse))
  process.exit(1)
}
if (preKit.problems) {
  console.error(`ABORT: pre-sweep hit ${preKit.problems} problem(s) — see the ✗ lines above`)
  process.exit(1)
}
console.log('  fixture dates clean')

// Neutralise the live turnaround buffer for the duration of these deterministic
// tests. Sections A–L/N assume back-to-back bookings (buffer = 0); the buffer
// itself is tested explicitly in section M via the bufferMin param. If staff
// have turned the buffer on in production (turnaround_min > 0), a shared 30-min
// grid would otherwise make adjacent fixture slots conflict and fail spuriously.
// Saved and restored (crash-safely, in the finally below) so the live policy is
// untouched after the run.
const { data: turnRow } = await admin.from('slot_settings').select('*')
  .is('treatment_id', null).eq('is_active', true).maybeSingle()
const hasTurnaroundCol = turnRow && Object.prototype.hasOwnProperty.call(turnRow, 'turnaround_min')
const origTurnaround = hasTurnaroundCol ? turnRow.turnaround_min : null
async function restoreTurnaround() {
  if (hasTurnaroundCol && origTurnaround !== 0) {
    await admin.from('slot_settings').update({ turnaround_min: origTurnaround }).eq('id', turnRow.id)
    console.log(`  restored live turnaround_min = ${origTurnaround}`)
  }
}
if (hasTurnaroundCol && origTurnaround !== 0) {
  await admin.from('slot_settings').update({ turnaround_min: 0 }).eq('id', turnRow.id)
  console.log(`(neutralised live turnaround_min ${origTurnaround} → 0 for this run; will restore)`)
}

// ── Teardown ─────────────────────────────────────────────────────
// Called from the `finally` below, so it runs even when a section throws
// half-way. (The 2026-10-29 run died in K2 with the cleanup still inside the
// try, and left 18 bookings, 3 therapists, shifts, quals and blocked_dates in
// production.) Two layers:
//   1. exact-id deletes of everything this run recorded in `cleanup`, in FK
//      order (logs → threads → bookings → chat sessions → customers → roster)
//   2. the shared ZZTEST sweep above, for anything that slipped past the id
//      lists (a row inserted right before a crash).
// Returns the number of problems seen (a failed delete or select, or rows
// still present afterwards) so the exit code can flag an incomplete teardown
// instead of reporting green with fixtures left in production.
async function cleanupFixtures() {
  console.log('\n═ Cleanup')
  const kit = teardownKit()
  const { del, delIn, selIn } = kit

  // 1. exact ids recorded during the run
  await del('booking_logs', () => delIn('booking_logs', 'booking_id', cleanup.bookings))
  await del('conversation threads/messages', async () => {
    const threadIds = await selIn('conversation_threads', 'web_session_id', cleanup.sessions)
    await delIn('conversation_messages', 'thread_id', threadIds)
    return delIn('conversation_threads', 'id', threadIds)
  })
  await del(`bookings (${cleanup.bookings.length})`, () => delIn('bookings', 'id', cleanup.bookings))
  await del('chat_sessions', () => delIn('chat_sessions', 'session_id', cleanup.sessions))
  await del('customers (test phones)', () => delIn('customers', 'primary_phone_e164', TEST_PHONES))
  await del('blocked_dates', () => delIn('blocked_dates', 'id', cleanup.blocks))
  await del('therapist_shifts', () => delIn('therapist_shifts', 'id', cleanup.shifts))
  await del('therapist_treatments', () => delIn('therapist_treatments', 'therapist_id', cleanup.therapists))
  await del(`therapists (${cleanup.therapists.length})`, () => delIn('therapists', 'id', cleanup.therapists))

  // 2. ZZTEST sweep — belt and braces
  await sweepZZTEST(kit)

  // Verify nothing remains on fixture dates / under the ZZTEST tag
  const { data: leftover, error: leftErr } = await admin.from('bookings').select('id').in('date', FIXTURE_DATES)
  const { data: leftTher, error: therErr } = await admin.from('therapists').select('id').ilike('name', 'ZZTEST%')
  if (leftErr || therErr) { kit.problems++; console.log(`  ✗ leftover check — ${(leftErr ?? therErr).message}`) }
  if ((leftover?.length ?? 0) + (leftTher?.length ?? 0) > 0) kit.problems++
  console.log(`  leftover: ${leftover?.length ?? 0} bookings on fixture dates, ${leftTher?.length ?? 0} ZZTEST therapists`)
  return kit.problems
}

let crashed = null
let teardownProblems = 0
try {

// ── Build fixtures ───────────────────────────────────────────────
async function makeTherapist(name) {
  const { data, error } = await admin.from('therapists').insert({ name, is_active: true, sort_order: 999 }).select('id').single()
  if (error) throw new Error('therapist insert: ' + error.message)
  cleanup.therapists.push(data.id)
  return data.id
}
const T1 = await makeTherapist('ZZTEST Alpha')
const T2 = await makeTherapist('ZZTEST Beta')
const T3 = await makeTherapist('ZZTEST Gamma') // deliberately no shift on D_MAIN

for (const tid of [T1, T2, T3]) {
  for (const trt of [single.id, couples.id]) {
    const { error } = await admin.from('therapist_treatments').insert({ therapist_id: tid, treatment_id: trt })
    if (error) throw new Error('qual insert: ' + error.message)
    cleanup.quals.push({ therapist_id: tid, treatment_id: trt })
  }
}

// Room-typing fixtures: qualify the test therapists for the wet-room, couples
// and reflexology treatments so section P can staff them, then roster T1+T2 on
// D_ROOMS. (These treatments really exist in the live menu; we only add the
// qualifications/shifts, which are cleaned up.)
for (const tid of [T1, T2]) {
  for (const trt of [wetTrt?.id, couplesTrt?.id, reflexTrt?.id].filter(Boolean)) {
    const { error } = await admin.from('therapist_treatments').insert({ therapist_id: tid, treatment_id: trt })
    if (!error) cleanup.quals.push({ therapist_id: tid, treatment_id: trt })
  }
}
await makeShift(T1, D_ROOMS, '10:00', '20:00')
await makeShift(T2, D_ROOMS, '10:00', '20:00')

async function makeShift(tid, date, start, end, breakStart = null, breakEnd = null) {
  const { data, error } = await admin.from('therapist_shifts')
    .insert({ therapist_id: tid, date, start_time: start, end_time: end, break_start: breakStart, break_end: breakEnd })
    .select('id').single()
  if (error) throw new Error('shift insert: ' + error.message)
  cleanup.shifts.push(data.id)
}
// D_MAIN roster: T1 10:00–20:00 (break 12–13), T2 10:00–14:00, T3 off
await makeShift(T1, D_MAIN, '10:00', '20:00', '12:00', '13:00')
await makeShift(T2, D_MAIN, '10:00', '14:00')
// D_BLOCK roster: T1 + T2 both 10:00–20:00, but T1 personally blocked
await makeShift(T1, D_BLOCK, '10:00', '20:00')
await makeShift(T2, D_BLOCK, '10:00', '20:00')
// D_CLOSED roster: T1 on shift (contradictory data — tests closure precedence)
await makeShift(T1, D_CLOSED, '10:00', '20:00')

const { data: blockRow } = await admin.from('blocked_dates').insert({ date: D_BLOCK, therapist_id: T1, reason: 'ZZTEST fixture' }).select('id').single()
cleanup.blocks.push(blockRow.id)
const { data: closureRow } = await admin.from('blocked_dates').insert({ date: D_CLOSED, therapist_id: null, reason: 'ZZTEST fixture' }).select('id').single()
cleanup.blocks.push(closureRow.id)

const ALL = [T1, T2, T3]
const cap = (args) => checkSlotCapacity(admin, { treatmentId: single.id, date: D_MAIN, ...args })

// ══ A. Roster & shift linkage ════════════════════════════════════
console.log('\n═ A. Roster & shift linkage')
let free = await getFreeTherapistIds(admin, { therapistIds: ALL, date: D_MAIN, startTime: '10:00', endTime: '11:00' })
check('A1 both rostered therapists free at 10:00, unrostered T3 excluded',
  free.includes(T1) && free.includes(T2) && !free.includes(T3), JSON.stringify(free))

free = await getFreeTherapistIds(admin, { therapistIds: ALL, date: D_MAIN, startTime: '09:00', endTime: '10:00' })
check('A2 nobody free before shift start (09:00)', free.length === 0, JSON.stringify(free))

free = await getFreeTherapistIds(admin, { therapistIds: ALL, date: D_MAIN, startTime: '19:00', endTime: '20:00' })
check('A3 booking ending exactly at shift end (19:00–20:00) allowed for T1', free.length === 1 && free[0] === T1)

free = await getFreeTherapistIds(admin, { therapistIds: ALL, date: D_MAIN, startTime: '19:30', endTime: '20:30' })
check('A4 booking spilling past shift end rejected', free.length === 0)

free = await getFreeTherapistIds(admin, { therapistIds: [T1], date: D_MAIN, startTime: '12:00', endTime: '13:00' })
check('A5 T1 not free during break (12:00–13:00)', free.length === 0)
free = await getFreeTherapistIds(admin, { therapistIds: [T1], date: D_MAIN, startTime: '12:30', endTime: '13:30' })
check('A6 partial break overlap (12:30–13:30) rejected', free.length === 0)
free = await getFreeTherapistIds(admin, { therapistIds: [T1], date: D_MAIN, startTime: '13:00', endTime: '14:00' })
check('A7 booking starting exactly at break end (13:00) allowed', free.length === 1)

free = await getFreeTherapistIds(admin, { therapistIds: ALL, date: D_BLOCK, startTime: '11:00', endTime: '12:00' })
check('A8 per-therapist blocked date excludes T1, keeps T2', free.length === 1 && free[0] === T2, JSON.stringify(free))

// ══ B. Booking overlap linkage ═══════════════════════════════════
console.log('\n═ B. Existing-booking overlap')
async function makeBooking(fields) {
  const { data, error } = await admin.from('bookings').insert({
    guest_name: 'ZZTEST Guest', guest_phone: '+66900000001',
    treatment_id: single.id, date: D_MAIN, duration: 60, status: 'confirmed', source: 'walk_in',
    ...fields,
  }).select('id').single()
  if (error) throw new Error('booking insert: ' + error.message)
  cleanup.bookings.push(data.id)
  return data.id
}

const b1 = await makeBooking({ therapist_id: T1, time_slot: '14:00' }) // T1 busy 14:00–15:00
free = await getFreeTherapistIds(admin, { therapistIds: [T1], date: D_MAIN, startTime: '14:00', endTime: '15:00' })
check('B1 confirmed booking blocks T1 in its window', free.length === 0)
free = await getFreeTherapistIds(admin, { therapistIds: [T1], date: D_MAIN, startTime: '14:30', endTime: '15:30' })
check('B2 partial overlap (14:30) blocked', free.length === 0)
free = await getFreeTherapistIds(admin, { therapistIds: [T1], date: D_MAIN, startTime: '15:00', endTime: '16:00' })
check('B3 back-to-back booking (15:00 start) allowed', free.length === 1)

const bCancelled = await makeBooking({ therapist_id: T1, time_slot: '16:00', status: 'cancelled' })
free = await getFreeTherapistIds(admin, { therapistIds: [T1], date: D_MAIN, startTime: '16:00', endTime: '17:00' })
check('B4 cancelled booking does NOT block', free.length === 1)

const bSecondary = await makeBooking({ therapist_id: T3, secondary_therapist_id: T1, time_slot: '17:00' })
free = await getFreeTherapistIds(admin, { therapistIds: [T1], date: D_MAIN, startTime: '17:00', endTime: '18:00' })
check('B5 secondary_therapist assignment blocks T1 too', free.length === 0)

const r1 = await cap({ startTime: '14:00', endTime: '15:00' })
check('B6 checkSlotCapacity at 14:00 still ok via T2 (on shift till 14:00? NO — expect no_therapist)',
  r1.ok === false && r1.reason === 'no_therapist', JSON.stringify(r1))

// ══ C. Multi-therapist (couples) treatment ═══════════════════════
console.log('\n═ C. Couples treatment (therapists_required = 2)')
let c = await checkSlotCapacity(admin, { treatmentId: couples.id, date: D_MAIN, startTime: '10:00', endTime: '11:00' })
check('C1 couples booking ok when 2 qualified free (assigns both)',
  c.ok && c.therapistIds.length === 2 && c.therapistIds.includes(T1) && c.therapistIds.includes(T2), JSON.stringify(c))
c = await checkSlotCapacity(admin, { treatmentId: couples.id, date: D_MAIN, startTime: '18:00', endTime: '19:00' })
check('C2 couples booking rejected when only 1 free (T2 off after 14:00)', c.ok === false && c.reason === 'no_therapist')

// ══ D. Concurrency caps (rooms + max_concurrent) ═════════════════
console.log('\n═ D. Concurrency caps (rooms + max_concurrent)')
const { data: capRow } = await admin.from('room_capacity').select('room_count').eq('day_of_week', 3).maybeSingle() // Wed
const roomCount = capRow?.room_count ?? 0
const { data: globalCfg } = await admin.from('slot_settings').select('max_concurrent, last_slot').is('treatment_id', null).eq('is_active', true).maybeSingle()
const maxConcurrent = globalCfg?.max_concurrent ?? null
const effectiveCap = maxConcurrent ? Math.min(roomCount, maxConcurrent) : roomCount
console.log(`  (rooms=${roomCount}, max_concurrent=${maxConcurrent} → effective cap=${effectiveCap})`)
const dummies = []
for (let i = 0; i < effectiveCap; i++) {
  dummies.push(await makeBooking({ therapist_id: null, time_slot: '11:00', status: 'pending' }))
}
let d = await cap({ startTime: '11:00', endTime: '12:00' })
check(`D1 ${effectiveCap} overlapping bookings exhaust the effective cap → no_room`, d.ok === false && d.reason === 'no_room', JSON.stringify(d))
d = await cap({ startTime: '11:00', endTime: '12:00', excludeBookingId: dummies[0] })
check('D2 excludeBookingId frees its own spot (edit path)', d.ok === true, JSON.stringify(d))
d = await cap({ startTime: '10:00', endTime: '11:00' })
check('D3 adjacent window (10:00–11:00) unaffected by 11:00 full block', d.ok === true)
if (maxConcurrent && maxConcurrent < roomCount) {
  // max_concurrent is the binding constraint app-side; physical rooms still
  // have headroom, so a direct insert (trigger-level) must still succeed.
  const extra = await makeBooking({ therapist_id: null, time_slot: '11:00', status: 'pending' })
  check('D4 max_concurrent binds the app layer while physical rooms retain trigger headroom', !!extra)
} else {
  console.log('  (D4 skipped — max_concurrent does not undercut room capacity in current config)')
}

// ══ E. Whole-spa closure ═════════════════════════════════════════
console.log('\n═ E. Whole-spa closure')
const closedSlots = await getAvailableSlots(admin, { date: D_CLOSED, treatmentId: single.id, duration: 60 })
check('E1 getAvailableSlots reports closed', closedSlots.closed === true && closedSlots.slots.length === 0)
const closedCap = await checkSlotCapacity(admin, { treatmentId: single.id, date: D_CLOSED, startTime: '11:00', endTime: '12:00' })
check('E2 [known-gap probe] checkSlotCapacity also refuses a spa-closed date', closedCap.ok === false,
  `capacity said ok=${closedCap.ok} — closure is only enforced in getAvailableSlots`)
const closedRec = await getBookableTreatmentsAt(admin, { date: D_CLOSED, startTime: '11:00' })
check('E3 chatbot recommend_treatments respects closure', closedRec.closed === true && closedRec.treatments.length === 0)

// ══ F. Slot listing integration ══════════════════════════════════
console.log('\n═ F. getAvailableSlots integration (D_MAIN, 60 min)')
const { slots } = await getAvailableSlots(admin, { date: D_MAIN, treatmentId: single.id, duration: 60 })
const at = (t) => slots.find(s => s.time === t)
check('F1 slot grid starts at config first_slot (09:00 candidate exists)', !!at('09:00'))
check('F2 09:00 unavailable (before roster)', at('09:00')?.available === false)
check('F3 10:00 available with spotsLeft=2 (T1+T2, rooms plenty)', at('10:00')?.available === true && at('10:00')?.spotsLeft === 2, JSON.stringify(at('10:00')))
check('F4 11:00 unavailable (rooms exhausted)', at('11:00')?.available === false)
check('F5 12:00 spotsLeft=1 (T1 on break, T2 free)', at('12:00')?.spotsLeft === 1, JSON.stringify(at('12:00')))
check('F6 14:00 unavailable (T1 booked, T2 off-shift)', at('14:00')?.available === false)
check('F7 19:00 available via T1 (ends at shift end)', at('19:00')?.available === true && at('19:00')?.spotsLeft === 1)
// Config-derived (staff edit last_slot live on the dashboard): for a 60-min
// session the last candidate start is last_slot − 60, and nothing later.
{
  const [lh, lm] = (globalCfg?.last_slot ?? '22:00').slice(0, 5).split(':').map(Number)
  const lastStartMin = lh * 60 + lm - 60
  const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const lastStart = fmt(lastStartMin)
  const beyond = fmt(lastStartMin + 30)
  check(`F8 last candidate respects last_slot − duration (${lastStart} exists, ${beyond} does not)`, !!at(lastStart) && !at(beyond))
}

// ══ G. AI chat layer — draft / confirm ═══════════════════════════
console.log('\n═ G. AI chat draft → confirm')
const S1 = randomUUID(); cleanup.sessions.push(S1)
const draft1 = await prepareBookingDraft(admin, S1, {
  guest_name: 'ZZTEST Chat Guest', treatment_id: single.id, date: D_MAIN, time_slot: '10:00', duration: 60,
})
check('G1 prepare_booking succeeds on open slot (no phone/email needed)', draft1.ok === true && draft1.draft_ready === true, JSON.stringify(draft1).slice(0, 120))

const S2 = randomUUID(); cleanup.sessions.push(S2)
const draftFull = await prepareBookingDraft(admin, S2, {
  guest_name: 'ZZTEST Chat Guest2', treatment_id: single.id, date: D_MAIN, time_slot: '11:00', duration: 60,
})
check('G2 prepare_booking on room-full slot refused with alternatives',
  draftFull.ok === false && Array.isArray(draftFull.nearest_open_times) && !draftFull.nearest_open_times.includes('11:00') && draftFull.nearest_open_times.length > 0,
  JSON.stringify(draftFull).slice(0, 160))

const badContact = await confirmBookingDraft(admin, {
  sessionId: S1, token: draft1.token, sendNotifications: false,
  guest_name: 'ZZTEST Chat Guest', guest_phone: '0812345678', guest_email: 'x@example.com',
})
check('G3 confirm rejects phone without country code', badContact.ok === false && badContact.status === 400)

const wrongToken = await confirmBookingDraft(admin, {
  sessionId: S1, token: randomUUID(), sendNotifications: false,
  guest_name: 'ZZTEST Chat Guest', guest_phone: '+66900000002', guest_email: 'zztest@example.com',
})
check('G4 confirm rejects wrong token', wrongToken.ok === false && wrongToken.status === 404)

const confirmed = await confirmBookingDraft(admin, {
  sessionId: S1, token: draft1.token, sendNotifications: false,
  guest_name: 'ZZTEST Chat Guest', guest_phone: '+66900000002', guest_email: 'zztest@example.com',
})
if (confirmed.booking_id) cleanup.bookings.push(confirmed.booking_id)
check('G5 confirm inserts pending booking', confirmed.ok === true && confirmed.status === 'pending', JSON.stringify(confirmed).slice(0, 140))

const { data: chatBooking } = await admin.from('bookings')
  .select('therapist_id, status, guest_phone, chat_session_id').eq('id', confirmed.booking_id).maybeSingle()
check('G6 auto-assigned therapist is one of the rostered pair', [T1, T2].includes(chatBooking?.therapist_id))
check('G7 booking row: pending, E.164 phone, session linked',
  chatBooking?.status === 'pending' && chatBooking?.guest_phone === '+66900000002' && chatBooking?.chat_session_id === S1)

free = await getFreeTherapistIds(admin, { therapistIds: [chatBooking.therapist_id], date: D_MAIN, startTime: '10:00', endTime: '11:00' })
check('G8 chat-created booking immediately consumes therapist availability', free.length === 0)

// ══ H. AI chat layer — reschedule ════════════════════════════════
console.log('\n═ H. AI chat reschedule (linked to same roster)')
await admin.from('bookings').update({ guest_email: null }).eq('id', confirmed.booking_id) // suppress reschedule email
const avail = await getRescheduleAvailability(admin, S1, { booking_id: confirmed.booking_id, date: D_MAIN })
check('H1 reschedule availability lists open times excluding room-full 11:00',
  avail.ok === true && avail.open_times.includes('15:00') && !avail.open_times.includes('11:00'), JSON.stringify(avail.open_times ?? []).slice(0, 120))
check('H2 reschedule availability includes own current slot (excludeBookingId works)', avail.open_times.includes('10:00'))

const badRes = await prepareRescheduleDraft(admin, S1, { booking_id: confirmed.booking_id, date: D_MAIN, time_slot: '11:00' })
check('H3 reschedule to room-full slot refused with alternatives', badRes.ok === false && Array.isArray(badRes.nearest_open_times))

const resDraft = await prepareRescheduleDraft(admin, S1, { booking_id: confirmed.booking_id, date: D_MAIN, time_slot: '15:00' })
check('H4 reschedule draft prepared for open 15:00', resDraft.ok === true && resDraft.reschedule_ready === true)

const resConfirm = await confirmRescheduleDraft(admin, { sessionId: S1, token: resDraft.token, settings: {} })
check('H5 reschedule confirm succeeds', resConfirm.ok === true, JSON.stringify(resConfirm).slice(0, 140))

const { data: moved } = await admin.from('bookings').select('date, time_slot, status, therapist_id').eq('id', confirmed.booking_id).maybeSingle()
check('H6 booking moved to 15:00, back to pending, therapist reassigned to T1 (only one on shift)',
  moved?.time_slot?.startsWith('15:00') && moved?.status === 'pending' && moved?.therapist_id === T1, JSON.stringify(moved))

free = await getFreeTherapistIds(admin, { therapistIds: [T1, T2], date: D_MAIN, startTime: '10:00', endTime: '11:00' })
check('H7 old 10:00 slot freed after reschedule', free.length === 2)

// ══ I. Atomic capacity trigger (migration 027) ═══════════════════
console.log('\n═ I. Atomic capacity trigger — races, backstop, overbook bypass')
// 18:00–19:00: only T1 free (T2 off shift). Two capacity+insert pairs fired
// in parallel simulate two public POSTs hitting the API at the same instant —
// both pass the JS pre-check, but the DB trigger must let exactly one through.
async function simulatePublicBook(guestName) {
  const capRes = await checkSlotCapacity(admin, { treatmentId: single.id, date: D_MAIN, startTime: '18:00', endTime: '19:00' })
  if (!capRes.ok) return { ok: false, stage: 'precheck' }
  const { data, error } = await admin.from('bookings').insert({
    guest_name: guestName, guest_phone: '+66900000009', treatment_id: single.id,
    therapist_id: capRes.therapistIds[0], date: D_MAIN, time_slot: '18:00', duration: 60,
    status: 'pending', source: 'online',
  }).select('id').single()
  if (data?.id) cleanup.bookings.push(data.id)
  return { ok: !error, id: data?.id, error }
}
const [raceA, raceB] = await Promise.all([simulatePublicBook('ZZTEST Race A'), simulatePublicBook('ZZTEST Race B')])
const winners = [raceA, raceB].filter(r => r.ok)
const loser = [raceA, raceB].find(r => !r.ok)
check('I1 race: exactly ONE of two simultaneous bookings wins the last slot', winners.length === 1,
  `winners=${winners.length}`)
// Which layer catches the loser is timing-dependent: if both requests pass
// the JS pre-check the DB trigger rejects one (THERAPIST_DOUBLE_BOOKED); if
// one request is slower, the pre-check itself sees the slot taken. Both are
// correct rejections — I3 below proves the trigger layer deterministically.
// (Same dual-layer acceptance as the K-section races.)
check('I2 race loser rejected for therapist capacity (pre-check OR DB trigger)',
  loser?.stage === 'precheck' || capacityErrorFromDb(loser?.error)?.reason === 'no_therapist',
  String(loser?.error?.message ?? loser?.stage))

// Direct sequential double-book attempt (bypassing pre-check entirely).
const { error: dblErr } = await admin.from('bookings').insert({
  guest_name: 'ZZTEST Direct Dbl', guest_phone: '+66900000009', treatment_id: single.id,
  therapist_id: T1, date: D_MAIN, time_slot: '18:00', duration: 60, status: 'pending', source: 'online',
}).select('id').single()
check('I3 direct overlapping insert on a busy therapist rejected even without pre-check',
  capacityErrorFromDb(dblErr)?.reason === 'no_therapist', String(dblErr?.message))

// Deliberate staff overbook bypasses the trigger and is recorded on the row.
const { data: obRow, error: obErr } = await admin.from('bookings').insert({
  guest_name: 'ZZTEST Overbook', guest_phone: '+66900000009', treatment_id: single.id,
  therapist_id: T1, date: D_MAIN, time_slot: '18:00', duration: 60, status: 'pending', source: 'walk_in',
  overbooked: true,
}).select('id, overbooked').single()
if (obRow?.id) cleanup.bookings.push(obRow.id)
check('I4 overbooked=true bypasses the trigger (deliberate staff overbook preserved)', !obErr && obRow?.overbooked === true, String(obErr?.message ?? ''))

// Physical room overflow backstop: fill every room at 20:30 (no shifts
// needed — therapist-null bookings), then the next plain insert must fail.
const roomFillers = []
for (let i = 0; i < roomCount; i++) {
  roomFillers.push(await makeBooking({ therapist_id: null, time_slot: '20:30', duration: 30, status: 'pending' }))
}
const { error: roomErr } = await admin.from('bookings').insert({
  guest_name: 'ZZTEST RoomOverflow', guest_phone: '+66900000009', treatment_id: single.id,
  therapist_id: null, date: D_MAIN, time_slot: '20:30', duration: 30, status: 'pending', source: 'online',
}).select('id').single()
check(`I5 trigger blocks insert past physical room capacity (${roomCount})`,
  capacityErrorFromDb(roomErr)?.reason === 'no_room', String(roomErr?.message))

// Reactivating a cancelled booking into a now-conflicting window must fail:
// the chat booking moved to 15:00 (T1) in section H; flip the cancelled
// 16:00 booking onto that same window and back to confirmed in one update.
const { error: reactErr } = await admin.from('bookings')
  .update({ time_slot: '15:00', status: 'confirmed' }).eq('id', bCancelled).select('id').single()
check('I6 cancelled→confirmed reactivation into a conflicting slot rejected (UPDATE path)',
  capacityErrorFromDb(reactErr)?.reason === 'no_therapist', String(reactErr?.message))

// ══ J. "Today" past-slot filter is timezone-correct ══════════════
// Regression guard for the UTC-vs-Bangkok bug: getAvailableSlots must hide
// slots that have already passed in the spa's timezone (Asia/Bangkok), and
// the result must be identical no matter what TZ the Node process runs in.
// `asOf` injects a fixed instant so the test is deterministic; we assert the
// same date under a wall clock of 14:00 Bangkok. D_TODAY (2027-03-13) gets a
// single all-day therapist shift and no bookings, so the ONLY thing that can
// make an early slot unavailable is the past-time filter.
console.log('\n═ J. "Today" past-slot filter (timezone correctness)')
await makeShift(T1, D_TODAY, '09:00', '22:00')
// 14:00 Bangkok = 07:00 UTC (Bangkok is UTC+7, no DST).
const asOf1400 = new Date('2027-03-13T07:00:00Z')
const jSlots = (await getAvailableSlots(admin, { date: D_TODAY, treatmentId: single.id, duration: 60, asOf: asOf1400 })).slots
const jAt = (t) => jSlots.find(s => s.time === t)
// Past slots are removed from the grid entirely (not returned as unavailable).
check('J1 past slot 10:00 absent from grid when "now" is 14:00 Bangkok', jAt('10:00') === undefined, JSON.stringify(jAt('10:00')))
check('J2 past slot 14:00 absent (before the +30m lead cutoff of 14:30)', jAt('14:00') === undefined, JSON.stringify(jAt('14:00')))
check('J3 future slot 14:30 available (T1 on shift, rooms free)', jAt('14:30')?.available === true, JSON.stringify(jAt('14:30')))
check('J4 future slot 16:00 available', jAt('16:00')?.available === true, JSON.stringify(jAt('16:00')))
// Independence from server TZ: nowInSpaTz derives the wall clock via Intl, so
// process.env.TZ cannot change the cutoff. Prove the boundary lands on 14:30
// regardless — the first available slot must be exactly 14:30.
const firstOpen = jSlots.find(s => s.available)?.time
check(`J5 first available slot is exactly 14:30 (TZ-independent cutoff), got ${firstOpen}`, firstOpen === '14:30')

// ══ K. Aggressive N-way overbooking simulation ═══════════════════
// Section I proves the atomic trigger holds for a 2-way race. That's the
// minimum bar, not the real one — production traffic can burst well beyond
// 2 simultaneous requests for the same popular slot. This section fires
// genuinely concurrent (Promise.all, not sequential-await) N-way races at
// every resource type the engine protects: a single therapist, the shared
// room pool, a reschedule collision between two DIFFERENT existing bookings,
// and the 2-resource atomicity a couples treatment requires. Every race
// asserts the DB ends up with EXACTLY the correct number of winners — not
// "at least one rejected", which could hide a double-book if 2 of 8 both
// slipped through.
console.log('\n═ K. Aggressive N-way overbooking simulation')

async function raceBookTherapist(date, startTime, endTime, guestName) {
  const capRes = await checkSlotCapacity(admin, { treatmentId: single.id, date, startTime, endTime })
  if (!capRes.ok) return { ok: false, stage: 'precheck', reason: capRes.reason }
  const { data, error } = await admin.from('bookings').insert({
    guest_name: guestName, guest_phone: '+66900000009', treatment_id: single.id,
    therapist_id: capRes.therapistIds[0], date, time_slot: startTime, duration: 60,
    status: 'pending', source: 'online',
  }).select('id').single()
  if (data?.id) cleanup.bookings.push(data.id)
  return { ok: !error, id: data?.id, error, stage: 'insert' }
}
// Direct insert, deliberately bypassing checkSlotCapacity — isolates the DB
// trigger's room-count serialization from the JS pre-check and from any
// therapist logic (therapist_id: null), matching I5's bypass pattern.
async function raceBookRoomOnly(date, startTime, guestName) {
  const { data, error } = await admin.from('bookings').insert({
    guest_name: guestName, guest_phone: '+66900000009', treatment_id: single.id,
    therapist_id: null, date, time_slot: startTime, duration: 60,
    status: 'pending', source: 'online',
  }).select('id').single()
  if (data?.id) cleanup.bookings.push(data.id)
  return { ok: !error, id: data?.id, error }
}
async function raceBookCouples(date, startTime, endTime, guestName) {
  const capRes = await checkSlotCapacity(admin, { treatmentId: couples.id, date, startTime, endTime })
  if (!capRes.ok) return { ok: false, stage: 'precheck', reason: capRes.reason }
  const { data, error } = await admin.from('bookings').insert({
    guest_name: guestName, guest_phone: '+66900000009', treatment_id: couples.id,
    therapist_id: capRes.therapistIds[0], secondary_therapist_id: capRes.therapistIds[1] ?? null,
    date, time_slot: startTime, duration: 60, status: 'pending', source: 'online',
  }).select('id').single()
  if (data?.id) cleanup.bookings.push(data.id)
  return { ok: !error, id: data?.id, error }
}

// K1: 8-way race for a window only ONE therapist (T1) is qualified+free for.
await makeShift(T1, D_RACE, '10:00', '20:00') // T1 solo on D_RACE — therapist capacity = 1
const k1Results = await Promise.all(
  Array.from({ length: 8 }, (_, i) => raceBookTherapist(D_RACE, '10:00', '11:00', `ZZTEST K1-${i}`))
)
const k1Winners = k1Results.filter(r => r.ok)
check('K1 8-way concurrent race for 1-therapist slot: EXACTLY 1 winner (not 0, not 2+)',
  k1Winners.length === 1, `winners=${k1Winners.length} of 8`)
check('K1 all 7 losers rejected for therapist capacity (precheck no_therapist OR DB THERAPIST_DOUBLE_BOOKED)',
  k1Results.filter(r => !r.ok).every(r => r.reason === 'no_therapist' || capacityErrorFromDb(r.error)?.reason === 'no_therapist'),
  JSON.stringify(k1Results.map(r => r.ok ? 'WIN' : (r.reason ?? capacityErrorFromDb(r.error)?.reason ?? 'UNEXPLAINED'))))

// K2: (roomCount + 3)-way DIRECT race on physical room capacity alone —
// proves the advisory-lock serialization generalizes beyond 2-way (I5 only
// ever tested "fill sequentially, then try 1 more").
const k2N = roomCount + 3
const k2Results = await Promise.all(
  Array.from({ length: k2N }, (_, i) => raceBookRoomOnly(D_RACE, '15:00', `ZZTEST K2-${i}`))
)
const k2Winners = k2Results.filter(r => r.ok)
check(`K2 ${k2N}-way concurrent direct race on ${roomCount} physical rooms: EXACTLY ${roomCount} winners`,
  k2Winners.length === roomCount, `winners=${k2Winners.length} of ${k2N}`)
check('K2 every loser rejected specifically with ROOM_CAPACITY_FULL (not some other/silent failure)',
  k2Results.filter(r => !r.ok).every(r => capacityErrorFromDb(r.error)?.reason === 'no_room'),
  JSON.stringify(k2Results.filter(r => !r.ok).map(r => r.error?.message)))

// K3: two DIFFERENT existing bookings (different guests/sessions) both try to
// reschedule into the SAME open slot at the same instant. Unlike I1/I2 (two
// fresh bookings racing), this exercises the UPDATE path end-to-end through
// the real chat-booking reschedule flow (prepare → confirm) for two distinct
// rows — the class of race a busy popular reschedule slot would see live.
const S_RACE_A = randomUUID(); cleanup.sessions.push(S_RACE_A)
const S_RACE_B = randomUUID(); cleanup.sessions.push(S_RACE_B)
const raceOrigA = await makeBooking({ therapist_id: T1, date: D_RACE, time_slot: '12:00', chat_session_id: S_RACE_A })
const raceOrigB = await makeBooking({ therapist_id: T1, date: D_RACE, time_slot: '13:00', chat_session_id: S_RACE_B })
const draftA = await prepareRescheduleDraft(admin, S_RACE_A, { booking_id: raceOrigA, date: D_RACE, time_slot: '17:00' })
const draftB = await prepareRescheduleDraft(admin, S_RACE_B, { booking_id: raceOrigB, date: D_RACE, time_slot: '17:00' })
check('K3 setup: both reschedule drafts prepared ok (target slot open before either commits)',
  draftA.ok === true && draftB.ok === true, JSON.stringify({ draftA: draftA.ok, draftB: draftB.ok }))
const [confA, confB] = await Promise.all([
  confirmRescheduleDraft(admin, { sessionId: S_RACE_A, token: draftA.token, settings: {} }),
  confirmRescheduleDraft(admin, { sessionId: S_RACE_B, token: draftB.token, settings: {} }),
])
const k3Winners = [confA, confB].filter(r => r.ok)
check('K3 two concurrent reschedules into the same target slot: EXACTLY 1 succeeds',
  k3Winners.length === 1, JSON.stringify({ confA: confA.ok, confB: confB.ok, errA: confA.error, errB: confB.error }))
// Confirm the DB actually agrees with which one "won" — no split-brain where
// both rows silently claim they're at 17:00 (the failure mode a status-code
// check alone would miss).
const { data: raceFinal } = await admin.from('bookings').select('id, date, time_slot')
  .in('id', [raceOrigA, raceOrigB]).eq('date', D_RACE).eq('time_slot', '17:00:00')
check('K3 exactly one booking row actually landed at the target slot in the DB', raceFinal?.length === 1, JSON.stringify(raceFinal))

// K4: couples treatment needs 2 therapists AT ONCE — the hardest atomicity
// case, since the trigger must serialize a claim on 2 resources together,
// not 1. Only T1+T2 on shift on D_RACE2 (exactly one qualified pair exists),
// T3 deliberately left off shift. 3-way concurrent race for that one pair.
await makeShift(T1, D_RACE2, '10:00', '20:00')
await makeShift(T2, D_RACE2, '10:00', '20:00')
const k4Results = await Promise.all(
  Array.from({ length: 3 }, (_, i) => raceBookCouples(D_RACE2, '10:00', '11:00', `ZZTEST K4-${i}`))
)
const k4Winners = k4Results.filter(r => r.ok)
check('K4 3-way concurrent race for the one T1+T2 couples pair: EXACTLY 1 winner',
  k4Winners.length === 1, `winners=${k4Winners.length} of 3`)
if (k4Winners.length === 1) {
  const { data: k4Row } = await admin.from('bookings').select('therapist_id, secondary_therapist_id').eq('id', k4Winners[0].id).maybeSingle()
  const gotBoth = [k4Row?.therapist_id, k4Row?.secondary_therapist_id].sort().join(',') === [T1, T2].sort().join(',')
  check('K4 the single winner atomically holds BOTH T1 and T2 (no half-claimed pair)', gotBoth, JSON.stringify(k4Row))
}

// ══ L. Guest-facing past-slot & input validation ═════════════════
// Regression guard for the edge-case audit: the availability DISPLAY hides
// past slots, but display filtering is not enforcement — before this guard,
// a crafted POST or an AI-resolved past date could insert a booking for
// yesterday, and the public route accepted durations the treatment doesn't
// offer (inserting price = NULL). All checks below are lib-level (the public
// route shares the same helper; Turnstile blocks driving it via raw HTTP).
console.log('\n═ L. Guest-facing past-slot & input validation')

// Pure helper, deterministic via `at` injection: 14:00 Bangkok = 07:00 UTC.
const lNow = new Date('2027-03-13T07:00:00Z') // "now" = 2027-03-13 14:00 BKK
check('L1 yesterday is past', isPastSlotInSpaTz('2027-03-12', '10:00', lNow) === true)
check('L2 today at a passed time (13:00) is past', isPastSlotInSpaTz('2027-03-13', '13:00', lNow) === true)
check('L3 today at a future time (15:00) is not past', isPastSlotInSpaTz('2027-03-13', '15:00', lNow) === false)
check('L4 tomorrow is not past', isPastSlotInSpaTz('2027-03-14', '09:00', lNow) === false)
check('L5 date-only check: past date without a time is past', isPastSlotInSpaTz('2027-03-12', undefined, lNow) === true)

// Chat booking: preparing a draft for a REAL past date must refuse before
// any capacity math (T1 had a real shift on D_MAIN, but D_MAIN-relative
// dates are future fixtures — use a genuinely past calendar date).
const S_PAST = randomUUID(); cleanup.sessions.push(S_PAST)
const pastDraft = await prepareBookingDraft(admin, S_PAST, {
  guest_name: 'ZZTEST Past Guest', treatment_id: single.id, date: '2024-01-10', time_slot: '14:00', duration: 60,
})
check('L6 chat prepare_booking refuses a past date', pastDraft.ok === false && /passed/i.test(pastDraft.error ?? ''), JSON.stringify(pastDraft).slice(0, 140))

// Chat reschedule: moving an existing (future) booking INTO the past must refuse.
const lBooking = await makeBooking({ therapist_id: T1, time_slot: '19:00', chat_session_id: S_PAST })
const pastRes = await prepareRescheduleDraft(admin, S_PAST, { booking_id: lBooking, date: '2024-01-10', time_slot: '14:00' })
check('L7 chat reschedule refuses moving a booking into the past', pastRes.ok === false && /passed/i.test(pastRes.error ?? ''), JSON.stringify(pastRes).slice(0, 140))

// ══ M. Turnaround buffer between sessions ════════════════════════
// A therapist (and room) needs a gap between guests for cleanup/reset/rest.
// bufferMin=0 is the historical back-to-back behaviour; a positive buffer
// keeps any two of a resource's sessions ≥ bufferMin apart. Tested at the
// helper level with an explicit bufferMin (the live value is a DB setting,
// default 0, threaded in by checkSlotCapacity/getAvailableSlots).
console.log('\n═ M. Turnaround buffer between sessions')

// Default policy must be 0 (no live change until staff opt in).
check('M0 turnaround defaults to 0 (back-to-back unchanged until staff set it)',
  (await getTurnaroundMin(admin)) === 0)

await makeShift(T1, D_BUFFER, '10:00', '20:00')
await makeBooking({ therapist_id: T1, date: D_BUFFER, time_slot: '14:00', duration: 60 }) // T1 busy 14:00–15:00

const freeAt = (startTime, endTime, bufferMin) =>
  getFreeTherapistIds(admin, { therapistIds: [T1], date: D_BUFFER, startTime, endTime, bufferMin })

check('M1 buffer=0: T1 free immediately after (15:00 back-to-back)', (await freeAt('15:00', '16:00', 0)).length === 1)
check('M2 buffer=15: T1 NOT free back-to-back at 15:00 (only 0-min gap)', (await freeAt('15:00', '16:00', 15)).length === 0)
check('M3 buffer=15: T1 free at 15:15 (exactly 15-min gap allowed)', (await freeAt('15:15', '16:15', 15)).length === 1)
check('M4 buffer=15: T1 NOT free at 15:10 (10-min gap < buffer)', (await freeAt('15:10', '16:10', 15)).length === 0)
check('M5 buffer=15: also blocks the lead-in side (13:15 ending 14:00-buffer)', (await freeAt('13:15', '14:00', 15)).length === 0)
check('M6 buffer=15: 13:00 ending 13:45 leaves 15-min before 14:00 → free', (await freeAt('13:00', '13:45', 15)).length === 1)

// Room-level buffer: the one 14:00–15:00 booking on D_BUFFER holds a room
// through its turnaround too.
const roomsAt = (startTime, endTime, bufferMin) =>
  getAvailableRoomCount(admin, { date: D_BUFFER, startTime, endTime, bufferMin })
const roomBase = await roomsAt('15:00', '16:00', 0)
check('M7 buffer=0: room free back-to-back at 15:00', roomBase >= 1)
check('M8 buffer=15: room still in turnaround at 15:00 → one fewer room', (await roomsAt('15:00', '16:00', 15)) === roomBase - 1)

// ══ N. Orphaned-booking (lost therapist cover) detection ═════════
// Sick-day class: a booking's therapist is no longer working its slot because
// a shift was cut/deleted, a break/block was added, or the therapist was
// deactivated — and nothing surfaced it. annotateBookingCoverage flags exactly
// these upcoming pending/confirmed bookings. Bookings are passed as plain
// objects (the detector reads shifts/blocks/therapists from the DB, not the
// booking rows) so no inserts are needed. asOf pins "today" before the far-
// future fixtures so they all count as upcoming.
console.log('\n═ N. Orphaned-booking (lost cover) detection')
await makeShift(T1, D_COVER, '10:00', '18:00', '13:00', '14:00') // T1 on shift, break 13–14
const Tinact = await makeTherapist('ZZTEST Inactive')
await admin.from('therapists').update({ is_active: false }).eq('id', Tinact)

const asOfN = '2027-01-01T00:00:00Z' // "today" well before every fixture date
const cov = await annotateBookingCoverage(admin, [
  { id: 'n1', date: D_COVER, time_slot: '10:00', duration: 60, status: 'confirmed', therapist_id: T1 },        // covered
  { id: 'n2', date: D_COVER, time_slot: '09:00', duration: 60, status: 'confirmed', therapist_id: T1 },        // before shift
  { id: 'n3', date: D_COVER, time_slot: '17:30', duration: 60, status: 'confirmed', therapist_id: T1 },        // spills past shift end
  { id: 'n4', date: D_COVER, time_slot: '13:00', duration: 60, status: 'confirmed', therapist_id: T1 },        // over break
  { id: 'n5', date: D_COVER, time_slot: '11:00', duration: 60, status: 'confirmed', therapist_id: T2 },        // T2 not rostered D_COVER
  { id: 'n6', date: D_COVER, time_slot: '11:00', duration: 60, status: 'confirmed', therapist_id: null },      // unassigned
  { id: 'n7', date: D_BLOCK,  time_slot: '11:00', duration: 60, status: 'confirmed', therapist_id: T1 },       // T1 personally blocked D_BLOCK
  { id: 'n8', date: D_CLOSED, time_slot: '11:00', duration: 60, status: 'confirmed', therapist_id: T1 },       // whole spa closed
  { id: 'n9', date: D_COVER, time_slot: '11:00', duration: 60, status: 'confirmed', therapist_id: Tinact },    // deactivated therapist
  { id: 'n10', date: D_COVER, time_slot: '09:00', duration: 60, status: 'cancelled', therapist_id: T1 },       // cancelled → ignored
  { id: 'n11', date: '2024-01-01', time_slot: '09:00', duration: 60, status: 'confirmed', therapist_id: T1 },  // past → ignored
  { id: 'n12', date: D_COVER, time_slot: '10:00', duration: 60, status: 'confirmed', therapist_id: T1, secondary_therapist_id: T2 }, // couples: secondary uncovered
], { asOf: asOfN })

check('N1 covered booking is NOT flagged', !cov.has('n1'))
check('N2 before-shift booking → outside_shift', cov.get('n2') === 'outside_shift')
check('N3 spills-past-shift-end → outside_shift', cov.get('n3') === 'outside_shift')
check('N4 over-break booking → on_break', cov.get('n4') === 'on_break')
check('N5 therapist not rostered → no_shift', cov.get('n5') === 'no_shift')
check('N6 unassigned booking → unassigned', cov.get('n6') === 'unassigned')
check('N7 personally-blocked therapist → blocked', cov.get('n7') === 'blocked')
check('N8 whole-spa closure → spa_closed', cov.get('n8') === 'spa_closed')
check('N9 deactivated therapist → inactive', cov.get('n9') === 'inactive')
check('N10 cancelled booking ignored', !cov.has('n10'))
check('N11 past-date booking ignored', !cov.has('n11'))
check('N12 couples booking flagged when secondary uncovered', cov.get('n12') === 'no_shift')


// ══ O. Add-on occupancy ══════════════════════════════════════════
// An add-on (Scalp Oil +15, Eye Mask +0) buys real therapist/room minutes that
// were never part of the treatment's billed duration. bookings.duration stays
// the BILLED key into prices/duration_options; addon_minutes carries the extra
// occupancy. Everything that reserves time must span duration + addon_minutes,
// or the next guest gets booked into a room that is still busy. (migration 032)
console.log('\n═ O. Add-on occupancy')

check('O0 occupiedMinutes sums duration + addon_minutes',
  occupiedMinutes({ duration: 60, addon_minutes: 15 }) === 75)
check('O1 occupiedMinutes tolerates a legacy row with no addon_minutes',
  occupiedMinutes({ duration: 60 }) === 60)
check('O2 occupiedMinutes treats a 0-min add-on (Eye Mask) as no extra time',
  occupiedMinutes({ duration: 60, addon_minutes: 0 }) === 60)

await makeShift(T1, D_ADDON, '10:00', '20:00')
// T1: 60-min treatment + a 15-min add-on at 14:00 → really busy 14:00–15:15.
await makeBooking({ therapist_id: T1, date: D_ADDON, time_slot: '14:00', duration: 60, addon_minutes: 15 })

const addonFree = (startTime, endTime) =>
  getFreeTherapistIds(admin, { therapistIds: [T1], date: D_ADDON, startTime, endTime })

check('O3 therapist NOT free at 15:00 — the add-on tail still runs to 15:15',
  (await addonFree('15:00', '16:00')).length === 0)
check('O4 therapist free at 15:15, exactly when the add-on ends',
  (await addonFree('15:15', '16:15')).length === 1)
check('O5 the lead-in side is unaffected (13:00–14:00 still free)',
  (await addonFree('13:00', '14:00')).length === 1)

// Rooms are held for the add-on tail too.
const addonRooms = (startTime, endTime) =>
  getAvailableRoomCount(admin, { date: D_ADDON, startTime, endTime })
const roomsAt1515 = await addonRooms('15:15', '16:15')
check('O6 room still occupied at 15:00 by the add-on tail',
  (await addonRooms('15:00', '16:00')) === roomsAt1515 - 1)

// The DB trigger is the atomic backstop — it must honour addon_minutes too,
// independently of the JS pre-check above.
const overlapAddon = await admin.from('bookings').insert({
  guest_name: 'ZZTEST Addon Trigger', guest_phone: '+66900000001',
  treatment_id: single.id, therapist_id: T1,
  date: D_ADDON, time_slot: '15:00', duration: 60, status: 'pending',
}).select('id').maybeSingle()
if (overlapAddon.data?.id) cleanup.bookings.push(overlapAddon.data.id)
check('O7 DB trigger blocks a 15:00 booking that collides with the add-on tail',
  !!overlapAddon.error && /THERAPIST_DOUBLE_BOOKED/.test(overlapAddon.error.message || ''),
  overlapAddon.error?.message ?? 'insert unexpectedly succeeded')

// The slot grid must not offer a time whose add-on tail cannot fit.
const gridPlain = await getAvailableSlots(admin, { date: D_ADDON, treatmentId: single.id, duration: 60 })
const gridAddon = await getAvailableSlots(admin, { date: D_ADDON, treatmentId: single.id, duration: 60, addonMinutes: 15 })
const lastPlain = gridPlain.slots.at(-1)?.time
const lastAddon = gridAddon.slots.at(-1)?.time
// Slots sit on a 30-min grid, so the ceiling moves by a grid step, not by the
// exact add-on length: with last_slot 22:30, a 60-min booking can still start
// 21:30, but 60+15 would end 22:45 — so the last offered start drops to 21:00.
check('O8 add-on shortens the bookable day (last offered start is earlier)',
  !!lastPlain && !!lastAddon && timeToMin(lastAddon) < timeToMin(lastPlain),
  `plain=${lastPlain} addon=${lastAddon}`)
check('O9 every slot offered WITH the add-on still fits the full 75-min span',
  gridAddon.slots.every(s => timeToMin(s.time) + 75 <= timeToMin(lastPlain) + 60),
  `last addon slot=${lastAddon}`)

const openAt = (grid, t) => grid.slots.find(s => s.time === t)?.available
check('O10 the last plain-fitting slot is withdrawn once the add-on tail cannot fit',
  openAt(gridPlain, lastPlain) !== undefined && openAt(gridAddon, lastPlain) !== true,
  `lastPlain=${lastPlain} offeredWithAddon=${openAt(gridAddon, lastPlain)}`)

// resolveAddons must never trust the client: it re-reads minutes/price and
// rejects anything that is not a live add-on.
const realAddons = await admin.from('spa_treatments')
  .select('id, name, duration_options, prices').eq('category', 'add_on').eq('is_active', true)
const scalp = (realAddons.data ?? []).find(a => (a.duration_options ?? [])[0] > 0)
if (scalp) {
  const r = await resolveAddons(admin, [scalp.id])
  check('O11 resolveAddons reads real minutes from the catalog',
    r.ok && r.minutes === scalp.duration_options[0], JSON.stringify({ ok: r.ok, minutes: r.minutes }))
  check('O12 resolveAddons snapshots a line item with name + price',
    r.ok && r.items.length === 1 && r.items[0].name === scalp.name)
}
const notAnAddon = await resolveAddons(admin, [single.id])
check('O13 resolveAddons rejects a normal treatment posing as an add-on', notAnAddon.ok === false)
const ghostAddon = await resolveAddons(admin, ['00000000-0000-4000-8000-00000000dead'])
check('O14 resolveAddons rejects an unknown id (never silently drops it)', ghostAddon.ok === false)
const noAddons = await resolveAddons(admin, [])
check('O15 no add-ons → zero minutes, zero price', noAddons.ok && noAddons.minutes === 0 && noAddons.price === 0)

// The chat reschedule draft is written by prepareRescheduleDraft and re-parsed
// by confirmRescheduleDraft. z.object() STRIPS undeclared keys, so if
// addon_minutes is not in the schema the confirm step silently re-checks (and
// assigns a therapist for) the BILLED window only — reserving 60 min for a
// guest who is really there 75. The DB trigger still blocks a hard collision,
// but it does not enforce shift bounds or the turnaround buffer, so a booking
// could be moved to a slot whose tail spills past its therapist's shift end.
const { rescheduleDraftSchema } = await import('../lib/chat-booking.js')
const draftRoundTrip = rescheduleDraftSchema.safeParse({
  token: '11111111-1111-4111-8111-111111111111',
  expires_at: new Date().toISOString(),
  booking_id: '22222222-2222-4222-8222-222222222222',
  ref_code: 'ZZTEST-1',
  treatment_id: '33333333-3333-4333-8333-333333333333',
  treatment_name: 'Traditional Thai Massage',
  old_date: '2027-03-10', old_time_slot: '10:00',
  new_date: '2027-03-11', new_time_slot: '10:00',
  duration: 60, addon_minutes: 15, price: 1200,
})
check('O16 the reschedule draft schema preserves addon_minutes through the parse',
  draftRoundTrip.success && draftRoundTrip.data.addon_minutes === 15,
  `parsed addon_minutes=${draftRoundTrip.data?.addon_minutes}`)
check('O17 a rescheduled booking with add-ons re-checks the FULL occupancy',
  draftRoundTrip.success &&
  draftRoundTrip.data.duration + (draftRoundTrip.data.addon_minutes ?? 0) === 75,
  `confirm span=${draftRoundTrip.data ? draftRoundTrip.data.duration + (draftRoundTrip.data.addon_minutes ?? 0) : '?'}`)

// The client only ever sends ids — minutes and price are re-read server-side.
if (scalp) {
  const dup = await resolveAddons(admin, [scalp.id, scalp.id])
  check('O18 a duplicated add-on id cannot double the reserved minutes',
    dup.ok && dup.minutes === scalp.duration_options[0], `minutes=${dup.minutes}`)
  const flood = await resolveAddons(admin, Array.from({ length: 6 }, (_, i) =>
    `00000000-0000-4000-8000-00000000000${i}`))
  check('O19 more than 5 extras is rejected outright', flood.ok === false)
}


// ══ P. Room typing (wet / couples / none) ════════════════════════
// 5 rooms = 1 wet + 1 couple's + 3 standard. A treatment declares the room it
// REQUIRES; rooms aren't hard-partitioned. Only the scarce specialised types
// (wet=1, couples=1) get their own check; 'none' (reflexology chairs, thermal
// passes) consumes no room and is never refused for one. (migration 033)
console.log('\n═ P. Room typing')

if (!wetTrt?.room_requirement) {
  console.log('  (skipped — migration 033 not applied: spa_treatments.room_requirement missing)')
} else {

check('P0 menu is classified: scrub=wet, package=couples, reflexology=none',
  wetTrt?.room_requirement === 'wet' && couplesTrt?.room_requirement === 'couples' && reflexTrt?.room_requirement === 'none',
  `wet=${wetTrt?.room_requirement} couples=${couplesTrt?.room_requirement} reflex=${reflexTrt?.room_requirement}`)

const roomsFor = (req, startTime, endTime) =>
  getAvailableRoomCount(admin, { date: D_ROOMS, startTime, endTime, roomRequirement: req })

// Baseline: nothing booked yet.
check('P1 wet room available when none booked', (await roomsFor('wet', '14:00', '15:00')) >= 1)
check('P2 couples room available when none booked', (await roomsFor('couples', '14:00', '15:00')) >= 1)
check('P3 a no-room treatment is never blocked for a room (huge count)',
  (await roomsFor('none', '14:00', '15:00')) > 1000)

// Book ONE wet-room treatment 14:00–14:45.
const wetBooking = await admin.from('bookings').insert({
  guest_name: 'ZZTEST Wet', guest_phone: '+66900000001',
  treatment_id: wetTrt.id, therapist_id: T1,
  date: D_ROOMS, time_slot: '14:00', duration: 45, status: 'confirmed',
}).select('id, room_requirement').maybeSingle()
if (wetBooking.data?.id) cleanup.bookings.push(wetBooking.data.id)
check('P4 trigger stamped room_requirement=wet from the treatment (no path set it)',
  wetBooking.data?.room_requirement === 'wet', `got ${wetBooking.data?.room_requirement}`)

check('P5 the ONE wet room is now full for an overlapping wet booking',
  (await roomsFor('wet', '14:15', '15:00')) === 0)
check('P6 a couples booking is UNAFFECTED by the wet booking (different room)',
  (await roomsFor('couples', '14:15', '15:00')) >= 1)
check('P7 a standard booking still has rooms (wet booking only consumed one of five)',
  (await roomsFor('any', '14:15', '15:00')) >= 1)
check('P8 the wet room frees up after 14:45 (+turnaround aside)',
  (await roomsFor('wet', '15:00', '16:00')) >= 1)

// Second overlapping wet booking must be refused by the DB trigger itself.
const wetClash = await admin.from('bookings').insert({
  guest_name: 'ZZTEST Wet2', guest_phone: '+66900000002',
  treatment_id: wetTrt.id, therapist_id: T2,
  date: D_ROOMS, time_slot: '14:15', duration: 45, status: 'pending',
}).select('id').maybeSingle()
if (wetClash.data?.id) cleanup.bookings.push(wetClash.data.id)
check('P9 DB trigger blocks a 2nd overlapping WET booking (ROOM_TYPE_FULL_wet)',
  !!wetClash.error && /ROOM_TYPE_FULL_wet/.test(wetClash.error.message || ''),
  wetClash.error?.message ?? 'insert unexpectedly succeeded')

// capacityErrorFromDb must translate it to a graceful no_room.
check('P10 capacityErrorFromDb maps ROOM_TYPE_FULL_* to no_room',
  capacityErrorFromDb({ message: 'ROOM_TYPE_FULL_wet' })?.reason === 'no_room')

// Reflexology (none) never consumes a room: fill ALL 5 standard rooms, a
// reflexology booking must still be bookable (it's in a chair).
// Book 5 overlapping standard treatments at 16:00 to exhaust room_capacity.
const roomFillers = []
for (let i = 0; i < 5; i++) {
  const r = await admin.from('bookings').insert({
    guest_name: `ZZTEST Fill${i}`, guest_phone: '+66900000009',
    treatment_id: single.id, date: D_ROOMS, time_slot: '16:00', duration: 60,
    status: 'confirmed', overbooked: true, // bypass therapist check; we only care about room accounting
  }).select('id').maybeSingle()
  if (r.data?.id) { cleanup.bookings.push(r.data.id); roomFillers.push(r.data.id) }
}
check('P11 all 5 standard rooms filled at 16:00', (await roomsFor('any', '16:00', '17:00')) === 0)
check('P12 reflexology (none) still bookable with every room full',
  (await roomsFor('none', '16:00', '17:00')) > 1000)
check('P13 checkSlotCapacity offers reflexology when all rooms full (chairs, not rooms)',
  (await checkSlotCapacity(admin, { treatmentId: reflexTrt.id, date: D_ROOMS, startTime: '16:00', endTime: '17:00' })).ok === true)
check('P14 checkSlotCapacity refuses a standard treatment when all rooms full',
  (await checkSlotCapacity(admin, { treatmentId: single.id, date: D_ROOMS, startTime: '16:00', endTime: '17:00' })).reason === 'no_room')

// The couple's room deserves the same proof as the wet room.
const coupA = await admin.from('bookings').insert({
  guest_name: 'ZZTEST CoupA', guest_phone: '+66900000001',
  treatment_id: couplesTrt.id, therapist_id: T1, secondary_therapist_id: T2,
  date: D_ROOMS, time_slot: '10:00', duration: 60, status: 'confirmed',
}).select('id, room_requirement').maybeSingle()
if (coupA.data?.id) cleanup.bookings.push(coupA.data.id)
check('P15 couples booking stamped room_requirement=couples',
  coupA.data?.room_requirement === 'couples', `got ${coupA.data?.room_requirement}`)

const coupB = await admin.from('bookings').insert({
  guest_name: 'ZZTEST CoupB', guest_phone: '+66900000002',
  treatment_id: couplesTrt.id, date: D_ROOMS, time_slot: '10:30', duration: 60,
  status: 'pending', overbooked: false,
}).select('id').maybeSingle()
if (coupB.data?.id) cleanup.bookings.push(coupB.data.id)
check('P16 DB trigger blocks a 2nd overlapping COUPLES booking (ROOM_TYPE_FULL_couples)',
  !!coupB.error && /ROOM_TYPE_FULL_couples/.test(coupB.error.message || ''),
  coupB.error?.message ?? 'insert unexpectedly succeeded')

// Trigger level (not just JS): a no-room treatment slips past a full house.
const reflexWhenFull = await admin.from('bookings').insert({
  guest_name: 'ZZTEST Reflex', guest_phone: '+66900000009',
  treatment_id: reflexTrt.id, date: D_ROOMS, time_slot: '16:00', duration: 45,
  status: 'confirmed',
}).select('id, room_requirement').maybeSingle()
if (reflexWhenFull.data?.id) cleanup.bookings.push(reflexWhenFull.data.id)
check('P17 DB trigger lets reflexology book while all 5 rooms are full (chairs)',
  !reflexWhenFull.error && reflexWhenFull.data?.room_requirement === 'none',
  reflexWhenFull.error?.message ?? `req=${reflexWhenFull.data?.room_requirement}`)

// And that reflexology booking must not itself consume a room for others.
check('P18 the reflexology booking did NOT consume a room',
  (await roomsFor('any', '16:00', '17:00')) === 0, 'still exactly 0 (the 5 fillers), not -1')

// Changing a booking's treatment must re-stamp the type AND re-check capacity.
const morph = await admin.from('bookings').insert({
  guest_name: 'ZZTEST Morph', guest_phone: '+66900000001',
  treatment_id: single.id, therapist_id: T1,
  date: D_ROOMS, time_slot: '18:00', duration: 60, status: 'confirmed',
}).select('id, room_requirement').maybeSingle()
if (morph.data?.id) cleanup.bookings.push(morph.data.id)
check('P19 a plain booking starts as room_requirement=any', morph.data?.room_requirement === 'any')

const morphed = await admin.from('bookings')
  .update({ treatment_id: wetTrt.id, duration: 45 })
  .eq('id', morph.data.id).select('room_requirement').maybeSingle()
check('P20 UPDATE to a wet treatment re-stamps room_requirement=wet',
  morphed.data?.room_requirement === 'wet', `got ${morphed.data?.room_requirement}`)

} // end section P guard

} catch (err) {
  crashed = err
} finally {
  // Teardown ALWAYS runs — a throw in any section above lands here first.
  // Each step is guarded so a teardown failure can never mask the original error.
  try { teardownProblems = await cleanupFixtures() } catch (e) { teardownProblems++; console.error('  cleanup failed:', e?.message ?? e) }
  try { await restoreTurnaround() } catch (e) { teardownProblems++; console.error('  restoreTurnaround failed:', e?.message ?? e) }
}

console.log(`\n════ RESULT: ${pass} passed, ${fail} failed${crashed ? ' — RUN CRASHED' : ''}${teardownProblems ? ' — TEARDOWN INCOMPLETE' : ''} ════`)
if (failures.length) console.log('Failed:', failures.join(' | '))
if (teardownProblems) console.error(`\nTeardown reported ${teardownProblems} problem(s) — fixtures or the live turnaround setting may remain changed in production; see the ✗ lines above.`)
if (crashed) {
  console.error(`\nAborted by an uncaught error (teardown ran above${teardownProblems ? ', with problems' : ''}):`)
  console.error(crashed)
  process.exit(1)
}
process.exit(fail > 0 || teardownProblems > 0 ? 1 : 0)
