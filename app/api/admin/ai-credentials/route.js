// BYOK AI provider credentials — owner/super_admin only.
//
// GET    → masked status (never returns the api_key; last 4 chars only)
// PUT    → validate the key against the provider (one tiny real call) THEN save
// DELETE → clear BYOK, reverting the whole AI stack to the platform env default
//
// The api_key lives in the service-role-only `ai_credentials` table (034); it is
// written and read here through auth.admin (service role) and never sent back to
// the browser. Reads/writes are gated by requireOwnerOrAbove, matching the
// Settings route (the AI key is an owner-level lever, like maintenance mode).
import { requireOwnerOrAbove } from '@/lib/require-admin'
import { testAiCredentials, clearAiConfigCache } from '@/lib/minimax'

const last4 = (s) => (typeof s === 'string' && s.length >= 4 ? s.slice(-4) : null)

function maskedStatus(row) {
  if (!row) return { configured: false } // AI stack is on the platform env default
  return {
    configured: true,
    provider: row.provider ?? null,
    base_url: row.base_url,
    model: row.model,
    key_last4: last4(row.api_key),
    updated_at: row.updated_at,
  }
}

export async function GET() {
  const auth = await requireOwnerOrAbove()
  if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })

  const { data, error } = await auth.admin
    .from('ai_credentials')
    .select('provider, base_url, model, api_key, updated_at')
    .eq('id', 1)
    .maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json(maskedStatus(data))
}

export async function PUT(req) {
  const auth = await requireOwnerOrAbove()
  if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })

  // `|| {}` also collapses a literal JSON `null` body (valid JSON, so .catch
  // never fires) to an empty object — otherwise body.provider would throw a 500.
  const body = (await req.json().catch(() => ({}))) || {}
  const provider = body.provider ? String(body.provider).trim() : null
  const base_url = String(body.base_url ?? '').trim()
  const model    = String(body.model ?? '').trim()
  const api_key  = String(body.api_key ?? '').trim()

  if (!base_url || !model || !api_key) {
    return Response.json({ error: 'base_url, model and api_key are all required.' }, { status: 400 })
  }
  // Reject anything but https — the key travels to this URL on every AI call,
  // so an http (or malformed) endpoint would leak it in cleartext.
  let parsed
  try { parsed = new URL(base_url) } catch { parsed = null }
  if (!parsed || parsed.protocol !== 'https:') {
    return Response.json({ error: 'base_url must be a valid https:// URL.' }, { status: 400 })
  }

  // Prove the config actually works before persisting it, so a wrong key /
  // model / endpoint fails loudly here instead of silently breaking the whole
  // AI stack later.
  const test = await testAiCredentials({ baseURL: base_url, model, apiKey: api_key })
  if (!test.ok) {
    return Response.json(
      { error: `The provider rejected a test request, so nothing was saved. Details: ${test.error}` },
      { status: 400 },
    )
  }

  // updated_at set explicitly (the column default only fires on INSERT, and
  // this is an upsert-as-update). updated_by is the caller's profile id, which
  // requireOwnerOrAbove already proved exists — so the FK is satisfied.
  const nowIso = new Date().toISOString()
  const { error } = await auth.admin.from('ai_credentials').upsert({
    id: 1,
    provider,
    base_url,
    model,
    api_key,
    updated_at: nowIso,
    updated_by: auth.session.user.id,
  }, { onConflict: 'id' })
  if (error) return Response.json({ error: error.message }, { status: 400 })

  clearAiConfigCache() // pick up the new provider immediately on this instance

  return Response.json(maskedStatus({ provider, base_url, model, api_key, updated_at: nowIso }))
}

export async function DELETE() {
  const auth = await requireOwnerOrAbove()
  if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })

  const { error } = await auth.admin.from('ai_credentials').delete().eq('id', 1)
  if (error) return Response.json({ error: error.message }, { status: 400 })

  clearAiConfigCache() // revert to the platform env default immediately

  return Response.json({ configured: false })
}
