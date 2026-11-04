import { requireAdmin } from '@/lib/require-admin'
import { setAboutPhoto } from '@/lib/gallery-hero'

// PUT { id: photoId | null, align?: 'left'|'center'|'right' } — set/clear the About photo.
export async function PUT(req) {
  const auth = await requireAdmin()
  if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })
  const parsed = await req.json().catch(() => null)
  const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  // `id` must be present (a photo id, or an explicit null to clear). A missing/malformed
  // body must never silently clear the About photo.
  if (!('id' in body)) return Response.json({ error: 'id is required (photo id, or null to clear)' }, { status: 400 })
  const r = await setAboutPhoto(auth.admin, body.id, body.align ?? 'center')
  return r.ok ? Response.json({ ok: true }) : Response.json({ error: r.error }, { status: r.status })
}
