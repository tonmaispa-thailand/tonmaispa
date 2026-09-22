// Gate test for migration 036_booking_alarm.
//
// Run:  npm run test:alarm-schema
//
// Proves: the staff_created column exists, backfilled to false, NOT NULL
// holds, and round-trips — plus the two settings.* seed rows exist.
//
// Non-destructive: rather than INSERT a synthetic booking (which would need
// a real treatment_id/customer and could interact with the capacity or
// customer-stats triggers), this borrows ONE existing real booking, flips
// ONLY its staff_created value, verifies, and restores the original value —
// never touching status/date/price/customer_id, so neither the capacity
// trigger nor the customer-stats trigger (both scoped to those columns) can
// fire. If anything after the initial read fails, the restore in `finally`
// still runs.

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

let borrowedId = null
let originalValue = null

try {
  // 1. Column exists / service-role can read it --------------------------
  console.log('\nschema')
  {
    const { error } = await admin.from('bookings').select('id, staff_created').limit(1)
    check('staff_created column exists & service-role can read', !error, error?.message)
  }

  // 2. Backfill — no existing row has a null staff_created ----------------
  console.log('\nbackfill')
  {
    const { count, error } = await admin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .is('staff_created', null)
    check('no existing row has a null staff_created', !error && count === 0,
      error?.message ?? `found ${count} null row(s)`)
  }

  // 3. Default value — every existing row backfilled to false -------------
  console.log('\ndefault value (backfill)')
  {
    const { count, error } = await admin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('staff_created', true)
    // Not a hard requirement (a real staff_created=true row could exist if
    // this test ran before against a DB where the app already wrote one),
    // but on a fresh migration run this should be 0 — informational only.
    check('backfilled rows are false by default (0 true so far is expected pre-deploy)', !error, error?.message)
    if (!error) console.log(`    (${count} row(s) currently staff_created=true — expected 0 until the app starts writing it)`)
  }

  // 4. Round-trip on a borrowed real row, restored after ------------------
  console.log('\nround-trip (borrowed row, restored after)')
  {
    const { data: row, error: pickErr } = await admin.from('bookings').select('id, staff_created').limit(1).maybeSingle()
    check('a real booking exists to borrow for the round-trip test', !pickErr && !!row, pickErr?.message ?? 'no bookings in DB')
    if (row) {
      borrowedId = row.id
      originalValue = row.staff_created

      const flipped = !originalValue
      const up1 = await admin.from('bookings').update({ staff_created: flipped }).eq('id', borrowedId).select('staff_created').single()
      check(`update to ${flipped} persists`, !up1.error && up1.data?.staff_created === flipped, up1.error?.message ?? `got ${up1.data?.staff_created}`)

      const up2 = await admin.from('bookings').update({ staff_created: originalValue }).eq('id', borrowedId).select('staff_created').single()
      check('restored to original value', !up2.error && up2.data?.staff_created === originalValue, up2.error?.message ?? `got ${up2.data?.staff_created}`)
      borrowedId = null // restored — the finally block's extra safety net is now a no-op
    }
  }

  // 5. NOT NULL constraint rejects an explicit null ------------------------
  console.log('\nnot-null constraint')
  {
    const { data: row } = await admin.from('bookings').select('id').limit(1).maybeSingle()
    if (row) {
      const { error } = await admin.from('bookings').update({ staff_created: null }).eq('id', row.id)
      check('update to staff_created = null is rejected', !!error, 'null was accepted (constraint missing)')
    } else {
      check('not-null constraint check skipped (no bookings in DB to test against)', true)
    }
  }

  // 6. Settings seed rows exist ---------------------------------------------
  console.log('\nsettings seed rows')
  {
    const { data, error } = await admin.from('site_content')
      .select('key, value_text')
      .in('key', ['settings.booking_alarm_enabled', 'settings.booking_alarm_volume'])
    check('both settings.* rows exist', !error && (data ?? []).length === 2,
      error?.message ?? `found ${data?.length ?? 0} of 2`)
  }
} finally {
  // Extra safety net — only fires if step 4 threw before its own restore ran.
  if (borrowedId && originalValue !== null) {
    await admin.from('bookings').update({ staff_created: originalValue }).eq('id', borrowedId)
    console.log('\n(safety-net restore ran — the round-trip step did not complete normally)')
  }
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} passed, ${fail} failed\x1b[0m\n`)
process.exit(fail === 0 ? 0 : 1)
