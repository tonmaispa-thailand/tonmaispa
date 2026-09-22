import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies }                  from 'next/headers'
import { NextResponse }             from 'next/server'

export async function GET(req) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')

  if (code) {
    const cookieStore = await cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore })
    await supabase.auth.exchangeCodeForSession(code)
  }

  // Optional post-exchange destination (e.g. password recovery → /reset-password).
  // Only same-origin RELATIVE paths are honored: must start with "/" followed by
  // a normal char — rejects absolute URLs, protocol-relative "//host", and the
  // "/\host" backslash trick some browsers treat as "//". Prevents open redirect.
  const nextParam = searchParams.get('next')
  const next = nextParam && /^\/[^/\\]/.test(nextParam) ? nextParam : '/dashboard'

  return NextResponse.redirect(`${origin}${next}`)
}
