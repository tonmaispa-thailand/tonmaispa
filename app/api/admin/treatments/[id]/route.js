import { requireAdmin } from '@/lib/require-admin'
import { BOOKING_TOP_N } from '@/lib/booking-ranking'
import { PRICING_SECTION_MAX } from '@/lib/pricing-section'

const EDITABLE = ['name', 'slug', 'description', 'category', 'duration_options', 'prices', 'badge', 'photos', 'sort_order', 'is_active', 'show_on_homepage', 'is_featured', 'show_in_pricing']

// Enforces a flag's cap, but ONLY on a real transition INTO true. Re-saving a
// row that's already true (e.g. an unrelated price edit) must always be
// allowed, even if the total somehow already exceeds the cap (pre-existing
// data from before the rule existed — this happened for real with
// is_featured once prod data crossed 5) — so the row's CURRENT value decides
// whether this write is "newly setting" it at all.
async function enforceCap(admin, { id, updates, current, field, max, label, code }) {
  if (updates[field] !== true || current[field]) return null // not being newly set — nothing to enforce
  const { count, error } = await admin.from('spa_treatments').select('id', { count: 'exact', head: true }).eq(field, true)
  if (error) return Response.json({ error: error.message }, { status: 400 })
  if ((count ?? 0) >= max) {
    return Response.json({ error: `You can ${label} at most ${max} treatments. Remove another one first.`, code }, { status: 409 })
  }
  return null
}

export async function PATCH(req, { params }) {
  const auth = await requireAdmin()
  if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })

  const body = await req.json()
  const updates = Object.fromEntries(Object.entries(body).filter(([k]) => EDITABLE.includes(k)))
  if (Object.keys(updates).length === 0) return Response.json({ error: 'No valid fields' }, { status: 400 })

  // One read covers both capped flags, whether or not this particular
  // request touches either — cheaper than a separate lookup per flag.
  if (updates.is_featured === true || updates.show_in_pricing === true) {
    const { data: current, error: curErr } = await auth.admin
      .from('spa_treatments').select('is_featured, show_in_pricing').eq('id', params.id).single()
    if (curErr) return Response.json({ error: curErr.message }, { status: 400 })

    const featuredCapError = await enforceCap(auth.admin, {
      id: params.id, updates, current, field: 'is_featured', max: BOOKING_TOP_N,
      label: 'feature', code: 'FEATURED_LIMIT',
    })
    if (featuredCapError) return featuredCapError

    const pricingCapError = await enforceCap(auth.admin, {
      id: params.id, updates, current, field: 'show_in_pricing', max: PRICING_SECTION_MAX,
      label: 'show in the Pricing section', code: 'PRICING_LIMIT',
    })
    if (pricingCapError) return pricingCapError
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
