import { requireAdmin } from '@/lib/require-admin'
import { BOOKING_TOP_N } from '@/lib/booking-ranking'

const EDITABLE = ['name', 'slug', 'description', 'category', 'duration_options', 'prices', 'badge', 'photos', 'sort_order', 'is_active', 'show_on_homepage', 'is_featured']

export async function PATCH(req, { params }) {
  const auth = await requireAdmin()
  if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })

  const body = await req.json()
  const updates = Object.fromEntries(Object.entries(body).filter(([k]) => EDITABLE.includes(k)))
  if (Object.keys(updates).length === 0) return Response.json({ error: 'No valid fields' }, { status: 400 })

  // Cap featured treatments at BOOKING_TOP_N — but only on a real transition
  // INTO featured. Re-saving a treatment that is already featured (e.g. an
  // unrelated price edit) must always be allowed, even if the total somehow
  // already exceeds the cap (pre-existing data from before this rule), so we
  // check the row's current flag first and only count when newly featuring.
  if (updates.is_featured === true) {
    const { data: cur, error: curErr } = await auth.admin
      .from('spa_treatments').select('is_featured').eq('id', params.id).single()
    if (curErr) return Response.json({ error: curErr.message }, { status: 400 })
    if (!cur?.is_featured) {
      const { count, error: countErr } = await auth.admin
        .from('spa_treatments').select('id', { count: 'exact', head: true }).eq('is_featured', true)
      if (countErr) return Response.json({ error: countErr.message }, { status: 400 })
      if ((count ?? 0) >= BOOKING_TOP_N) {
        return Response.json({ error: `You can feature at most ${BOOKING_TOP_N} treatments. Un-feature another one first.`, code: 'FEATURED_LIMIT' }, { status: 409 })
      }
    }
  }

  const { data, error } = await auth.admin.from('spa_treatments').update(updates).eq('id', params.id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({ ok: true, treatment: data })
}

export async function DELETE(req, { params }) {
  const auth = await requireAdmin()
  if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })

  const { error } = await auth.admin.from('spa_treatments').delete().eq('id', params.id)
  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({ ok: true })
}
