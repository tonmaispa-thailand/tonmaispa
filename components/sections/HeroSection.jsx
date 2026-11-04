'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { t } from '@/lib/i18n/t'

// Built-in fallback — used until the owner picks hero photos in Dashboard → Gallery.
const DEFAULT_SLIDES = [
  { src: '/assets/slide-pool-22.jpg',    alt: 'Sunlit tropical pool surrounded by lush garden at Ton Mai Spa' },
  { src: '/assets/slide-restaurant.jpg', alt: 'Open-air restaurant beneath the great tree at Ton Mai Spa' },
  { src: '/assets/slide-pool-12.jpg',    alt: 'Pool lounge with blue sunbeds and palms' },
  { src: '/assets/slide-outdoor-03.jpg', alt: 'Bamboo massage salas in tropical garden' },
  { src: '/assets/slide-night.jpg',      alt: 'Warm night ambiance at the illuminated pool' },
  { src: '/assets/slide-outdoor-21.jpg', alt: 'Handbuilt bamboo massage sala at Ton Mai Spa' },
  { src: '/assets/slide-garden-25.jpg',  alt: 'Garden path with Thai statues and bamboo salas' },
  { src: '/assets/slide-sauna.jpg',      alt: 'Dry sauna warm teak interior at Ton Mai Spa' },
]

