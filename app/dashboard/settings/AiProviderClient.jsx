'use client'

// BYOK AI provider settings — owner/super_admin. Talks to
// /api/admin/ai-credentials (NOT the site_content settings route), because the
// api_key lives in the service-role-only ai_credentials table and is never
// round-tripped to the browser (status shows only the last 4 chars).
import { useEffect, useState } from 'react'

// Presets prefill the base URL and offer a short, curated model list so the
// owner just picks one instead of typing a slug. baseURL is what actually
// routes; all three speak the Anthropic Messages protocol. The OpenRouter list
// is verified working through OpenRouter's Anthropic endpoint; the first entry
// in each list is a sensible, inexpensive default for a spa chatbot. "Custom"
// (added in the dropdown) reveals a free-text box for anything not listed.
const CUSTOM = '__custom__'
const PRESETS = [
  {
    id: 'openrouter', label: 'OpenRouter', base_url: 'https://openrouter.ai/api',
    models: [
      { value: 'openai/gpt-4o-mini',                 label: 'GPT-4o mini — cheap & easy (recommended)' },
      { value: 'anthropic/claude-haiku-4.5',         label: 'Claude Haiku 4.5 — fast & cheap' },
      { value: 'google/gemini-2.5-flash',            label: 'Gemini 2.5 Flash — fast & cheap' },
      { value: 'deepseek/deepseek-chat',             label: 'DeepSeek Chat — cheapest' },
      { value: 'anthropic/claude-sonnet-4.5',        label: 'Claude Sonnet 4.5 — most capable' },
      { value: 'openai/gpt-5.6-luna',                label: 'GPT-5.6 Luna' },
      { value: 'meta-llama/llama-3.3-70b-instruct',  label: 'Llama 3.3 70B — open model' },
    ],
  },
  {
    id: 'minimax', label: 'MiniMax', base_url: 'https://api.minimax.io/anthropic',
    models: [{ value: 'MiniMax-M3', label: 'MiniMax-M3' }],
  },
  {
    id: 'anthropic', label: 'Claude (Anthropic)', base_url: 'https://api.anthropic.com',
    models: [
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fast & cheap (recommended)' },
      { value: 'claude-sonnet-5',           label: 'Claude Sonnet 5 — most capable' },
    ],
  },
]

const CARD = { background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8, padding: 20, marginBottom: 16 }
const H2   = { font: '600 12px Inter,sans-serif', letterSpacing: 1, textTransform: 'uppercase', color: '#9B9390', margin: '0 0 4px' }
const LBL  = { display: 'block', font: '500 12px Inter,sans-serif', color: '#4A4745', margin: '0 0 4px' }

