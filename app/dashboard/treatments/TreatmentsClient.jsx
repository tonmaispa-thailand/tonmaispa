'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { TREATMENT_CATEGORIES } from '@/lib/display'
import { resizeImageForUpload } from '@/lib/resize-image'
import { rankBookingTopN, bookingSlotReason, BOOKING_TOP_N } from '@/lib/booking-ranking'
import { PRICING_SECTION_MAX } from '@/lib/pricing-section'

const CATEGORIES = Object.keys(TREATMENT_CATEGORIES)
const EMPTY_FORM = { name: '', category: 'massage', description: '', badge: '', durationsCsv: '60,90', pricesCsv: '600,850', is_active: true, photos: [], sort_order: 0, show_on_homepage: false, is_featured: false, show_in_pricing: false }
const CLOUD_NAME    = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
const UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET

const textareaStyle = { resize: 'vertical', minHeight: 80, fontFamily: 'inherit' }

export default function TreatmentsClient({ initialTreatments }) {
  const [treatments, setTreatments] = useState(initialTreatments)
  const [editingId, setEditingId] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [homepageFilter, setHomepageFilter] = useState('all')
  const [featuredFilter, setFeaturedFilter] = useState('all')
  const [pricingFilter, setPricingFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('order') // 'order' | 'name'
  const [popularIds, setPopularIds] = useState([]) // auto best-sellers, for the live preview

  // The booking widget fetches this same list client-side; mirror it so the
  // preview below shows the real best-seller fill, not just the featured ones.
  useEffect(() => {
    fetch('/api/bookings/popular-treatments')
      .then(r => r.ok ? r.json() : null)
      .then(d => setPopularIds(d?.treatment_ids ?? []))
      .catch(() => {})
  }, [])

  const filtered = treatments
    .filter(t => categoryFilter === 'all' || t.category === categoryFilter)
    .filter(t => statusFilter === 'all' || (statusFilter === 'active' ? t.is_active : !t.is_active))
    .filter(t => homepageFilter === 'all' || (homepageFilter === 'yes' ? t.show_on_homepage : !t.show_on_homepage))
    .filter(t => featuredFilter === 'all' || (featuredFilter === 'yes' ? t.is_featured : !t.is_featured))
    .filter(t => pricingFilter === 'all' || (pricingFilter === 'yes' ? t.show_in_pricing : !t.show_in_pricing))
    .filter(t => !search.trim() || t.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => sortBy === 'name' ? a.name.localeCompare(b.name) : (a.sort_order ?? 0) - (b.sort_order ?? 0))

  // Featured cap + live preview of the real booking shortlist.
  const featuredCount = treatments.filter(t => t.is_featured).length
  const featuredFull  = featuredCount >= BOOKING_TOP_N
  // Same cap pattern for the homepage Pricing section (see lib/pricing-section.js).
  const pricingCount = treatments.filter(t => t.show_in_pricing).length
  const pricingFull  = pricingCount >= PRICING_SECTION_MAX
  // Feed the ranking the SAME order guests get. BookingEngine's query does
  // .order('sort_order'); this page's getData() orders by category THEN
  // sort_order for the admin list, so sort a copy by sort_order alone here —
  // otherwise the featured/fill order (and the Top 5 itself) drifts from the
  // real widget, which is exactly what this preview is meant to mirror.
  const topN = rankBookingTopN({
    treatments: [...treatments].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    popularIds,
  })

  const parseDurationsAndPrices = (durationsCsv, pricesCsv) => {
    const durations = durationsCsv.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean)
    const priceList  = pricesCsv.split(',').map(s => parseInt(s.trim(), 10))
    const prices = {}
    durations.forEach((d, i) => { if (priceList[i]) prices[String(d)] = priceList[i] })
    return { duration_options: durations, prices }
  }

  const handleCreate = async () => {
    setSaving(true)
    const { duration_options, prices } = parseDurationsAndPrices(newForm.durationsCsv, newForm.pricesCsv)
    const res = await fetch('/api/admin/treatments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newForm, duration_options, prices }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setTreatments(prev => [...prev, data.treatment])
      setNewForm(EMPTY_FORM)
      setShowNew(false)
    } else {
      alert(data.error || 'Could not save treatment')
    }
    setSaving(false)
  }

  const toggleActive = async (t) => {
    const res = await fetch(`/api/admin/treatments/${t.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !t.is_active }),
    })
    if (res.ok) setTreatments(prev => prev.map(x => x.id === t.id ? { ...x, is_active: !t.is_active } : x))
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this treatment permanently?')) return
    const res = await fetch(`/api/admin/treatments/${id}`, { method: 'DELETE' })
    if (res.ok) setTreatments(prev => prev.filter(t => t.id !== id))
  }

  const handleSaveEdit = async (t, patch) => {
    const res = await fetch(`/api/admin/treatments/${t.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setTreatments(prev => prev.map(x => x.id === t.id ? data.treatment : x))
      setEditingId(null)
    } else {
      alert(data.error || 'Could not save treatment')
    }
  }

  return (
    <div>
      {/* Live preview of the booking widget's "Choose a treatment" shortlist —
          exactly what guests see, so staff know which treatments are surfacing
          and why, without opening the public site. */}
      <div style={{ background: '#F0F4F2', border: '1px solid var(--color-border)', borderRadius: 8, padding: 16, marginBottom: 16, maxWidth: 560 }}>
        <div style={{ font: '600 11px Inter,sans-serif', letterSpacing: 1, textTransform: 'uppercase', color: '#3B5249' }}>
          Booking form — live Top {BOOKING_TOP_N}
        </div>
        <div style={{ font: '400 11px/1.6 Inter,sans-serif', color: '#6B6663', margin: '4px 0 10px' }}>
          What guests see now in “Choose a treatment”: ⭐ featured first (menu order), then 🔥 best-sellers (last 45 days), capped at {BOOKING_TOP_N}. Featured slots used: <strong style={{ color: featuredFull ? '#B8860B' : '#3B5249' }}>{featuredCount}/{BOOKING_TOP_N}</strong>.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {topN.map((t, i) => {
            const reason = bookingSlotReason(t, popularIds)
            const tag = reason === 'featured' ? '⭐ Featured' : reason === 'bestseller' ? '🔥 Best-seller' : 'Menu order'
            const tagColor = reason === 'featured' ? '#3B5249' : reason === 'bestseller' ? '#8A6528' : '#9B9390'
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, font: '400 13px Inter,sans-serif', color: '#1C1917' }}>
                <span style={{ font: '600 12px Inter,sans-serif', color: '#9B9390', width: 16 }}>{i + 1}</span>
                <span style={{ flex: 1 }}>{t.name}</span>
                <span style={{ font: '600 10px Inter,sans-serif', color: tagColor, whiteSpace: 'nowrap' }}>{tag}</span>
              </div>
            )
          })}
          {topN.length === 0 && <div style={{ font: '400 12px Inter,sans-serif', color: '#9B9390' }}>No active treatments to show yet.</div>}
        </div>
      </div>

      <button onClick={() => setShowNew(v => !v)} style={{ marginBottom: 16, background: '#3B5249', color: '#fff', border: 'none', borderRadius: 4, padding: '10px 18px', font: '600 12px Inter,sans-serif', cursor: 'pointer' }}>
        {showNew ? 'Cancel' : '+ Add Treatment'}
      </button>

      {showNew && (
        <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8, padding: 20, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 500 }}>
          <input className="input" placeholder="Treatment name" value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} />
          <select className="input" value={newForm.category} onChange={e => setNewForm(f => ({ ...f, category: e.target.value }))}>
            {CATEGORIES.map(c => <option key={c} value={c}>{TREATMENT_CATEGORIES[c]}</option>)}
          </select>
          <textarea className="input" rows={3} style={textareaStyle} placeholder="Description" value={newForm.description} onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))} />
          <input className="input" placeholder="Badge (optional, e.g. Signature)" value={newForm.badge} onChange={e => setNewForm(f => ({ ...f, badge: e.target.value }))} />
          <div style={{ display: 'flex', gap: 10 }}>
            <input className="input" placeholder="Durations (mins, comma-sep) e.g. 60,90,120" value={newForm.durationsCsv} onChange={e => setNewForm(f => ({ ...f, durationsCsv: e.target.value }))} />
            <input className="input" placeholder="Prices (THB, matching order) e.g. 600,850,1100" value={newForm.pricesCsv} onChange={e => setNewForm(f => ({ ...f, pricesCsv: e.target.value }))} />
          </div>
          <div>
            <label style={{ display: 'block', font: '500 11px Inter,sans-serif', color: '#6B6663', marginBottom: 4 }}>Menu order (lower shows first)</label>
            <input className="input" type="number" value={newForm.sort_order} onChange={e => setNewForm(f => ({ ...f, sort_order: parseInt(e.target.value, 10) || 0 }))} style={{ maxWidth: 100 }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: '500 12px Inter,sans-serif', color: '#1C1917', cursor: 'pointer' }}>
            <input type="checkbox" checked={newForm.show_on_homepage} onChange={e => setNewForm(f => ({ ...f, show_on_homepage: e.target.checked }))} />
            Show on homepage (uses the order above)
          </label>
          {(() => {
            const lockFeature = featuredFull && !newForm.is_featured
            return (
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: '500 12px Inter,sans-serif', color: lockFeature ? '#B8B2AE' : '#1C1917', cursor: lockFeature ? 'not-allowed' : 'pointer' }}>
                  <input type="checkbox" checked={newForm.is_featured} disabled={lockFeature} onChange={e => setNewForm(f => ({ ...f, is_featured: e.target.checked }))} />
                  ⭐ Feature in booking Top {BOOKING_TOP_N} (shown first in the booking form)
                </label>
                {lockFeature && (
                  <div style={{ font: '400 11px Inter,sans-serif', color: '#B8860B', marginTop: 4 }}>
                    Already {BOOKING_TOP_N} treatments featured — un-feature one first.
                  </div>
                )}
              </div>
            )
          })()}
          {(() => {
            const lockPricing = pricingFull && !newForm.show_in_pricing
            return (
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: '500 12px Inter,sans-serif', color: lockPricing ? '#B8B2AE' : '#1C1917', cursor: lockPricing ? 'not-allowed' : 'pointer' }}>
                  <input type="checkbox" checked={newForm.show_in_pricing} disabled={lockPricing} onChange={e => setNewForm(f => ({ ...f, show_in_pricing: e.target.checked }))} />
                  💎 Show in homepage Pricing section (packages/passes — max {PRICING_SECTION_MAX})
                </label>
                {lockPricing && (
                  <div style={{ font: '400 11px Inter,sans-serif', color: '#B8860B', marginTop: 4 }}>
                    Already {PRICING_SECTION_MAX} treatments shown there — remove one first.
                  </div>
                )}
              </div>
            )
          })()}
          <PhotoManager photos={newForm.photos} onChange={photos => setNewForm(f => ({ ...f, photos }))} />
          <button onClick={handleCreate} disabled={saving || !newForm.name} style={{ background: '#C4924A', color: '#fff', border: 'none', borderRadius: 4, padding: '10px 18px', font: '600 12px Inter,sans-serif', cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Create Treatment'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8, padding: 12 }}>
        <input className="input" placeholder="Search by name…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 200 }} />
        <select className="input" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="all">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{TREATMENT_CATEGORIES[c]}</option>)}
        </select>
        <select className="input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ maxWidth: 150 }}>
          <option value="all">All statuses</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
        <select className="input" value={homepageFilter} onChange={e => setHomepageFilter(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="all">Homepage: all</option>
          <option value="yes">On homepage</option>
          <option value="no">Not on homepage</option>
        </select>
        <select className="input" value={featuredFilter} onChange={e => setFeaturedFilter(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="all">Featured: all</option>
          <option value="yes">Featured only</option>
          <option value="no">Not featured</option>
        </select>
        <select className="input" value={pricingFilter} onChange={e => setPricingFilter(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="all">Pricing section: all</option>
          <option value="yes">In pricing section</option>
          <option value="no">Not in pricing section</option>
        </select>
        <select className="input" value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ maxWidth: 150 }}>
          <option value="order">Sort by order</option>
          <option value="name">Sort by name</option>
        </select>
        <div style={{ display: 'flex', alignItems: 'center', font: '400 11px Inter,sans-serif', color: '#9B9390' }}>{filtered.length} of {treatments.length}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.map(t => (
          <div key={t.id} style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8, padding: 16, opacity: t.is_active ? 1 : 0.55 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ font: '600 14px Inter,sans-serif' }}>
                  {t.name} {t.badge && <span style={{ background: '#E8EDE9', color: '#3B5249', padding: '2px 8px', borderRadius: 999, font: '600 9px Inter,sans-serif', marginLeft: 6 }}>{t.badge}</span>}
                  {t.photos?.length > 0 && <span style={{ color: '#9B9390', font: '400 11px Inter,sans-serif', marginLeft: 8 }}>📷 {t.photos.length}</span>}
                  {t.show_on_homepage && <span style={{ background: '#FBF0DF', color: '#C4924A', padding: '2px 8px', borderRadius: 999, font: '600 9px Inter,sans-serif', marginLeft: 6 }}>🏠 Homepage</span>}
                  {t.is_featured && <span style={{ background: '#F0F4F2', color: '#3B5249', padding: '2px 8px', borderRadius: 999, font: '600 9px Inter,sans-serif', marginLeft: 6 }}>⭐ Featured</span>}
                  {t.show_in_pricing && <span style={{ background: '#EAF2F1', color: '#1D6E62', padding: '2px 8px', borderRadius: 999, font: '600 9px Inter,sans-serif', marginLeft: 6 }}>💎 Pricing</span>}
                </div>
                <div style={{ font: '400 12px Inter,sans-serif', color: '#9B9390', marginTop: 2 }}>{TREATMENT_CATEGORIES[t.category] ?? t.category} · order {t.sort_order ?? 0}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setEditingId(editingId === t.id ? null : t.id)} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, padding: '6px 12px', font: '500 11px Inter,sans-serif', cursor: 'pointer' }}>
                  {editingId === t.id ? 'Close' : 'Edit'}
                </button>
                <button onClick={() => toggleActive(t)} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, padding: '6px 12px', font: '500 11px Inter,sans-serif', cursor: 'pointer' }}>
                  {t.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button onClick={() => handleDelete(t.id)} style={{ background: 'none', border: '1px solid #FCA5A5', color: '#DC2626', borderRadius: 4, padding: '6px 12px', font: '500 11px Inter,sans-serif', cursor: 'pointer' }}>
                  Delete
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
              {(t.duration_options ?? []).map(d => (
                <div key={d} style={{ font: '400 12px Inter,sans-serif', color: '#6B6663' }}>{d}min — ฿{t.prices?.[String(d)] ?? '—'}</div>
              ))}
            </div>

            {editingId === t.id && (
              <EditForm treatment={t} featuredCount={featuredCount} pricingCount={pricingCount} onSave={patch => handleSaveEdit(t, patch)} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function EditForm({ treatment, featuredCount = 0, pricingCount = 0, onSave }) {
  const [name, setName] = useState(treatment.name)
  const [description, setDescription] = useState(treatment.description ?? '')
  const [badge, setBadge] = useState(treatment.badge ?? '')
  const [category, setCategory] = useState(treatment.category ?? 'massage')
  const [durationsCsv, setDurationsCsv] = useState((treatment.duration_options ?? []).join(','))
  const [pricesCsv, setPricesCsv] = useState((treatment.duration_options ?? []).map(d => treatment.prices?.[String(d)] ?? '').join(','))
  const [photos, setPhotos] = useState(treatment.photos ?? [])
  const [sortOrder, setSortOrder] = useState(treatment.sort_order ?? 0)
  const [showOnHomepage, setShowOnHomepage] = useState(treatment.show_on_homepage ?? false)
  const [isFeatured, setIsFeatured] = useState(treatment.is_featured ?? false)
  const [showInPricing, setShowInPricing] = useState(treatment.show_in_pricing ?? false)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const durations = durationsCsv.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean)
    const priceList = pricesCsv.split(',').map(s => parseInt(s.trim(), 10))
    const prices = {}
    durations.forEach((d, i) => { if (priceList[i]) prices[String(d)] = priceList[i] })
    await onSave({ name, description, badge: badge || null, category, duration_options: durations, prices, photos, sort_order: sortOrder, show_on_homepage: showOnHomepage, is_featured: isFeatured, show_in_pricing: showInPricing })
    setSaving(false)
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #F0ECE6', display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 500 }}>
      <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Name" />
      <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
        {CATEGORIES.map(c => <option key={c} value={c}>{TREATMENT_CATEGORIES[c]}</option>)}
      </select>
      <textarea className="input" rows={3} style={textareaStyle} value={description} onChange={e => setDescription(e.target.value)} placeholder="Description" />
      <input className="input" value={badge} onChange={e => setBadge(e.target.value)} placeholder="Badge (optional)" />
      <div style={{ display: 'flex', gap: 10 }}>
        <input className="input" value={durationsCsv} onChange={e => setDurationsCsv(e.target.value)} placeholder="Durations e.g. 60,90,120" />
        <input className="input" value={pricesCsv} onChange={e => setPricesCsv(e.target.value)} placeholder="Prices e.g. 600,850,1100" />
      </div>
      <div>
        <label style={{ display: 'block', font: '500 11px Inter,sans-serif', color: '#6B6663', marginBottom: 4 }}>Menu order (lower shows first)</label>
        <input className="input" type="number" value={sortOrder} onChange={e => setSortOrder(parseInt(e.target.value, 10) || 0)} style={{ maxWidth: 100 }} />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: '500 12px Inter,sans-serif', color: '#1C1917', cursor: 'pointer' }}>
        <input type="checkbox" checked={showOnHomepage} onChange={e => setShowOnHomepage(e.target.checked)} />
        Show on homepage (uses the order above)
      </label>
      {(() => {
        // Can't newly feature this one if the cap is already full with OTHERS.
        const lockFeature = !treatment.is_featured && featuredCount >= BOOKING_TOP_N
        return (
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: '500 12px Inter,sans-serif', color: lockFeature ? '#B8B2AE' : '#1C1917', cursor: lockFeature ? 'not-allowed' : 'pointer' }}>
              <input type="checkbox" checked={isFeatured} disabled={lockFeature} onChange={e => setIsFeatured(e.target.checked)} />
              ⭐ Feature in booking Top {BOOKING_TOP_N} (shown first in the booking form)
            </label>
            {lockFeature && (
              <div style={{ font: '400 11px Inter,sans-serif', color: '#B8860B', marginTop: 4 }}>
                Already {BOOKING_TOP_N} treatments featured — un-feature one first.
              </div>
            )}
          </div>
        )
      })()}
      {(() => {
        const lockPricing = !treatment.show_in_pricing && pricingCount >= PRICING_SECTION_MAX
        return (
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: '500 12px Inter,sans-serif', color: lockPricing ? '#B8B2AE' : '#1C1917', cursor: lockPricing ? 'not-allowed' : 'pointer' }}>
              <input type="checkbox" checked={showInPricing} disabled={lockPricing} onChange={e => setShowInPricing(e.target.checked)} />
              💎 Show in homepage Pricing section (packages/passes — max {PRICING_SECTION_MAX})
            </label>
            {lockPricing && (
              <div style={{ font: '400 11px Inter,sans-serif', color: '#B8860B', marginTop: 4 }}>
                Already {PRICING_SECTION_MAX} treatments shown there — remove one first.
              </div>
            )}
          </div>
        )
      })()}
      <PhotoManager photos={photos} onChange={setPhotos} />
      <button onClick={handleSave} disabled={saving} style={{ background: '#3B5249', color: '#fff', border: 'none', borderRadius: 4, padding: '10px 18px', font: '600 12px Inter,sans-serif', cursor: 'pointer' }}>
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  )
}

