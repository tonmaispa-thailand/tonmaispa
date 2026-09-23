// Gate test for migration 037_show_in_pricing.
//
// Run:  npm run test:pricing-flag
//
// Proves the migration did what it claims, against the REAL database:
//   - the show_in_pricing column exists and is readable by the service role
//   - NOT NULL DEFAULT false backfilled every existing row (no nulls)
//   - a new treatment defaults to show_in_pricing = false
//   - it round-trips true/false via update
//   - the NOT NULL constraint actually rejects an explicit null
//
// Non-destructive: creates its own throwaway, INACTIVE treatment (a unique
// slug, is_active = false so it can never appear on the site), deleted in a
// finally block. Existing rows are only ever read. Same pattern as
// scripts/test-treatment-featured.mjs (migration 035).

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

const TEST_SLUG = `zzz-pricing-flag-gate-test-${Date.now()}`
const TEST_SLUG_2 = `${TEST_SLUG}-notnull`

try {
  console.log('\nschema')
  {
    const { error } = await admin.from('spa_treatments').select('id, show_in_pricing').limit(1)
    check('show_in_pricing column exists & service-role can read', !error, error?.message)
  }

  console.log('\nbackfill')
  {
    const { count, error } = await admin
      .from('spa_treatments')
      .select('id', { count: 'exact', head: true })
      .is('show_in_pricing', null)
    check('no existing row has a null show_in_pricing', !error && count === 0,
      error?.message ?? `found ${count} null row(s)`)
  }

  console.log('\ndefault value')
  {
    const { data, error } = await admin.from('spa_treatments').insert({
      name: 'PRICING FLAG GATE TEST — safe to delete',
      slug: TEST_SLUG,
      category: 'package',
      is_active: false, // never surfaces on the site
    }).select('id, show_in_pricing').single()
    check('insert without show_in_pricing → defaults to false', !error && data?.show_in_pricing === false,
      error?.message ?? `got ${data?.show_in_pricing}`)
  }

  console.log('\nround-trip')
  {
    const up = await admin.from('spa_treatments')
      .update({ show_in_pricing: true }).eq('slug', TEST_SLUG).select('show_in_pricing').single()
    check('update show_in_pricing = true persists', !up.error && up.data?.show_in_pricing === true,
      up.error?.message ?? `got ${up.data?.show_in_pricing}`)

    const down = await admin.from('spa_treatments')
      .update({ show_in_pricing: false }).eq('slug', TEST_SLUG).select('show_in_pricing').single()
    check('update show_in_pricing = false persists', !down.error && down.data?.show_in_pricing === false,
      down.error?.message ?? `got ${down.data?.show_in_pricing}`)
  }

  console.log('\nnot-null constraint')
  {
    const { error } = await admin.from('spa_treatments').insert({
      name: 'PRICING FLAG GATE TEST NULL — safe to delete',
      slug: TEST_SLUG_2,
      category: 'package',
      is_active: false,
      show_in_pricing: null,
    }).select('id').single()
    check('insert with show_in_pricing = null is rejected', !!error, 'null was accepted (constraint missing)')
  }
} finally {
  await admin.from('spa_treatments').delete().in('slug', [TEST_SLUG, TEST_SLUG_2])
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} passed, ${fail} failed\x1b[0m\n`)
process.exit(fail === 0 ? 0 : 1)
