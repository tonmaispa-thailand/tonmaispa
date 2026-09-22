'use client'

// BYOK AI provider settings — owner/super_admin. Talks to
// /api/admin/ai-credentials (NOT the site_content settings route), because the
// api_key lives in the service-role-only ai_credentials table and is never
// round-tripped to the browser (status shows only the last 4 chars).
import { useEffect, useState } from 'react'

// Presets just prefill the base URL and hint the model format — the owner still
// pastes their own model id + key. baseURL is what actually routes; the label
// is cosmetic. All three speak the Anthropic Messages protocol.
const PRESETS = [
  { id: 'minimax',    label: 'MiniMax',           base_url: 'https://api.minimax.io/anthropic', modelHint: 'e.g. MiniMax-M3' },
  { id: 'anthropic',  label: 'Claude (Anthropic)', base_url: 'https://api.anthropic.com',        modelHint: 'e.g. claude-fable-5-1' },
  { id: 'openrouter', label: 'OpenRouter',        base_url: 'https://openrouter.ai/api',        modelHint: 'e.g. anthropic/claude-fable-5.1 or deepseek/deepseek-v4' },
]

const CARD = { background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8, padding: 20, marginBottom: 16 }
const H2   = { font: '600 12px Inter,sans-serif', letterSpacing: 1, textTransform: 'uppercase', color: '#9B9390', margin: '0 0 4px' }
const LBL  = { display: 'block', font: '500 12px Inter,sans-serif', color: '#4A4745', margin: '0 0 4px' }

export default function AiProviderClient() {
  const [status, setStatus]   = useState(null)   // masked status from GET
  const [loading, setLoading] = useState(true)
  const [form, setForm]       = useState({ provider: '', base_url: '', model: '', api_key: '' })
  const [modelHint, setModelHint] = useState('')
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
    setForm(f => ({ ...f, provider: p.id, base_url: p.base_url }))
    setModelHint(p.modelHint)
    setSuccess(''); setError('')
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
              <input className="input" placeholder={modelHint || 'model id'} value={form.model}
                onChange={e => setField('model', e.target.value)} />
              {modelHint && <div style={{ font: '400 11px Inter,sans-serif', color: '#9B9390', marginTop: 3 }}>{modelHint}</div>}
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
