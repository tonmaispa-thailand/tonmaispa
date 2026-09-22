// Shared style tokens + tiny UI bits for every Reports tab, so Revenue,
// Therapists and Bookings all look like one page rather than three.
export const card = { background: '#fff', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20, boxShadow: '0 1px 2px rgba(28,25,23,0.04)' }
export const sectionTitle = { font: '600 12px Inter,sans-serif', letterSpacing: 1, textTransform: 'uppercase', color: '#9B9390', margin: '0 0 14px' }
export const btnGhost = (active) => ({ padding: '8px 16px', borderRadius: 8, border: '1px solid ' + (active ? '#3B5249' : 'var(--color-border)'), background: active ? '#3B5249' : '#fff', color: active ? '#fff' : '#1C1917', font: '500 13px Inter,sans-serif', cursor: 'pointer', transition: 'all .15s' })
export const btnPrimary = { background: '#3B5249', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 18px', font: '600 13px Inter,sans-serif', cursor: 'pointer' }
export const th = { textAlign: 'left', padding: '8px 10px', font: '600 10px Inter,sans-serif', letterSpacing: 0.5, textTransform: 'uppercase', color: '#9B9390', borderBottom: '1px solid #F0ECE6' }
export const td = { padding: '8px 10px', font: '400 13px Inter,sans-serif', color: '#1C1917', borderBottom: '1px solid #F5F2ED' }
export const CHART_COLORS = ['#3B5249', '#C4924A', '#6E8B7F', '#D9B98A', '#8C6D4F', '#A8BDB4', '#E8D5B7', '#5C7A6E']

export const money = (n) => `฿${Math.round(n ?? 0).toLocaleString()}`
export const shortDate = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.getDate()}/${d.getMonth() + 1}` }

export const TooltipBox = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#1C1917', color: '#FAF6F0', padding: '8px 12px', borderRadius: 6, font: '500 12px Inter,sans-serif' }}>
      <div style={{ opacity: 0.7, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => <div key={i}>{p.name}: {money(p.value)}</div>)}
    </div>
  )
}
