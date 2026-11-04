'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { resizeImageForUpload } from '@/lib/resize-image'
import { HERO_MAX } from '@/lib/gallery-hero'

const CLOUD_NAME    = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
const UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET

export default function GalleryClient({ initialPhotos }) {
  const [photos, setPhotos]     = useState(initialPhotos)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(null) // { done, total }
  const [errors, setErrors]     = useState([])   // [{ fileName, message }]
  const [selError, setSelError] = useState('')   // hero / About save errors
  const [savingSel, setSavingSel] = useState(false)
  const savingRef = useRef(false) // one hero/About save in flight at a time (a 2nd click would be computed from stale state and clobber the 1st)

  // Hero slideshow = photos with a hero_order, in that order (migration 039).
  // Before 039 is applied the columns are missing from the rows.
  const migrated = photos.length === 0 || 'hero_order' in photos[0]
  const heroPhotos = photos.filter(p => p.hero_order != null).sort((a, b) => a.hero_order - b.hero_order)
  const aboutPhoto = photos.find(p => p.is_about)
  const heroFull   = heroPhotos.length >= HERO_MAX

  // Runs one save at a time; local state is only updated after the server accepted it,
  // so a rejected save leaves the screen showing what is really stored.
  const runSelSave = async (url, payload, failMsg, applyLocal) => {
    if (savingRef.current) return
    savingRef.current = true; setSavingSel(true); setSelError('')
    try {
      const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) { setSelError((await res.json().catch(() => ({}))).error || failMsg); return }
      applyLocal()
    } catch {
      setSelError(failMsg)
    } finally {
      savingRef.current = false; setSavingSel(false)
    }
  }

  const saveHero = (ids) => runSelSave('/api/admin/gallery/hero', { ids }, 'Could not save hero photos',
    () => setPhotos(prev => prev.map(p => ({ ...p, hero_order: ids.includes(p.id) ? ids.indexOf(p.id) + 1 : null }))))
  const heroIds = heroPhotos.map(p => p.id)
  const addHero    = (id) => !heroFull && !heroIds.includes(id) && saveHero([...heroIds, id])
  const removeHero = (id) => saveHero(heroIds.filter(x => x !== id))
  const moveHero   = (id, dir) => {
    const i = heroIds.indexOf(id), j = i + dir
    if (i < 0 || j < 0 || j >= heroIds.length) return
    const next = [...heroIds]; [next[i], next[j]] = [next[j], next[i]]
    saveHero(next)
  }

  const saveAbout = (id, align = 'center') => runSelSave('/api/admin/gallery/about', { id, align }, 'Could not save About photo',
    () => setPhotos(prev => prev.map(p => ({ ...p, is_about: p.id === id, about_align: p.id === id ? align : (p.about_align ?? 'center') }))))

  const uploadOne = async (file, sortOrder) => {
    const resized = await resizeImageForUpload(file)
    const formData = new FormData()
    formData.append('file', resized)
    formData.append('upload_preset', UPLOAD_PRESET)

    const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: 'POST',
      body: formData,
    })
    const uploadData = await uploadRes.json()
    if (!uploadRes.ok) throw new Error(uploadData.error?.message || 'Cloudinary upload failed')

    const res = await fetch('/api/admin/gallery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cloudinary_url: uploadData.secure_url, sort_order: sortOrder }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'Could not save photo record')
    }
    const { photo } = await res.json()
    return photo
  }

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setErrors([])

    if (!CLOUD_NAME || !UPLOAD_PRESET) {
      setErrors([{ fileName: '', message: 'Cloudinary is not configured (missing cloud name or upload preset).' }])
      return
    }

    setUploading(true)
    setProgress({ done: 0, total: files.length })
    const newErrors = []

    // Sequential, not parallel — keeps sort_order correct and avoids
    // hammering Cloudinary with a burst of simultaneous uploads.
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        const photo = await uploadOne(file, photos.length + i)
        setPhotos(prev => [...prev, photo])
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

  const toggleFeatured = async (photo) => {
    const res = await fetch(`/api/admin/gallery/${photo.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ featured: !photo.featured }),
    })
    if (res.ok) setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, featured: !photo.featured } : p))
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this photo from the gallery?')) return
    const res = await fetch(`/api/admin/gallery/${id}`, { method: 'DELETE' })
    if (res.ok) setPhotos(prev => prev.filter(p => p.id !== id))
  }

  const panel   = { background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8, padding: 18 }
  const panelH  = { font: '600 15px Inter,sans-serif', color: '#1C1917', margin: 0 }
  const panelP  = { font: '400 12px/1.6 Inter,sans-serif', color: '#6B6663', margin: '6px 0 14px' }
  const tinyBtn = { background: '#fff', border: '1px solid var(--color-border)', borderRadius: 4, padding: '4px 0', font: '500 12px Inter,sans-serif', cursor: 'pointer' }

  return (
    <div>
      {!migrated && (
        <div style={{ marginBottom: 14, background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 6, padding: '10px 14px', font: '400 13px Inter,sans-serif', color: '#92400E' }}>
          Hero / About selection needs database migration 039 (<code>039_gallery_hero_about.sql</code>). Run it in the Supabase SQL Editor, then reload.
        </div>
      )}
      {selError && (
        <div style={{ marginBottom: 14, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, padding: '10px 14px', font: '400 13px Inter,sans-serif', color: '#DC2626' }}>{selError}</div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div style={{ ...panel, flex: '2 1 420px', minWidth: 0 }}>
          <h2 style={panelH}>Homepage hero ({heroPhotos.length}/{HERO_MAX})</h2>
          <p style={panelP}>Press &ldquo;Use in Hero&rdquo; on a photo below to add it. The hero slideshow shows only the selected photos, in this order. With none selected the site keeps its built-in photos.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {heroPhotos.map((p, i) => (
              <div key={p.id} style={{ width: 150 }}>
                <div style={{ position: 'relative', height: 96, borderRadius: 6, overflow: 'hidden' }}>
                  <Image src={p.cloudinary_url} alt={p.alt_text ?? ''} fill sizes="150px" style={{ objectFit: 'cover' }} />
                  <div style={{ position: 'absolute', top: 5, left: 5, width: 20, height: 20, borderRadius: 999, background: '#3B5249', color: '#fff', font: '600 11px Inter,sans-serif', display: 'grid', placeItems: 'center' }}>{i + 1}</div>
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
                  <button onClick={() => moveHero(p.id, -1)} disabled={i === 0 || savingSel} aria-label="Move earlier" style={{ ...tinyBtn, flex: 1, opacity: i === 0 || savingSel ? 0.35 : 1 }}>←</button>
                  <button onClick={() => moveHero(p.id, 1)} disabled={i === heroPhotos.length - 1 || savingSel} aria-label="Move later" style={{ ...tinyBtn, flex: 1, opacity: i === heroPhotos.length - 1 || savingSel ? 0.35 : 1 }}>→</button>
                  <button onClick={() => removeHero(p.id)} disabled={savingSel} aria-label="Remove from hero" style={{ ...tinyBtn, flex: 1, color: '#DC2626', borderColor: '#FCA5A5', opacity: savingSel ? 0.35 : 1 }}>×</button>
                </div>
              </div>
            ))}
            {heroPhotos.length === 0 && <div style={{ font: '400 13px Inter,sans-serif', color: '#9B9390' }}>No hero photos selected — using the built-in slideshow.</div>}
          </div>
        </div>

        <div style={{ ...panel, flex: '1 1 300px', minWidth: 0 }}>
          <h2 style={panelH}>About photo</h2>
          <p style={panelP}>Press &ldquo;Use in About&rdquo; on a photo below. If the photo gets cropped, keep this side:</p>
          {aboutPhoto ? (
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ position: 'relative', width: 110, height: 138, borderRadius: 6, overflow: 'hidden', flex: 'none' }}>
                <Image src={aboutPhoto.cloudinary_url} alt={aboutPhoto.alt_text ?? ''} fill sizes="110px" style={{ objectFit: 'cover', objectPosition: aboutPhoto.about_align === 'left' ? 'left center' : aboutPhoto.about_align === 'right' ? 'right center' : 'center' }} />
              </div>
              <div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[['left', 'Left'], ['center', 'Center'], ['right', 'Right']].map(([v, label]) => (
                    <button key={v} onClick={() => saveAbout(aboutPhoto.id, v)} disabled={savingSel} style={{ ...tinyBtn, padding: '6px 12px', background: aboutPhoto.about_align === v ? '#3B5249' : '#fff', color: aboutPhoto.about_align === v ? '#fff' : '#1C1917' }}>{label}</button>
                  ))}
                </div>
                <button onClick={() => saveAbout(null)} disabled={savingSel} style={{ ...tinyBtn, padding: '6px 12px', marginTop: 8 }}>Remove from About</button>
              </div>
            </div>
          ) : (
            <div style={{ font: '400 13px Inter,sans-serif', color: '#9B9390' }}>No About photo selected — using the built-in photo.</div>
          )}
        </div>
      </div>

      <label style={{ display: 'inline-block', marginBottom: 16, background: '#3B5249', color: '#fff', border: 'none', borderRadius: 4, padding: '10px 18px', font: '600 12px Inter,sans-serif', cursor: 'pointer' }}>
        {uploading ? `Uploading ${progress?.done ?? 0} of ${progress?.total ?? 0}…` : '+ Upload Photos'}
        <input type="file" accept="image/*" multiple onChange={handleUpload} disabled={uploading} style={{ display: 'none' }} />
      </label>
      {errors.length > 0 && (
        <div style={{ marginBottom: 12, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, padding: '10px 14px' }}>
          {errors.map((e, i) => (
            <p key={i} style={{ color: '#DC2626', font: '400 13px Inter,sans-serif', margin: i === 0 ? 0 : '4px 0 0' }}>
              {e.fileName ? <strong>{e.fileName}:</strong> : null} {e.message}
            </p>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 14 }}>
        {photos.map(photo => (
          <div key={photo.id} style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ position: 'relative', height: 130 }}>
              <Image src={photo.cloudinary_url} alt={photo.alt_text ?? ''} fill sizes="200px" style={{ objectFit: 'cover' }} />
              <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {photo.featured && <div style={{ background: '#C4924A', color: '#fff', padding: '2px 8px', borderRadius: 999, font: '600 9px Inter,sans-serif' }}>Featured</div>}
                {photo.hero_order != null && <div style={{ background: '#3B5249', color: '#fff', padding: '2px 8px', borderRadius: 999, font: '600 9px Inter,sans-serif' }}>Hero {heroIds.indexOf(photo.id) + 1}</div>}
                {photo.is_about && <div style={{ background: '#1C1917', color: '#fff', padding: '2px 8px', borderRadius: 999, font: '600 9px Inter,sans-serif' }}>About</div>}
              </div>
            </div>
            <div style={{ padding: '8px 8px 0', display: 'flex', gap: 6 }}>
              {photo.hero_order != null
                ? <button onClick={() => removeHero(photo.id)} disabled={savingSel} style={{ flex: 1, background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, padding: '6px 4px', font: '500 10px Inter,sans-serif', cursor: 'pointer', opacity: savingSel ? 0.4 : 1 }}>Remove from Hero</button>
                : <button onClick={() => addHero(photo.id)} disabled={heroFull || !migrated || savingSel} title={heroFull ? `Hero is full (${HERO_MAX} photos)` : undefined} style={{ flex: 1, background: '#3B5249', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 4px', font: '500 10px Inter,sans-serif', cursor: 'pointer', opacity: heroFull || !migrated || savingSel ? 0.4 : 1 }}>Use in Hero</button>}
              {photo.is_about
                ? <button onClick={() => saveAbout(null)} disabled={savingSel} style={{ flex: 1, background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, padding: '6px 4px', font: '500 10px Inter,sans-serif', cursor: 'pointer', opacity: savingSel ? 0.4 : 1 }}>Remove About</button>
                : <button onClick={() => saveAbout(photo.id)} disabled={!migrated || savingSel} style={{ flex: 1, background: '#fff', border: '1px solid #3B5249', color: '#3B5249', borderRadius: 4, padding: '6px 4px', font: '500 10px Inter,sans-serif', cursor: 'pointer', opacity: migrated && !savingSel ? 1 : 0.4 }}>Use in About</button>}
            </div>
            <div style={{ padding: 8, display: 'flex', gap: 6 }}>
              <button onClick={() => toggleFeatured(photo)} style={{ flex: 1, background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, padding: '6px 4px', font: '500 10px Inter,sans-serif', cursor: 'pointer' }}>
                {photo.featured ? 'Unfeature' : 'Feature'}
              </button>
              <button onClick={() => handleDelete(photo.id)} style={{ background: 'none', border: '1px solid #FCA5A5', color: '#DC2626', borderRadius: 4, padding: '6px 8px', font: '500 10px Inter,sans-serif', cursor: 'pointer' }}>
                Delete
              </button>
            </div>
          </div>
        ))}
        {photos.length === 0 && (
          <div style={{ gridColumn: '1/-1', padding: 24, textAlign: 'center', color: '#9B9390', font: '400 13px Inter,sans-serif' }}>No photos uploaded yet.</div>
        )}
      </div>
    </div>
  )
}