// Uploads directly to Cloudinary (unsigned preset) and appends the resulting
// URL to the treatment's `photos` array — no separate DB table needed, since
// photos live right on the treatment row.
function PhotoManager({ photos, onChange }) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(null) // { done, total }
  const [errors, setErrors] = useState([])       // [{ fileName, message }]

  const uploadOne = async (file) => {
    const resized = await resizeImageForUpload(file)
    const formData = new FormData()
    formData.append('file', resized)
    formData.append('upload_preset', UPLOAD_PRESET)
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body: formData })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message || 'Upload failed')
    return data.secure_url
  }

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setErrors([])
    if (!CLOUD_NAME || !UPLOAD_PRESET) { setErrors([{ fileName: '', message: 'Cloudinary is not configured.' }]); return }

    setUploading(true)
    setProgress({ done: 0, total: files.length })
    const newErrors = []
    let uploaded = [...photos]

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        const url = await uploadOne(file)
        uploaded = [...uploaded, url]
        onChange(uploaded)
      } catch (err) {
        newErrors.push({ fileName: file.name, message: err.message })
      }
      setProgress({ done: i + 1, total: files.length })
    }

    setErrors(newErrors)
    setUploading(false)
    setProgress(null)
    e.target.value = ''
  }

  const removePhoto = (url) => onChange(photos.filter(p => p !== url))

  return (
    <div>
      <label style={{ display: 'block', font: '500 11px Inter,sans-serif', color: '#6B6663', marginBottom: 6 }}>Photos</label>
      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {photos.map(url => (
            <div key={url} style={{ position: 'relative', width: 64, height: 64, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
              <Image src={url} alt="" fill sizes="64px" style={{ objectFit: 'cover' }} />
              <button
                onClick={() => removePhoto(url)}
                aria-label="Remove photo"
                style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', background: 'rgba(28,25,23,0.75)', color: '#fff', border: 'none', cursor: 'pointer', font: '400 11px Inter,sans-serif', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >×</button>
            </div>
          ))}
        </div>
      )}
      <label style={{ display: 'inline-block', background: '#fff', border: '1px solid var(--color-border)', borderRadius: 4, padding: '7px 14px', font: '500 11px Inter,sans-serif', cursor: 'pointer' }}>
        {uploading ? `Uploading ${progress?.done ?? 0} of ${progress?.total ?? 0}…` : '+ Add Photos'}
        <input type="file" accept="image/*" multiple onChange={handleUpload} disabled={uploading} style={{ display: 'none' }} />
      </label>
      {errors.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {errors.map((e, i) => (
            <p key={i} style={{ color: '#DC2626', font: '400 12px Inter,sans-serif', margin: i === 0 ? 0 : '4px 0 0' }}>
              {e.fileName ? <strong>{e.fileName}:</strong> : null} {e.message}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
