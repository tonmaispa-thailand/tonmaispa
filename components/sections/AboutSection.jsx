import Image from 'next/image'
import TrackedLink from '@/components/ui/TrackedLink'
import { t } from '@/lib/i18n/t'

const OBJECT_POSITION = { left: 'left center', center: 'center', right: 'right center' }

// `image` = owner-picked photo from Dashboard → Gallery ({src, alt, align}); null → built-in garden photo.
export default function AboutSection({ dict = {}, image = null }) {
  return (
    <section id="about" style={{ padding: 'clamp(64px,10vw,128px) clamp(18px,4vw,40px)', background: '#FAF6F0' }}>
      <div data-reveal style={{ opacity: 0, transform: 'translateY(28px)', transition: 'opacity .9s cubic-bezier(.16,1,.3,1), transform .9s cubic-bezier(.16,1,.3,1)', maxWidth: 1200, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 'clamp(32px,5vw,72px)', alignItems: 'center' }}>

        <div style={{ position: 'relative' }}>
          <div style={{ position: 'relative', height: 'clamp(360px,46vw,560px)', borderRadius: 8, boxShadow: '0 20px 48px rgba(28,25,23,0.14)', overflow: 'hidden' }}>
            <Image
              src={image?.src ?? '/assets/garden.jpg'}
              alt={image?.alt ?? 'Guest relaxing on a rattan daybed in the tropical garden at Ton Mai Spa, Rawai Phuket'}
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              style={{ objectFit: 'cover', objectPosition: OBJECT_POSITION[image?.align] ?? 'center' }}
            />
          </div>
          <div style={{ position: 'absolute', bottom: -22, right: -12, background: '#fff', padding: '18px 24px', borderRadius: 4, boxShadow: '0 8px 24px rgba(28,25,23,0.12)', maxWidth: 200 }}>
            <div style={{ font: '400 32px Cormorant Garamond,serif', color: '#3B5249' }}>{t(dict, 'home.about.badgeName')}</div>
            <div style={{ font: '400 13px/1.5 Inter,sans-serif', color: '#6B6663', marginTop: 2 }}>{t(dict, 'home.about.badgeQuote')}</div>
          </div>
        </div>

        <div>
          <div style={{ font: '600 11px Inter,sans-serif', letterSpacing: 3, textTransform: 'uppercase', color: '#8A6528' }}>{t(dict, 'home.about.eyebrow')}</div>
          <h2 style={{ font: '400 clamp(30px,4.5vw,52px)/1.08 Cormorant Garamond,serif', color: '#1C1917', margin: '14px 0 0', letterSpacing: '-0.3px' }}>
            {t(dict, 'home.about.title')}
          </h2>
          <div style={{ width: 48, height: 2, background: '#3B5249', margin: '26px 0' }} />
          <p style={{ font: '400 clamp(15px,1.2vw,16px)/1.75 Inter,sans-serif', color: '#6B6663', margin: 0 }}>
            {t(dict, 'home.about.p1')}
          </p>
          <p style={{ font: '400 clamp(15px,1.2vw,16px)/1.75 Inter,sans-serif', color: '#6B6663', margin: '18px 0 0' }}>
            {t(dict, 'home.about.p2')}
          </p>
          <TrackedLink href="#contact" event="book_now_click" params={{ method: 'about_section' }} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 30, font: '600 11px Inter,sans-serif', letterSpacing: '2.5px', textTransform: 'uppercase', color: '#3B5249', borderBottom: '1.5px solid #C4924A', paddingBottom: 6 }}>
            {t(dict, 'home.about.cta')}
          </TrackedLink>
        </div>
      </div>
    </section>
  )
}
