// Gate test for migration 039_gallery_hero_about.
//
// Run:  npm run test:gallery-hero
//
// Proves, against the REAL database:
//   - hero_order / is_about / about_align exist with the right defaults
//   - set_gallery_hero: ordering, reorder, clear, 10-photo cap, duplicate and
//     unknown ids are rejected AND leave the previous selection untouched
//   - set_gallery_about: one About photo at a time, align validated
//   - the DB itself enforces the rules (CHECK 1..10, unique hero_order,
//     unique is_about, align CHECK) independently of the helper
//   - the anon key cannot call the selection functions
//   - the homepage pickers (pickHeroSlides / pickAboutImage) order + fall back
//
// The selection functions REPLACE the live hero/About choice, so the test
// snapshots it first and restores it in a finally block. Throwaway photos are
// tagged alt_text 'ZZTEST gallery gate', featured=false (never in the public
// gallery) and deleted in finally (plus a sweep for earlier crashed runs).

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { setHeroPhotos, setAboutPhoto, pickHeroSlides, pickAboutImage, HERO_MAX } from '../lib/gallery-hero.js'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] ??= m[2].trim()
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !svcKey) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local'); process.exit(1) }
const admin = createClient(url, svcKey, { auth: { persistSession: false } })

let pass = 0, fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ' — ' + detail : ''}`) }
}
const TAG = 'ZZTEST gallery gate'
const state = async (ids) => {
  const { data } = await admin.from('gallery_photos').select('id, hero_order, is_about, about_align').in('id', ids)
  return Object.fromEntries((data ?? []).map(r => [r.id, r]))
}
const heroIdsNow = async () => {
  const { data } = await admin.from('gallery_photos').select('id, hero_order').not('hero_order', 'is', null).order('hero_order')
  return (data ?? []).map(r => r.id)
}

let snapshot = null
let wrote = false // set only once the schema check passes; a red run (039 not applied) then performs NO writes at all
try {
  console.log('\nschema')
  {
    const { error } = await admin.from('gallery_photos').select('id, hero_order, is_about, about_align').limit(1)
    check('hero_order / is_about / about_align exist & are readable', !error, error?.message)
    if (error) throw new Error('migration 039 not applied — nothing else can be tested')
  }

  // sweep leftovers of a crashed earlier run, then snapshot the live selection
  wrote = true
  await admin.from('gallery_photos').delete().eq('alt_text', TAG)
  {
    const { data } = await admin.from('gallery_photos').select('id, hero_order, is_about, about_align')
    snapshot = {
      hero:  (data ?? []).filter(r => r.hero_order != null).sort((a, b) => a.hero_order - b.hero_order).map(r => r.id),
      about: (data ?? []).find(r => r.is_about) ?? null,
    }
    console.log(`  (live selection snapshot: ${snapshot.hero.length} hero photo(s), About ${snapshot.about ? 'set' : 'unset'} — restored at the end)`)
  }

  const rows = Array.from({ length: 12 }, (_, i) => ({ cloudinary_url: `https://res.cloudinary.com/zzz-gate-test/image/upload/zz${i}.jpg`, alt_text: TAG, featured: false, sort_order: 9999 }))
  const { data: made, error: insErr } = await admin.from('gallery_photos').insert(rows).select('id')
  if (insErr) throw new Error('fixture insert: ' + insErr.message)
  const ids = made.map(r => r.id)
  const [a, b, c] = ids

  console.log('\ndefaults')
  {
    const st = await state(ids)
    check('new photos default to hero_order NULL, is_about false, about_align center',
      ids.every(id => st[id].hero_order === null && st[id].is_about === false && st[id].about_align === 'center'))
  }

  console.log('\nhero selection')
  {
    let r = await setHeroPhotos(admin, [a, b, c])
    let st = await state([a, b, c])
    check('select 3 photos → orders 1,2,3', r.ok && st[a].hero_order === 1 && st[b].hero_order === 2 && st[c].hero_order === 3, JSON.stringify(r))
    r = await setHeroPhotos(admin, [c, a])
    st = await state([a, b, c])
    check('reorder/replace [c,a] → c=1, a=2, b removed', r.ok && st[c].hero_order === 1 && st[a].hero_order === 2 && st[b].hero_order === null)

    r = await setHeroPhotos(admin, ids.slice(0, HERO_MAX))
    check(`exactly ${HERO_MAX} photos accepted`, r.ok, JSON.stringify(r))
    const before = await heroIdsNow()

    r = await setHeroPhotos(admin, ids.slice(0, HERO_MAX + 1))
    check(`${HERO_MAX + 1} photos rejected by the helper`, !r.ok && r.status === 400 && /HERO_LIMIT/.test(r.error), JSON.stringify(r))
    const { error: dbCap } = await admin.rpc('set_gallery_hero', { p_ids: ids.slice(0, HERO_MAX + 1) })
    check(`${HERO_MAX + 1} photos rejected by the database too`, !!dbCap && /HERO_LIMIT/.test(dbCap.message), dbCap?.message)
    check('rejected call left the previous selection untouched', JSON.stringify(await heroIdsNow()) === JSON.stringify(before))

    r = await setHeroPhotos(admin, [a, a])
    check('duplicate id rejected, selection untouched', !r.ok && /HERO_DUPLICATE/.test(r.error) && JSON.stringify(await heroIdsNow()) === JSON.stringify(before), JSON.stringify(r))

    r = await setHeroPhotos(admin, [a, '00000000-0000-4000-8000-000000000000'])
    check('unknown id rejected and ROLLED BACK (selection untouched)', !r.ok && /HERO_UNKNOWN_ID/.test(r.error) && JSON.stringify(await heroIdsNow()) === JSON.stringify(before), JSON.stringify(r))

    r = await setHeroPhotos(admin, ['not-a-uuid'])
    check('non-uuid rejected by the helper', !r.ok && r.status === 400)

    const { error: ordErr } = await admin.from('gallery_photos').update({ hero_order: 11 }).eq('id', ids[11])
    check('CHECK rejects hero_order 11', !!ordErr, 'update succeeded')
    const { error: uniqErr } = await admin.from('gallery_photos').update({ hero_order: 1 }).eq('id', ids[11])
    check('UNIQUE rejects a duplicate hero_order', !!uniqErr, 'update succeeded')

    r = await setHeroPhotos(admin, [])
    check('empty array clears the hero selection', r.ok && (await heroIdsNow()).length === 0)
  }

  console.log('\nAbout photo')
  {
    let r = await setAboutPhoto(admin, a, 'left')
    let st = await state([a, b])
    check('set About = a (left)', r.ok && st[a].is_about && st[a].about_align === 'left', JSON.stringify(r))
    r = await setAboutPhoto(admin, b, 'right')
    st = await state([a, b])
    check('setting b moves About: a off, b on (right)', r.ok && !st[a].is_about && st[b].is_about && st[b].about_align === 'right')
    const { error: two } = await admin.from('gallery_photos').update({ is_about: true }).eq('id', a)
    check('UNIQUE index rejects a second About photo', !!two, 'update succeeded')
    r = await setAboutPhoto(admin, b, 'middle')
    check('invalid align rejected by the helper', !r.ok && r.status === 400)
    const { error: alignErr } = await admin.rpc('set_gallery_about', { p_id: b, p_align: 'middle' })
    check('invalid align rejected by the database (CHECK)', !!alignErr, alignErr?.message)
    check('rejected align left b unchanged', (await state([b]))[b].about_align === 'right' && (await state([b]))[b].is_about)
    r = await setAboutPhoto(admin, '00000000-0000-4000-8000-000000000000', 'left')
    st = await state([b])
    check('unknown id rejected and rolled back (b still About)', !r.ok && /ABOUT_UNKNOWN_ID/.test(r.error) && st[b].is_about, JSON.stringify(r))
    r = await setAboutPhoto(admin, null)
    check('null clears the About photo', r.ok && !(await state([a, b]))[b].is_about)
  }

  console.log('\npermissions')
  if (anonKey) {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } })
    const h = await anon.rpc('set_gallery_hero', { p_ids: [] })
    const ab = await anon.rpc('set_gallery_about', { p_id: null, p_align: 'center' })
    // Must be a privilege error, not just any error: Supabase grants EXECUTE to anon by default,
    // so a plain 'HERO_UNKNOWN_ID' failure would mean the REVOKE in 039 did not take effect.
    check('anon key cannot call set_gallery_hero / set_gallery_about', /permission denied/i.test(h.error?.message ?? '') && /permission denied/i.test(ab.error?.message ?? ''), `${h.error?.message} | ${ab.error?.message}`)
  } else console.log('  (skipped — no anon key in .env.local)')

  console.log('\nhomepage pickers')
  {
    const rowsIn = [
      { cloudinary_url: 'u3', alt_text: null, hero_order: 3, is_about: false, about_align: 'center' },
      { cloudinary_url: 'u1', alt_text: 'one', hero_order: 1, is_about: false, about_align: 'center' },
      { cloudinary_url: 'uA', alt_text: 'about', hero_order: null, is_about: true, about_align: 'right' },
    ]
    const slides = pickHeroSlides(rowsIn)
    check('pickHeroSlides orders by hero_order and skips non-hero rows', slides.map(s => s.src).join() === 'u1,u3')
    check('pickHeroSlides falls back to a default alt', slides[1].alt.length > 0)
    const about = pickAboutImage(rowsIn)
    check('pickAboutImage returns the About row with its align', about?.src === 'uA' && about.align === 'right')
    check('pickers return empty / null when nothing is selected (site keeps built-in photos)', pickHeroSlides([]).length === 0 && pickAboutImage([]) === null)
  }
} catch (e) {
  fail++
  console.log(`  \x1b[31m✗\x1b[0m run aborted — ${e.message}`)
} finally {
  console.log('\ncleanup')
  if (wrote) {
    const del = await admin.from('gallery_photos').delete().eq('alt_text', TAG)
    if (del.error) fail++
    console.log(`  ${del.error ? '✗' : '✓'} throwaway photos deleted${del.error ? ' — ' + del.error.message : ''}`)
  } else console.log('  (nothing was written — no cleanup needed)')
  if (snapshot) {
    const h = await setHeroPhotos(admin, snapshot.hero)
    const a = await setAboutPhoto(admin, snapshot.about?.id ?? null, snapshot.about?.about_align ?? 'center')
    const ok = h.ok && a.ok
    if (!ok) fail++
    console.log(`  ${ok ? '✓' : '✗'} live hero/About selection restored${ok ? '' : ' — ' + JSON.stringify([h, a])}`)
  }
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
