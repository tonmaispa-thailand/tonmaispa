// AI client for the whole stack — chatbot, analytics, blog writing, CMS
// translation, and the self-critique pipeline all go through here.
//
// BYOK (bring your own key): an owner/super_admin can point every AI feature at
// their own Anthropic-compatible provider — MiniMax, Anthropic direct, or an
// OpenRouter "Anthropic Skin" endpoint — by saving { base_url, model, api_key }
// in the dashboard. That config lives in the service-role-only `ai_credentials`
// table (migration 034), never in public site_content. When no BYOK row is set,
// we fall back to an env-configured platform provider (see resolveEnvFallback).
//
// The SDK is identical across providers; only baseURL / apiKey / model change.
//
// NODE-ONLY: this reads ai_credentials via a service-role admin client, so it
// must never be imported into an Edge module (middleware, or a page/route with
// `runtime = 'edge'`). It also runs inside SSG/ISR (lib/translate.js imports it
// at build time) — that path fails open, but keep it node-safe.
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

// Platform fallback provider — used only when no dashboard BYOK row is set.
// Env-configurable so the default provider can change without a code edit.
// Preference order:
//   1. OpenRouter — OPEN_ROUTER_AI_KEY + AI_FALLBACK_MODEL (base URL defaults to
//      OpenRouter's Anthropic endpoint, override with AI_FALLBACK_BASE_URL).
//   2. Legacy MiniMax — MINIMAX_API_KEY (fixed MiniMax base URL + model).
// Set these in Vercel for production, not just .env.local. AI_FALLBACK_MODEL is
// required for the OpenRouter path — without a model there is nothing to call.
function resolveEnvFallback() {
  const orKey = process.env.OPEN_ROUTER_AI_KEY?.trim()
  if (orKey) {
    return {
      baseURL: process.env.AI_FALLBACK_BASE_URL?.trim() || 'https://openrouter.ai/api',
      model:   process.env.AI_FALLBACK_MODEL?.trim() || null,
      apiKey:  orKey,
    }
  }
  const mmKey = process.env.MINIMAX_API_KEY?.trim()
  if (mmKey) {
    return { baseURL: 'https://api.minimax.io/anthropic', model: 'MiniMax-M3', apiKey: mmKey }
  }
  return { baseURL: null, model: null, apiKey: null }
}

// Short cache of the resolved CONFIG (not the client — the Anthropic client is
// cheap and rebuilt per call) so we don't read the DB on every AI call. Same
// 30s TTL pattern as lib/maintenance.js. A saved BYOK change takes effect
// within the TTL, or immediately on the writing instance via clearAiConfigCache.
const CACHE = { cfg: null, at: 0 }
const TTL_MS = 30_000

async function resolveConfig() {
  const now = Date.now()
  if (CACHE.cfg && now - CACHE.at < TTL_MS) return CACHE.cfg

  let cfg = null
  let dbErrored = false
  try {
    const admin = createSupabaseAdminClient()
    const { data, error } = await admin
      .from('ai_credentials')
      .select('base_url, model, api_key')
      .eq('id', 1)
      .maybeSingle()
    if (error) {
      // supabase-js reports query/permission errors here rather than throwing.
      dbErrored = true
      console.error('[ai] could not read BYOK credentials, using env fallback:', error.message)
    } else if (data?.api_key && data?.base_url && data?.model) {
      cfg = { baseURL: data.base_url, model: data.model, apiKey: data.api_key }
    }
  } catch (err) {
    // A DB blip must never take the whole AI stack down — fall back to env.
    dbErrored = true
    console.error('[ai] could not read BYOK credentials, using env fallback:', err.message)
  }

  if (!cfg) {
    cfg = resolveEnvFallback()
  }

  // Cache successful resolves and the legitimate "no BYOK row yet" case, but
  // NOT a transient DB error — caching the fallback on error would pin the
  // platform provider for the whole TTL even after the DB recovers, hiding the
  // owner's chosen provider. Retry on the next call instead (same stance as
  // lib/maintenance.js, which also declines to cache a failed read).
  if (!dbErrored) {
    CACHE.cfg = cfg
    CACHE.at = now
  }
  return cfg
}

// Returns { client, model } — or null when no key is available anywhere.
// Usage at every call site:
//   const ai = await getAiClient()
//   if (!ai) return null            // (or throw / 503, per caller)
//   await ai.client.messages.create({ model: ai.model, ... })
export async function getAiClient() {
  const cfg = await resolveConfig()
  if (!cfg.apiKey || !cfg.model) {
    console.warn('[ai] no usable AI config — set a dashboard BYOK key, or OPEN_ROUTER_AI_KEY + AI_FALLBACK_MODEL, or MINIMAX_API_KEY')
    return null
  }
  return {
    client: new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL }),
    model: cfg.model,
  }
}

// Validate a candidate BYOK config by making one tiny real call to the
// provider before it is saved — so an owner who pastes a wrong key / baseURL /
// model gets a clear error at save time instead of a silently dead AI stack.
// Returns { ok: true } or { ok: false, error }. Never throws.
export async function testAiCredentials({ baseURL, model, apiKey }, { timeoutMs = 20000 } = {}) {
  if (!apiKey || !baseURL || !model) {
    return { ok: false, error: 'apiKey, baseURL and model are all required' }
  }
  try {
    const client = new Anthropic({ apiKey, baseURL })
    await Promise.race([
      client.messages.create({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`provider did not respond within ${timeoutMs / 1000}s`)), timeoutMs)),
    ])
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || 'the provider rejected the request' }
  }
}

// Drop the cached config so a just-saved BYOK change is picked up immediately
// on this instance instead of waiting out the TTL. Other warm serverless
// instances still refresh via the TTL. Called by the Settings save route (Stage 3).
export function clearAiConfigCache() {
  CACHE.cfg = null
  CACHE.at = 0
}
