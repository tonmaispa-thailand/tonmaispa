'use client'

import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

// Grouped by what staff are doing, in daily-frequency order: running today's
// operations, talking to guests, managing the schedule/team, editing site
// content, then owner-level admin. Group titles render as collapsible headers.
const NAV_GROUPS = [
  { title: null, links: [
    { href: '/dashboard',            label: 'Overview' },
  ]},
  { title: 'Operations', links: [
    { href: '/dashboard/bookings',   label: 'Bookings' },
    { href: '/dashboard/availability', label: 'Availability' },
    { href: '/dashboard/therapists', label: 'Therapists' },
  ]},
  { title: 'Guests', links: [
    { href: '/dashboard/customers',  label: 'Guests' },
    { href: '/dashboard/conversations', label: 'Conversations' },
    { href: '/dashboard/enquiries',  label: 'Enquiries' },
    { href: '/dashboard/campaigns',  label: 'Campaigns', flag: 'campaigns' },
  ]},
  { title: 'Content', links: [
    { href: '/dashboard/treatments', label: 'Treatments' },
    { href: '/dashboard/menu',       label: 'Restaurant Menu' },
    { href: '/dashboard/facilities', label: 'Facilities' },
    { href: '/dashboard/gallery',    label: 'Gallery' },
    { href: '/dashboard/blog',       label: 'Blog' },
    { href: '/dashboard/banners',    label: 'Banners', minRole: 'owner' },
  ]},
  { title: 'Insights & Admin', links: [
    { href: '/dashboard/reports',    label: 'Reports' },
    { href: '/dashboard/analytics',  label: 'Analytics', minRole: 'owner' },
    { href: '/dashboard/insights',   label: 'Insights', flag: 'insights' },
    { href: '/dashboard/users',      label: 'Users', minRole: 'owner' },
    { href: '/dashboard/settings',   label: 'Settings', minRole: 'owner' },
  ]},
]

const ROLE_RANK = { staff: 0, owner: 1, super_admin: 2 }

// Which groups the user has collapsed. Remembered per browser so the nav opens
// the way they left it.
const STORAGE_KEY = 'tms_nav_collapsed'

// The wordmark, every nav label and the footer name all sit on this one left
// edge. The links get it via nav padding (8) + link padding (12) = 20, so the
// active pill can still bleed wider than the text.
const EDGE = 20
const NAV_PAD = 8
const LINK_PAD = EDGE - NAV_PAD // 12

function Chevron({ open }) {
  return (
    <svg
      width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"
      style={{
        transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
        transition: 'transform 120ms ease',
        flexShrink: 0, opacity: 0.65,
      }}
    >
      <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function DashNav({ fullName, role, email, insightsEnabled = true, campaignsEnabled = true }) {
  const pathname = usePathname()
  const router   = useRouter()

  // Start expanded on the server and on first paint, then apply the saved
  // state — reading localStorage during render would break hydration.
  const [collapsed, setCollapsed] = useState(() => new Set())

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) setCollapsed(new Set(JSON.parse(raw)))
    } catch { /* private mode / bad JSON — just stay expanded */ }
  }, [])

  const toggle = (title) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])) } catch {}
      return next
    })
  }

  const isActive = (href) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href)

  const groups = NAV_GROUPS
    .map(g => ({
      ...g,
      links: g.links.filter(l =>
        (l.flag !== 'insights' || insightsEnabled) &&
        (l.flag !== 'campaigns' || campaignsEnabled) &&
        (!l.minRole || (ROLE_RANK[role] ?? 0) >= ROLE_RANK[l.minRole])
      ),
    }))
    .filter(g => g.links.length > 0)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside style={{
      width: 220, flexShrink: 0, background: '#1C1917', color: '#FAF6F0',
      display: 'flex', flexDirection: 'column', padding: '24px 0',
      position: 'sticky', top: 0, height: '100vh',
    }}>
      <div style={{ padding: `0 ${EDGE}px 20px`, borderBottom: '1px solid rgba(250,246,240,0.12)' }}>
        <div style={{ font: '400 22px Cormorant Garamond,serif' }}>Ton Mai Spa</div>
        <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 1.5, textTransform: 'uppercase', color: '#C4924A', marginTop: 2 }}>Dashboard</div>
      </div>

      <nav style={{
        flex: 1, padding: `12px ${NAV_PAD}px`, display: 'flex', flexDirection: 'column', gap: 1,
        overflowY: 'auto',
        // Reserve the scrollbar's width even when it isn't showing, so the
        // labels never shift sideways as groups open and close.
        scrollbarGutter: 'stable',
      }}>
        {groups.map((g, gi) => {
          // A collapsed group that contains the current page would hide it —
          // always show where you are.
          const hasActive = g.links.some(l => isActive(l.href))
          const open = !g.title || hasActive || !collapsed.has(g.title)

          return (
            <div key={g.title ?? gi} style={{ marginBottom: 6 }}>
              {g.title && (
                <button
                  type="button"
                  onClick={() => toggle(g.title)}
                  aria-expanded={open}
                  title={open ? `Collapse ${g.title}` : `Expand ${g.title}`}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                    width: '100%', padding: `10px ${LINK_PAD}px 4px`,
                    background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                    font: '700 9px Inter,sans-serif', letterSpacing: 1.6, textTransform: 'uppercase',
                    color: hasActive ? 'rgba(250,246,240,0.62)' : 'rgba(250,246,240,0.4)',
                  }}
                >
                  <span>{g.title}</span>
                  {/* The active group can't be collapsed, so don't imply it can. */}
                  {!hasActive && <Chevron open={open} />}
                </button>
              )}

              {open && g.links.map(l => {
                const active = isActive(l.href)
                return (
                  <a key={l.href} href={l.href} style={{
                    display: 'block', padding: `8px ${LINK_PAD}px`, borderRadius: 4, textDecoration: 'none',
                    font: '500 13px Inter,sans-serif',
                    color: active ? '#1C1917' : 'rgba(250,246,240,0.75)',
                    background: active ? '#C4924A' : 'transparent',
                  }}>
                    {l.label}
                  </a>
                )
              })}
            </div>
          )
        })}
      </nav>

      <div style={{ padding: `16px ${EDGE}px`, borderTop: '1px solid rgba(250,246,240,0.12)' }}>
        <Link href="/dashboard/profile" style={{ display: 'block', textDecoration: 'none' }}>
          <div style={{ font: '600 13px Inter,sans-serif', color: '#FAF6F0' }}>{fullName || email}</div>
          <div style={{ font: '400 11px Inter,sans-serif', color: 'rgba(250,246,240,0.5)', marginTop: 2, textTransform: 'capitalize' }}>{role?.replace('_', ' ')} · Edit profile</div>
        </Link>
        <button onClick={handleLogout} style={{
          marginTop: 12, background: 'none', border: '1px solid rgba(250,246,240,0.25)', color: 'rgba(250,246,240,0.8)',
          borderRadius: 4, padding: '7px 12px', font: '500 11px Inter,sans-serif', cursor: 'pointer', width: '100%',
        }}>
          Log out
        </button>
      </div>
    </aside>
  )
}
