'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import PasswordInput from '@/components/ui/PasswordInput'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  // Only follow a same-origin RELATIVE path after login — must start with "/"
  // then a normal char. Rejects absolute URLs, "//host" and the "/\host"
  // backslash trick, so ?redirectTo=https://evil.com can't phish a logged-in
  // user off-site. Same guard as app/auth/callback/route.js.
  const rawRedirect = params.get('redirectTo')
  const redirectTo = rawRedirect && /^\/[^/\\]/.test(rawRedirect) ? rawRedirect : '/dashboard'

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError('Invalid email or password.')
      setLoading(false)
      return
    }

    router.push(redirectTo)
  }

  return (
    <main style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-bg)', padding: '2rem',
    }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <p className="label" style={{ marginBottom: '0.5rem' }}>Dashboard</p>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 300, fontSize: '2rem' }}>
            Ton Mai Spa
          </h1>
        </div>

        <div style={{
          background: 'var(--color-white)', borderRadius: 'var(--radius-lg)',
          padding: '2rem', boxShadow: 'var(--shadow-md)',
          border: '1px solid var(--color-border)',
        }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                Email
              </label>
              <input
                type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                className="input" placeholder="you@tonmaispa.com"
                autoComplete="email"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.4rem' }}>
                Password
              </label>
              <PasswordInput
                required value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <p style={{ color: '#DC2626', fontSize: '0.875rem' }}>{error}</p>
            )}

            <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div style={{ marginTop: '1rem', textAlign: 'center' }}>
            <Link href="/forgot-password" style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
              Forgot password?
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
