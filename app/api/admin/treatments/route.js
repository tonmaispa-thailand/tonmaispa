import { requireAdmin } from '@/lib/require-admin'
import { BOOKING_TOP_N } from '@/lib/booking-ranking'
import { PRICING_SECTION_MAX } from '@/lib/pricing-section'

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export async function POST(req) {
  const auth = await requireAdmin()
  if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })

  const body = await req.json()
  if (!body.name) return Response.json({ error: 'Name is required' }, { status: 400 })

  // At most BOOKING_TOP_N treatments may be featured, so every featured one is
  // guaranteed a slot in the booking shortlist (mirrors the dashboard's disabled
  // checkbox — this is the authoritative check for any non-UI caller).
  if (body.is_featured === true) {
    const { count, error: countErr } = await auth.admin
      .from('spa_treatments').select('id', { count: 'exact', head: true }).eq('is_featured', true)
    if (countErr) return Response.json({ error: countErr.message }, { status: 400 })
    if ((count ?? 0) >= BOOKING_TOP_N) {
      return Response.json({ error: `You can feature at most ${BOOKING_TOP_N} treatments. Un-feature another one first.`, code: 'FEATURED_LIMIT' }, { status: 409 })
    }
  }

  // Same cap pattern as is_featured above, for the homepage Pricing section.
  if (body.show_in_pricing === true) {
    const { count, error: countErr } = await auth.admin
      .from('spa_treatments').select('id', { count: 'exact', head: true }).eq('show_in_pricing', true)
    if (countErr) return Response.json({ error: countErr.message }, { status: 400 })
    if ((count ?? 0) >= PRICING_SECTION_MAX) {
      return Response.json({ error: `You can show at most ${PRICING_SECTION_MAX} treatments in the Pricing section. Remove another one first.`, code: 'PRICING_LIMIT' }, { status: 409 })
    }
  }

  const row = {
    name:             body.name,
    slug:             body.slug || slugify(body.name),
    description:      body.description ?? null,
    category:         body.category ?? 'massage',
    duration_options: body.duration_options ?? [],
    prices:           body.prices ?? {},
    badge:            body.badge || null,
    photos:           Array.isArray(body.photos) ? body.photos : [],
    sort_order:       body.sort_order ?? 0,
    is_active:        body.is_active ?? true,
    show_on_homepage: body.show_on_homepage ?? false,
    is_featured:      body.is_featured ?? false,
    show_in_pricing:  body.show_in_pricing ?? false,
  }

  const { data, error } = await auth.admin.from('spa_treatments').insert(row).select().single()
  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({ ok: true, treatment: data })
}
