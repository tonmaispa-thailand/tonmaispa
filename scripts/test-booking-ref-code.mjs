// Gate test for migration 038_booking_ref_code_no_truncate.
//
// Run:  npm run test:refcode
//
// Background: bookings.ref_code is filled by the set_booking_ref_code() trigger
// as 'TMS-' || LPAD(nextval('booking_ref_seq')::text, 3, '0'). PostgreSQL's
// LPAD truncates input that is already longer than the target length, so once
// booking_ref_seq passed 999 (2026-10-29) the values 1000..1009 all became
// 'TMS-100', 1010..1019 'TMS-101', … — and because ref_code is UNIQUE, roughly
// 9 in 10 inserts that relied on the trigger (public widget, chatbot, dashboard,
// WhatsApp booking-request form) failed with bookings_ref_code_key. Migration
// 038 pads to a MINIMUM of 3 digits and never truncates (TMS-999 → TMS-1000 …).
//
// Proves, against the REAL database:
//   - 12 back-to-back inserts without a ref_code ALL succeed      (RED before 038)
//   - every generated code matches ^TMS-\d{3,}$, is unique, strictly increasing
//   - 8 concurrent inserts (the K2 race regime) all succeed, unique (RED before 038)
//   - an explicit ref_code is respected (the trigger only fills blanks)
//
// Non-destructive: every row is status='cancelled' (ignored by the capacity and
// room-typing triggers, by availability, and by the dashboard alarm), on a
// far-future date, guest_name tagged 'ZZTEST refcode …', phone = the booking
// suite's test phone, and deleted in a finally block (booking_logs first). It
// does consume booking_ref_seq values — harmless, gaps are expected.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] ??= m[2].trim()
}

const url    = process.env.NEXT_PUBLIC_SUPABASE_URL
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !svcKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const admin = createClient(url, svcKey, { auth: { persistSession: false } })

let pass = 0, fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ' — ' + detail : ''}`) }
}

const TEST_DATE  = '2027-05-05'
const TEST_PHONE = '+66900000009'           // same throwaway phone as scripts/test-booking-engine.mjs
const TAG        = `ZZTEST refcode ${Date.now()}`
const startedAt  = new Date().toISOString()
const created    = []                        // booking ids this run inserted
const num        = code => Number(String(code).replace(/^TMS-/, ''))

let treatment
async function insertOne(label, extra = {}) {
  const { data, error } = await admin.from('bookings').insert({
    guest_name: `${TAG} ${label}`, guest_phone: TEST_PHONE, treatment_id: treatment.id,
    therapist_id: null, date: TEST_DATE, time_slot: '10:00', duration: 60,
    status: 'cancelled', source: 'walk_in', ...extra,
  }).select('id, ref_code').single()
  if (data?.id) created.push(data.id)
  return { ok: !error, code: data?.ref_code, error: error?.message }
}
const distinctErrors = rows => [...new Set(rows.map(r => r.error))].join(' | ')

try {
  // Any treatment row works as the FK target: the rows are cancelled, so the
  // treatment is never shown, scheduled, or counted. Deliberately not filtered
  // on is_active — the whole catalogue was once deactivated and this test must
  // still be able to run.
  const t = await admin.from('spa_treatments').select('id, name').order('sort_order').limit(1).maybeSingle()
  if (t.error || !t.data) throw new Error('no treatment row to attach test rows to: ' + (t.error?.message ?? 'spa_treatments is empty'))
  treatment = t.data

  console.log('\nsequential inserts (trigger-generated codes)')
  const seq = []
  for (let i = 0; i < 12; i++) seq.push(await insertOne(`seq-${i}`))
  const seqFails = seq.filter(r => !r.ok)
  check('12 back-to-back inserts without ref_code all succeed', seqFails.length === 0,
    `${seqFails.length} of 12 failed: ${distinctErrors(seqFails)}`)
  const codes = seq.filter(r => r.ok).map(r => r.code)
  const nums  = codes.map(num)
  check('every generated code matches ^TMS-\\d{3,}$', codes.length > 0 && codes.every(c => /^TMS-\d{3,}$/.test(c)), codes.join(','))
  check('generated codes are unique', new Set(codes).size === codes.length, codes.join(','))
  check('generated codes are strictly increasing', nums.every((n, i) => i === 0 || n > nums[i - 1]), nums.join(','))
  check('back-to-back successes are (near-)consecutive sequence values', codes.length > 1 && nums.every((n, i) => i === 0 || n - nums[i - 1] <= 3), nums.join(','))

  console.log('\nconcurrent inserts (the K2 race regime: 8 at once)')
  const con = await Promise.all(Array.from({ length: 8 }, (_, i) => insertOne(`con-${i}`)))
  const conFails = con.filter(r => !r.ok)
  check('8 concurrent inserts all succeed', conFails.length === 0, `${conFails.length} of 8 failed: ${distinctErrors(conFails)}`)
  const conCodes = con.filter(r => r.ok).map(r => r.code)
  check('concurrent codes are unique', new Set(conCodes).size === conCodes.length, conCodes.join(','))
  check('concurrent codes all come after the sequential ones', conCodes.length > 0 && nums.length > 0 && conCodes.every(c => num(c) > Math.max(...nums)), `${conCodes.join(',')} vs max ${Math.max(...nums)}`)

  console.log('\nexplicit ref_code is respected')
  const explicit = `ZZTEST-REF-${Date.now()}`
  const ex = await insertOne('explicit', { ref_code: explicit })
  check('insert with an explicit ref_code keeps it (trigger only fills blanks)', ex.ok && ex.code === explicit, ex.error ?? `got ${ex.code}`)
} finally {
  // Teardown: collected ids plus a sweep over this test's own namespace (any
  // 'ZZTEST refcode …' row on TEST_DATE, so a previous crashed run is swept too),
  // in FK order. Same shape as the booking suite's teardown.
  const { data: mine } = await admin.from('bookings').select('id').like('guest_name', 'ZZTEST refcode %').eq('date', TEST_DATE)
  const ids = [...new Set([...created, ...(mine ?? []).map(r => r.id)])]
  if (ids.length) {
    await admin.from('booking_logs').delete().in('booking_id', ids)
    const { error } = await admin.from('bookings').delete().in('id', ids)
    console.log(`\n  cleanup: ${ids.length} test booking(s) removed${error ? ' — ' + error.message : ''}`)
  }
  // If any trigger auto-created a customer for the test phone during this run, remove it too.
  await admin.from('customers').delete().eq('primary_phone_e164', TEST_PHONE).gte('created_at', startedAt)
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} passed, ${fail} failed\x1b[0m\n`)
process.exit(fail === 0 ? 0 : 1)
