// Hero-slideshow + About-photo selection for the homepage (migration 039).
// Writes go through two SQL functions so each change is one transaction.
export const HERO_MAX = 10
export const ABOUT_ALIGNS = ['left', 'center', 'right']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// DB exceptions are prefixed (HERO_LIMIT: …) — map them to a 400/409 instead of a 500.
function fail(error) {
  const msg = error?.message ?? 'Unknown error'
  const known = /^(HERO_LIMIT|HERO_DUPLICATE|HERO_UNKNOWN_ID|ABOUT_UNKNOWN_ID)/.test(msg)
  return { ok: false, status: known ? 400 : 500, error: msg }
}

// ids: ordered array of gallery_photos ids (max HERO_MAX). [] clears the hero selection.
export async function setHeroPhotos(admin, ids) {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !UUID.test(id))) {
    return { ok: false, status: 400, error: 'ids must be an array of photo ids' }
  }
  if (ids.length > HERO_MAX) return { ok: false, status: 400, error: `HERO_LIMIT: at most ${HERO_MAX} hero photos` }
  const { error } = await admin.rpc('set_gallery_hero', { p_ids: ids })
  return error ? fail(error) : { ok: true }
}

// id: photo id, or null to clear. align: which side to keep when the photo is cropped.
export async function setAboutPhoto(admin, id, align = 'center') {
  if (id !== null && (typeof id !== 'string' || !UUID.test(id))) return { ok: false, status: 400, error: 'id must be a photo id or null' }
  if (!ABOUT_ALIGNS.includes(align)) return { ok: false, status: 400, error: `align must be one of ${ABOUT_ALIGNS.join(', ')}` }
  const { error } = await admin.rpc('set_gallery_about', { p_id: id, p_align: align })
  return error ? fail(error) : { ok: true }
}

// Pure helpers used by the homepage: rows come from gallery_photos (selected columns only).
export function pickHeroSlides(rows = []) {
  return rows
    .filter(r => r.hero_order != null && r.cloudinary_url)
    .sort((a, b) => a.hero_order - b.hero_order)
    .slice(0, HERO_MAX)
    .map(r => ({ src: r.cloudinary_url, alt: r.alt_text || 'Ton Mai Spa, Rawai Phuket' }))
}
export function pickAboutImage(rows = []) {
  const r = rows.find(x => x.is_about && x.cloudinary_url)
  return r ? { src: r.cloudinary_url, alt: r.alt_text || 'Ton Mai Spa, Rawai Phuket', align: ABOUT_ALIGNS.includes(r.about_align) ? r.about_align : 'center' } : null
}
