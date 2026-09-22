'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function ForgotPasswordPage() {
  const [email,   setEmail]   = useState('')
  const [sent,    setSent]    = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    // Route the recovery link through /auth/callback, which exchanges the PKCE
    // ?code for a real session (server-side, sets the auth cookie) and then
    // redirects to /reset-password. Pointing straight at /reset-password left
    // the ?code unexchanged, so the reset page never got a session and showed
    // "link expired". `next` tells the callback where to land after exchange.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })
    setSent(true)
    setLoading(false)
  }

  return (
    <main style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-bg)', padding: '2rem',
    }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <p className="label">Reset Password</p>
        </div>
        <div style={{ background: 'var(--color-white)', borderRadius: 'var(--radius-lg)', padding: '2rem', boxShadow: 'var(--shadow-md)', border: '1px solid var(--color-border)' }}>
          {sent ? (
            <p style={{ textAlign: 'center', color: 'var(--color-text-mid)' }}>
              Check your email for a reset link. It may take a minute to arrive.
            </p>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="input" placeholder="your@email.com" />
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
                {loading ? 'Sending…' : 'Send Reset Link'}
              </button>
            </form>
          )}
          <div style={{ marginTop: '1rem', textAlign: 'center' }}>
            <Link href="/login" style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>Back to login</Link>
          </div>
        </div>
      </div>
    </main>
  )
}
