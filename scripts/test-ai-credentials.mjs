// Gate test for migration 034_ai_credentials.
//
// Run:  npm run test:ai
//
// Proves the ONE thing this table exists to guarantee: the AI API key is
// unreachable by the public anon key (the crown-jewel RLS test), plus the
// singleton constraint and service-role read/write. Exercises the REAL
// database, per the repo's migration gate-test rule.
//
// Non-destructive: if a real BYOK row already exists at id = 1, it is read
// into memory first and restored byte-for-byte at the end, so running this on
// production never clobbers a live provider config.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] ??= m[2].trim()
}

const url     = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const svcKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !anonKey || !svcKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const admin = createClient(url, svcKey, { auth: { persistSession: false } })
const anon  = createClient(url, anonKey, { auth: { persistSession: false } })

const SENTINEL = 'sk-TESTONLY-must-never-be-readable-by-anon-4b2f9a'

let pass = 0, fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ' — ' + detail : ''}`) }
}

// NOTE on the `authenticated` role (code-review finding #2): the security claim
// covers anon AND authenticated. We probe anon here; a full authenticated-
// session probe would require minting a real auth user (out of bounds in this
// environment). The invariant that actually protects the authenticated role is
// "this table has ZERO RLS policies" — enforced by the migration + its comment.
// If anyone ever adds an `auth_read`-style policy (common elsewhere in 002),
// that invariant is broken; never add a policy to ai_credentials.

// ── Back up any real row so production is never clobbered ──────────────────
const { data: savedRow } = await admin.from('ai_credentials').select('*').eq('id', 1).maybeSingle()
if (savedRow) {
  console.log('\x1b[33m⚠ a real ai_credentials row exists — this test writes the singleton row.\x1b[0m')
  console.log('\x1b[33m  It is backed up and restored at the end, but prefer running on dev/staging.\x1b[0m')
}
await admin.from('ai_credentials').delete().eq('id', 1)

try {
  // 1. Table exists / service-role can read it -----------------------------
  console.log('\nschema')
  {
    const { error } = await admin.from('ai_credentials').select('id').limit(1)
    check('ai_credentials table exists & service-role can read', !error, error?.message)
  }

  // 2. Service-role can write the singleton row ----------------------------
  console.log('\nservice-role write')
  {
    const { error } = await admin.from('ai_credentials').insert({
      id: 1, provider: 'custom',
      base_url: 'https://example.test/anthropic',
      model: 'test-model',
      api_key: SENTINEL,
    })
    check('service-role can insert the config row', !error, error?.message)
  }

  // 3. CROWN JEWEL — anon CANNOT read the key ------------------------------
  // A row with a known secret now exists. The public anon key must see none of
  // it: RLS is on with no policy, so SELECT returns zero rows (not the secret).
  // On a permission error supabase-js returns data:null, which fails
  // Array.isArray — so "errored → []" cannot masquerade as a pass.
  console.log('\nRLS — anon must never read the key')
  {
    const { data, error } = await anon.from('ai_credentials').select('*')
    check('anon SELECT returns no rows (key hidden)', !error && Array.isArray(data) && data.length === 0,
      error ? `errored: ${error.message}` : `leaked ${data?.length} row(s)`)

    const leaked = JSON.stringify(data ?? '')
    check('sentinel api_key never appears in anon response', !leaked.includes(SENTINEL),
      'THE API KEY LEAKED TO ANON — do not ship')
  }

  // 4. anon CANNOT write either --------------------------------------------
  // Probe on an EMPTY table (delete the seed first) so a genuine RLS bypass
  // would SUCCEED rather than collide with the singleton PK — otherwise a
  // dup-key error (23505) could mask a bypass. Assert the specific RLS code
  // 42501 (insufficient_privilege), not just "some error" (finding #3).
  console.log('\nRLS — anon must never write')
  {
    await admin.from('ai_credentials').delete().eq('id', 1)
    const { error } = await anon.from('ai_credentials').insert({
      id: 1, base_url: 'https://evil.test', model: 'x', api_key: 'x',
    })
    check('anon INSERT is denied by RLS (code 42501)', error?.code === '42501',
      error ? `got code ${error.code}: ${error.message}` : 'anon was allowed to write')
    // Belt-and-suspenders: confirm nothing landed.
    const { data: after } = await admin.from('ai_credentials').select('id').eq('id', 1)
    check('anon INSERT left no row behind', Array.isArray(after) && after.length === 0,
      'an anon-written row persisted')
  }

  // 5. Singleton constraint — only id = 1 allowed --------------------------
  console.log('\nsingleton')
  {
    const { error } = await admin.from('ai_credentials').insert({
      id: 2, base_url: 'https://example.test', model: 'x', api_key: 'x',
    })
    check('second row (id = 2) is rejected by the singleton CHECK', !!error, 'a second row was allowed')
  }
} finally {
  // ── Restore original state, and PROVE the restore worked ───────────────
  // Silent restore failure would permanently lose a live BYOK config, so the
  // restore is verified by re-select and fails the suite loudly if it didn't
  // land (code-review finding #1).
  await admin.from('ai_credentials').delete().eq('id', 1)
  if (savedRow) {
    const { error: restoreErr } = await admin.from('ai_credentials').insert(savedRow)
    const { data: back } = await admin.from('ai_credentials').select('*').eq('id', 1).maybeSingle()
    if (restoreErr || !back || back.api_key !== savedRow.api_key) {
      console.error('\n\x1b[31m✗ FAILED TO RESTORE the original ai_credentials row!\x1b[0m')
      console.error('  Original config (re-enter it in Settings):', JSON.stringify(savedRow))
      process.exit(1)
    }
    console.log('\n(restored the pre-existing ai_credentials row — verified)')
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