export default function AiProviderClient() {
  const [status, setStatus]   = useState(null)   // masked status from GET
  const [loading, setLoading] = useState(true)
  const [form, setForm]       = useState({ provider: '', base_url: '', model: '', api_key: '' })
  const [customModel, setCustomModel] = useState(false) // true = type a slug instead of picking
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')

  async function loadStatus() {
    try {
      const res = await fetch('/api/admin/ai-credentials')
      const data = await res.json().catch(() => ({}))
      if (res.ok) setStatus(data)
      else setError(data.error || 'Could not load AI provider status')
    } catch {
      setError('Could not load AI provider status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadStatus() }, [])

  const pickPreset = (p) => {
    // Default to the first (recommended) model so the owner can just paste a key.
    setForm(f => ({ ...f, provider: p.id, base_url: p.base_url, model: p.models[0].value }))
    setCustomModel(false)
    setSuccess(''); setError('')
  }

  const activePreset = PRESETS.find(p => p.id === form.provider)

  const onModelSelect = (v) => {
    if (v === CUSTOM) { setCustomModel(true); setField('model', '') }
    else { setCustomModel(false); setField('model', v) }
  }

  const setField = (k, v) => { setForm(f => ({ ...f, [k]: v })); setSuccess(''); setError('') }

  const save = async () => {
    setBusy(true); setError(''); setSuccess('')
    try {
      const res = await fetch('/api/admin/ai-credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setStatus(data)
        setForm({ provider: '', base_url: '', model: '', api_key: '' })
        setModelHint('')
        setSuccess('Saved — the key was tested against the provider and is working.')
      } else {
        setError(data.error || 'Could not save')
      }
    } catch {
      setError('Could not save')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm('Remove your AI key and go back to the platform default provider?')) return
    setBusy(true); setError(''); setSuccess('')
    try {
      const res = await fetch('/api/admin/ai-credentials', { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) { setStatus(data); setSuccess('Removed — now using the platform default.') }
      else setError(data.error || 'Could not remove')
    } catch {
      setError('Could not remove')
    } finally {
      setBusy(false)
    }
  }

  const canSave = form.base_url.trim() && form.model.trim() && form.api_key.trim() && !busy

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={CARD}>
        <h2 style={H2}>AI Provider</h2>
        <p style={{ font: '400 12px/1.6 Inter,sans-serif', color: '#6B6663', margin: '0 0 16px' }}>
          Powers the chatbot, AI blog writing, translations, and the analytics advisor. Use your own
          provider key so AI usage is billed to your account. Any Anthropic-compatible provider works
          (MiniMax, Claude, or OpenRouter). Leave it unset to use the platform default.
        </p>

        {/* Current status */}
        {loading ? (
          <div style={{ font: '400 13px Inter,sans-serif', color: '#9B9390' }}>Loading…</div>
        ) : status?.configured ? (
          <div style={{ background: '#F2F5F3', border: '1px solid var(--color-border)', borderRadius: 6, padding: '12px 14px', marginBottom: 16 }}>
            <div style={{ font: '600 12px Inter,sans-serif', color: '#3B5249', marginBottom: 4 }}>Using your own key ✓</div>
            <div style={{ font: '400 12px/1.7 Inter,sans-serif', color: '#4A4745' }}>
              {status.provider && <>Provider: <strong>{status.provider}</strong><br /></>}
              Model: <strong>{status.model}</strong><br />
              Endpoint: {status.base_url}<br />
              Key: ••••{status.key_last4}
            </div>
            <button onClick={remove} disabled={busy}
              style={{ marginTop: 10, background: 'transparent', color: '#DC2626', border: '1px solid #DC2626', borderRadius: 4, padding: '6px 12px', font: '500 11px Inter,sans-serif', cursor: 'pointer' }}>
              Remove & use platform default
            </button>
          </div>
        ) : (
          <div style={{ background: '#FBF8F2', border: '1px solid var(--color-border)', borderRadius: 6, padding: '12px 14px', marginBottom: 16, font: '400 12px Inter,sans-serif', color: '#6B6663' }}>
            Using the platform default provider. Add your own key below to bill AI usage to your account.
          </div>
        )}

        {/* Set / replace form */}
        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
          <div style={{ font: '500 12px Inter,sans-serif', color: '#4A4745', marginBottom: 8 }}>
            {status?.configured ? 'Replace with a new key' : 'Add your key'}
          </div>

          {/* Presets */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {PRESETS.map(p => (
              <button key={p.id} type="button" onClick={() => pickPreset(p)}
                style={{
                  background: form.provider === p.id ? '#3B5249' : '#fff',
                  color: form.provider === p.id ? '#fff' : '#4A4745',
                  border: '1px solid ' + (form.provider === p.id ? '#3B5249' : 'var(--color-border)'),
                  borderRadius: 999, padding: '6px 14px', font: '500 12px Inter,sans-serif', cursor: 'pointer',
                }}>
                {p.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={LBL}>Endpoint (base URL)</label>
              <input className="input" placeholder="https://…" value={form.base_url}
                onChange={e => setField('base_url', e.target.value)} />
            </div>
            <div>
              <label style={LBL}>Model</label>
              {activePreset && !customModel ? (
                <select className="input" style={{ cursor: 'pointer' }}
                  value={form.model} onChange={e => onModelSelect(e.target.value)}>
                  {activePreset.models.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                  <option value={CUSTOM}>Custom — type a model id…</option>
                </select>
              ) : (
                <>
                  <input className="input" placeholder="model id (e.g. openai/gpt-4o-mini)"
                    value={form.model} onChange={e => setField('model', e.target.value)} />
                  {activePreset && (
                    <button type="button"
                      onClick={() => { setCustomModel(false); setField('model', activePreset.models[0].value) }}
                      style={{ marginTop: 6, background: 'transparent', border: 'none', color: '#3B5249', font: '500 11px Inter,sans-serif', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                      ← back to the list
                    </button>
                  )}
                </>
              )}
              {activePreset && !customModel && (
                <div style={{ font: '400 11px Inter,sans-serif', color: '#9B9390', marginTop: 3 }}>
                  For a spa chatbot the top option is plenty — no need for an expensive model.
                </div>
              )}
            </div>
            <div>
              <label style={LBL}>API key</label>
              <input className="input" type="password" autoComplete="off" placeholder="paste your provider API key"
                value={form.api_key} onChange={e => setField('api_key', e.target.value)} />
              <div style={{ font: '400 11px Inter,sans-serif', color: '#9B9390', marginTop: 3 }}>
                Stored securely and never shown again — only the last 4 digits are displayed.
              </div>
            </div>
          </div>

          <button onClick={save} disabled={!canSave}
            style={{ marginTop: 16, background: canSave ? '#3B5249' : '#B8C0BA', color: '#fff', border: 'none', borderRadius: 4, padding: '11px 22px', font: '600 12px Inter,sans-serif', cursor: canSave ? 'pointer' : 'default' }}>
            {busy ? 'Testing & saving…' : 'Test & Save'}
          </button>
          {success && <p style={{ color: '#065F46', font: '400 12px/1.5 Inter,sans-serif', marginTop: 10 }}>{success}</p>}
          {error && <p style={{ color: '#DC2626', font: '400 12px/1.5 Inter,sans-serif', marginTop: 10 }}>{error}</p>}
        </div>
      </div>
    </div>
  )
}
