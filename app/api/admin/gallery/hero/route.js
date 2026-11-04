import { requireAdmin } from '@/lib/require-admin'
import { setHeroPhotos } from '@/lib/gallery-hero'

// PUT { ids: [photoId, …] } — replace the hero slideshow (ordered, max 10).
export async function PUT(req) {
  const auth = await requireAdmin()
  if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })
  const parsed = await req.json().catch(() => null)
  const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  const r = await setHeroPhotos(auth.admin, body.ids)
  return r.ok ? Response.json({ ok: true }) : Response.json({ error: r.error }, { status: r.status })
}
