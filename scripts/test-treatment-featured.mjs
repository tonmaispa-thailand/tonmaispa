// Gate test for migration 035_treatment_featured.
//
// Run:  npm run test:featured
//
// Proves the migration did what it claims, against the REAL database (per the
// repo's migration gate-test rule):
//   - the is_featured column exists and is readable by the service role
//   - NOT NULL DEFAULT false backfilled every existing row (no nulls)
//   - a new treatment defaults to is_featured = false
//   - it round-trips true/false via update
//   - the NOT NULL constraint actually rejects an explicit null
//
// Non-destructive: it creates its own throwaway, INACTIVE treatment (a unique
// slug, is_active = false so it can never appear on the site or in the Top 5),
// and deletes it in a finally block. Existing rows are only ever read.

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

// Throwaway rows carry this slug prefix so cleanup can find them even if a
// prior run crashed mid-way.
const TEST_SLUG = `zzz-featured-gate-test-${Date.now()}`
const TEST_SLUG_2 = `${TEST_SLUG}-notnull`

try {
  // 1. Column exists / service-role can read it -----------------------------
  console.log('\nschema')
  {
    const { error } = await admin.from('spa_treatments').select('id, is_featured').limit(1)
    check('is_featured column exists & service-role can read', !error, error?.message)
  }

  // 2. NOT NULL backfilled every existing row -------------------------------
  console.log('\nbackfill')
  {
    const { count, error } = await admin
      .from('spa_treatments')
      .select('id', { count: 'exact', head: true })
      .is('is_featured', null)
    check('no existing row has a null is_featured', !error && count === 0,
      error?.message ?? `found ${count} null row(s)`)
  }

  // 3. New row defaults to false --------------------------------------------
  console.log('\ndefault value')
  {
    const { data, error } = await admin.from('spa_treatments').insert({
      name: 'FEATURED GATE TEST — safe to delete',
      slug: TEST_SLUG,
      category: 'massage',
      is_active: false,           // never surfaces on the site or in the Top 5
    }).select('id, is_featured').single()
    check('insert without is_featured → defaults to false', !error && data?.is_featured === false,
      error?.message ?? `got ${data?.is_featured}`)
  }

  // 4. Round-trips true then back to false ----------------------------------
  console.log('\nround-trip')
  {
    const up = await admin.from('spa_treatments')
      .update({ is_featured: true }).eq('slug', TEST_SLUG).select('is_featured').single()
    check('update is_featured = true persists', !up.error && up.data?.is_featured === true,
      up.error?.message ?? `got ${up.data?.is_featured}`)

    const down = await admin.from('spa_treatments')
      .update({ is_featured: false }).eq('slug', TEST_SLUG).select('is_featured').single()
    check('update is_featured = false persists', !down.error && down.data?.is_featured === false,
      down.error?.message ?? `got ${down.data?.is_featured}`)
  }

  // 5. NOT NULL constraint rejects an explicit null -------------------------
  console.log('\nnot-null constraint')
  {
    const { error } = await admin.from('spa_treatments').insert({
      name: 'FEATURED GATE TEST NULL — safe to delete',
      slug: TEST_SLUG_2,
      category: 'massage',
      is_active: false,
      is_featured: null,
    }).select('id').single()
    check('insert with is_featured = null is rejected', !!error, 'null was accepted (constraint missing)')
  }
} finally {
  // Cleanup — remove any throwaway rows this run created.
  await admin.from('spa_treatments').delete().in('slug', [TEST_SLUG, TEST_SLUG_2])
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} passed, ${fail} failed\x1b[0m\n`)
process.exit(fail === 0 ? 0 : 1)