export default function HeroSection({ settings = {}, dict = {}, slides = [] }) {
  const SLIDES = slides.length > 0 ? slides : DEFAULT_SLIDES
  // The interval/timeout callbacks below are created once (first render); read the slide
  // count through a ref so they never use a stale length if the slides prop changes.
  const countRef = useRef(SLIDES.length)
  countRef.current = SLIDES.length
  const rating      = settings['settings.google_rating']       ?? '4.8'
  const reviewCount = settings['settings.google_review_count'] ?? '369'
  const dayPass     = settings['settings.day_pass_price']      ?? '200'

  const [slideIdx, setSlideIdx] = useState(0)
  // Only the current slide + the one queued to appear next are ever mounted —
  // loading all 8 full-size hero photos up front tanked mobile LCP. The
  // second slide additionally waits ~3s after mount so its download never
  // competes with the LCP image on a slow connection (Lighthouse flagged
  // both hero photos loading side by side).
  const [loadedIndices, setLoadedIndices] = useState(() => new Set([0]))
  const timerRef = useRef(null)

  const startTimer = () => {
    clearInterval(timerRef.current)
    if (countRef.current < 2) return // a single photo has nothing to rotate to
    timerRef.current = setInterval(() => {
      const n = countRef.current
      setSlideIdx(i => {
        const next = (i + 1) % n
        setLoadedIndices(prev => new Set(prev).add(next).add((next + 1) % n))
        return next
      })
    }, 6000)
  }

  useEffect(() => {
    startTimer()
    // Pre-mount the next slide well after first paint, well before the 6s fade.
    const preloadNext = setTimeout(() => {
      setLoadedIndices(prev => new Set(prev).add(1 % countRef.current))
    }, 3000)
    return () => { clearInterval(timerRef.current); clearTimeout(preloadNext) }
  }, [])

  const goToSlide = (i) => {
    setSlideIdx(i)
    setLoadedIndices(prev => new Set(prev).add(i).add((i + 1) % countRef.current))
    startTimer()
  }

  return (
    <section id="top" style={{
      position: 'relative', minHeight: 'clamp(680px,98svh,1000px)',
      display: 'flex', alignItems: 'flex-end', overflow: 'hidden',
    }}>
      {/* Cross-fading hero slideshow — only mount slides that have been
          reached or are queued next, so the browser never fetches all 8
          full-size photos on initial load. */}
      {SLIDES.map((slide, i) => loadedIndices.has(i) && (
        <Image
          key={slide.src}
          src={slide.src}
          alt={slide.alt}
          aria-hidden={i !== slideIdx}
          fill
          priority={i === 0}
          sizes="100vw"
          style={{
            objectFit: 'cover',
            opacity: slideIdx === i ? 1 : 0,
            transition: 'opacity 2s cubic-bezier(0.4,0,0.2,1)',
          }}
        />
      ))}

      {/* Gradient overlay */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(28,25,23,0.28) 0%, rgba(28,25,23,0) 30%, rgba(28,25,23,0.05) 55%, rgba(28,25,23,0.82) 100%)' }} />

      {/* Slide dots */}
      {SLIDES.length > 1 && <div style={{ position: 'absolute', bottom: 'clamp(16px,3vw,28px)', left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 8, zIndex: 2 }}>
        {SLIDES.map((_, i) => (
          <span
            key={i}
            onClick={() => goToSlide(i)}
            role="button"
            aria-label={`Go to slide ${i + 1}`}
            style={{
              display: 'block', height: 2, borderRadius: 2, cursor: 'pointer',
              width: slideIdx === i ? 28 : 8,
              background: slideIdx === i ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)',
              transition: 'width .4s, background .4s',
            }}
          />
        ))}
      </div>}

      {/* Content */}
      <div style={{ position: 'relative', width: '100%', maxWidth: 1200, margin: '0 auto', padding: 'clamp(96px,16vw,180px) clamp(18px,4vw,40px) clamp(80px,10vw,140px)' }}>
        <div style={{ font: '600 11px Inter,sans-serif', letterSpacing: '3.5px', textTransform: 'uppercase', color: '#F0E8DF', opacity: 0.95 }}>
          {t(dict, 'home.hero.eyebrow')}
        </div>
        <h1 style={{ font: '400 clamp(44px,11vw,92px)/1.0 Cormorant Garamond,serif', color: '#fff', margin: '18px 0 0', letterSpacing: '-0.5px', maxWidth: '14ch', textShadow: '0 2px 30px rgba(28,25,23,0.3)' }}>
          {t(dict, 'home.hero.titleBefore')}<em style={{ fontStyle: 'italic', color: '#D9AE72' }}>{t(dict, 'home.hero.titleEmphasis')}</em>{t(dict, 'home.hero.titleAfter')}
        </h1>
        <p style={{ font: '400 clamp(15px,1.7vw,18px)/1.65 Inter,sans-serif', color: 'rgba(255,255,255,0.9)', margin: '22px 0 0', maxWidth: '46ch' }}>
          {t(dict, 'home.hero.subtitle')}
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 30 }}>
          <a href="#contact" style={{ background: '#3B5249', color: '#fff', padding: '16px 30px', borderRadius: 2, font: '600 11px Inter,sans-serif', letterSpacing: '2.5px', textTransform: 'uppercase' }}
            onClick={() => { if (window.gtag) window.gtag('event','book_now_click',{method:'hero'}) }}>
            {t(dict, 'home.hero.bookNow')}
          </a>
          <a href="#treatments" style={{ background: 'rgba(250,246,240,0.12)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', color: '#fff', padding: '16px 30px', borderRadius: 2, font: '600 11px Inter,sans-serif', letterSpacing: '2.5px', textTransform: 'uppercase', border: '1px solid rgba(255,255,255,0.5)' }}>
            {t(dict, 'home.hero.exploreTreatments')}
          </a>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(20px,4vw,52px)', marginTop: 'clamp(34px,5vw,56px)', alignItems: 'center' }}>
          <div>
            <div style={{ font: '400 clamp(26px,3vw,34px) Cormorant Garamond,serif', color: '#fff' }}>{t(dict, 'home.hero.openHours')}</div>
            <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>{t(dict, 'home.hero.openEveryDay')}</div>
          </div>
          <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.25)' }} />
          <div>
            <div style={{ font: '400 clamp(26px,3vw,34px) Cormorant Garamond,serif', color: '#fff' }}>฿{dayPass}</div>
            <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>{t(dict, 'home.hero.saunaDayPass')}</div>
          </div>
          <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.25)' }} />
          <div>
            <div style={{ font: '400 clamp(26px,3vw,34px) Cormorant Garamond,serif', color: '#fff' }}>★ {rating}</div>
            <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>{reviewCount}{t(dict, 'home.hero.googleReviewsSuffix')}</div>
          </div>
        </div>
      </div>
    </section>
  )
}
