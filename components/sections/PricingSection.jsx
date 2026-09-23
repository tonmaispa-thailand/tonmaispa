'use client'

import { t } from '@/lib/i18n/t'
import { TREATMENT_CATEGORIES } from '@/lib/display'

// A ticked treatment's price: packages (the intended use of show_in_pricing)
// have exactly one duration option, so this is normally a single flat price
// — but a treatment with more than one tier still renders sensibly as
// "From ฿X" rather than breaking the single-price card layout.
// (Param named `treatment`, not `t` — this file also imports the `t()` i18n
// helper, and shadowing it here risks a silent bug in a future edit.)
function pricingCardPrice(treatment) {
  const durations = treatment.duration_options ?? []
  // Only durations with an actual matching price count — a duration_options
  // entry with no corresponding `prices[String(d)]` (e.g. a CSV paste that
  // set durations but not prices) must fall back to "no price", not to
  // Math.min() of an empty array, which silently returns Infinity and would
  // render "฿Infinity" on the live homepage.
  const knownPrices = durations.map(d => treatment.prices?.[String(d)]).filter(Boolean)
  if (knownPrices.length === 0) return { price: null, isFrom: false }
  return { price: Math.min(...knownPrices), isFrom: durations.length > 1 }
}

export default function PricingSection({ settings = {}, dict = {}, treatments = [], lang = 'en' }) {
  const dayPass = settings['settings.day_pass_price']    ?? '200'
  const iceBath = settings['settings.ice_bath_price']    ?? '100'
  const wa      = settings['settings.whatsapp_number']   ?? '66822866058'
  const waMsg   = encodeURIComponent('Hi, I\'d like to enquire about the day pass at Ton Mai Spa')
  const dayPassFeatures = dict.home?.pricing?.dayPassFeatures ?? []
  const iceBathFeatures = dict.home?.pricing?.iceBathFeatures ?? []

  return (
    <section id="pricing" style={{ padding: 'clamp(64px,10vw,128px) clamp(18px,4vw,40px)', background: '#1C1917' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>

        <div data-reveal style={{ opacity: 0, transform: 'translateY(24px)', transition: 'opacity .8s ease, transform .8s ease', textAlign: 'center', marginBottom: 'clamp(40px,5vw,64px)' }}>
          <div style={{ font: '600 11px Inter,sans-serif', letterSpacing: 3, textTransform: 'uppercase', color: '#C4924A' }}>{t(dict, 'home.pricing.eyebrow')}</div>
          <h2 style={{ font: '400 clamp(30px,4.5vw,52px)/1.08 Cormorant Garamond,serif', color: '#fff', margin: '12px 0 0' }}>
            {t(dict, 'home.pricing.title')}
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 24 }}>

          {/* Day Pass */}
          <div data-reveal style={{ opacity: 0, transform: 'translateY(28px)', transition: 'opacity .8s ease, transform .8s ease', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 'clamp(28px,3vw,44px)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ font: '600 11px Inter,sans-serif', letterSpacing: 3, textTransform: 'uppercase', color: '#C4924A' }}>{t(dict, 'home.pricing.thermalCircuit')}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '16px 0 0' }}>
              <span style={{ font: '400 58px/1 Cormorant Garamond,serif', color: '#fff' }}>฿{dayPass}</span>
              <span style={{ font: '400 16px Inter,sans-serif', color: 'rgba(255,255,255,0.5)' }}>{t(dict, 'home.pricing.perPerson')}</span>
            </div>
            <div style={{ font: '400 22px Cormorant Garamond,serif', color: '#fff', margin: '4px 0 0' }}>{t(dict, 'home.pricing.saunaDayPass')}</div>
            <ul style={{ listStyle: 'none', margin: '22px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {dayPassFeatures.map(item => (
                <li key={item} style={{ display: 'flex', gap: 10, font: '400 14px/1.5 Inter,sans-serif', color: 'rgba(255,255,255,0.75)' }}>
                  <span style={{ color: '#C4924A', flexShrink: 0 }}>✓</span>{item}
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 'auto', paddingTop: 28 }}>
              <a href="#contact" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 50, background: '#C4924A', color: '#fff', borderRadius: 2, font: '600 11px Inter,sans-serif', letterSpacing: '2.5px', textTransform: 'uppercase' }}
                onClick={() => { if (window.gtag) window.gtag('event','book_now_click',{method:'pricing_day_pass'}) }}>
                {t(dict, 'home.pricing.bookNow')}
              </a>
            </div>
          </div>

          {/* Ice Bath Add-on */}
          <div data-reveal style={{ opacity: 0, transform: 'translateY(28px)', transition: 'opacity .8s .1s ease, transform .8s .1s ease', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 'clamp(28px,3vw,44px)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ font: '600 11px Inter,sans-serif', letterSpacing: 3, textTransform: 'uppercase', color: '#C4924A' }}>{t(dict, 'home.pricing.addOn')}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '16px 0 0' }}>
              <span style={{ font: '400 58px/1 Cormorant Garamond,serif', color: '#fff' }}>฿{iceBath}</span>
              <span style={{ font: '400 16px Inter,sans-serif', color: 'rgba(255,255,255,0.5)' }}>{t(dict, 'home.pricing.perSession')}</span>
            </div>
            <div style={{ font: '400 22px Cormorant Garamond,serif', color: '#fff', margin: '4px 0 0' }}>{t(dict, 'home.pricing.iceBath')}</div>
            <ul style={{ listStyle: 'none', margin: '22px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {iceBathFeatures.map(item => (
                <li key={item} style={{ display: 'flex', gap: 10, font: '400 14px/1.5 Inter,sans-serif', color: 'rgba(255,255,255,0.75)' }}>
                  <span style={{ color: '#C4924A', flexShrink: 0 }}>✓</span>{item}
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 'auto', paddingTop: 28 }}>
              <a
                href={`https://wa.me/${wa}?text=${waMsg}`}
                target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 50, background: '#075E54', color: '#fff', borderRadius: 2, font: '600 11px Inter,sans-serif', letterSpacing: '2.5px', textTransform: 'uppercase' }}
                onClick={() => { if (window.gtag) window.gtag('event','whatsapp_click',{method:'pricing_ice_bath'}) }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
                {t(dict, 'home.pricing.enquireWhatsapp')}
              </a>
            </div>
          </div>

          {/* Owner-picked packages/passes (show_in_pricing, capped at
              PRICING_SECTION_MAX) — same card shell as the two static cards
              above, so the section reads as one family of "simple, single-
              price" offers rather than two different UIs bolted together. */}
          {treatments.map((pkg, i) => {
            const { price, isFrom } = pricingCardPrice(pkg)
            // Package descriptions are written as an arrow-separated flow
            // ("Thermal circuit → scrub → massage → coconut water") — split
            // it into the same ✓-list style as the static cards above when
            // it fits that shape; otherwise fall back to plain prose so an
            // admin-entered treatment without that format never looks broken.
            const steps = pkg.description?.includes('→') ? pkg.description.split('→').map(s => s.trim()).filter(Boolean) : null
            return (
              <div key={pkg.id} data-reveal style={{ opacity: 0, transform: 'translateY(28px)', transition: `opacity .8s ${0.2 + i * 0.1}s ease, transform .8s ${0.2 + i * 0.1}s ease`, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 'clamp(28px,3vw,44px)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ font: '600 11px Inter,sans-serif', letterSpacing: 3, textTransform: 'uppercase', color: '#C4924A' }}>{TREATMENT_CATEGORIES[pkg.category] ?? pkg.category}</div>
                  {pkg.badge && <span style={{ background: '#8A6528', color: '#fff', padding: '3px 10px', borderRadius: 999, font: '600 9px Inter,sans-serif', letterSpacing: 1.5, textTransform: 'uppercase' }}>{pkg.badge}</span>}
                </div>
                {price != null && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '16px 0 0' }}>
                    {isFrom && <span style={{ font: '400 16px Inter,sans-serif', color: 'rgba(255,255,255,0.5)' }}>From</span>}
                    <span style={{ font: '400 58px/1 Cormorant Garamond,serif', color: '#fff' }}>฿{price}</span>
                  </div>
                )}
                <div style={{ font: '400 22px Cormorant Garamond,serif', color: '#fff', margin: '4px 0 0' }}>{pkg.name}</div>
                {steps ? (
                  <ul style={{ listStyle: 'none', margin: '22px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {steps.map((step, si) => (
                      <li key={si} style={{ display: 'flex', gap: 10, font: '400 14px/1.5 Inter,sans-serif', color: 'rgba(255,255,255,0.75)' }}>
                        <span style={{ color: '#C4924A', flexShrink: 0 }}>✓</span>{step}
                      </li>
                    ))}
                  </ul>
                ) : pkg.description && (
                  <p style={{ font: '400 14px/1.6 Inter,sans-serif', color: 'rgba(255,255,255,0.75)', margin: '22px 0 0' }}>{pkg.description}</p>
                )}
                <div style={{ marginTop: 'auto', paddingTop: 28 }}>
                  <a href={pkg.slug ? `/${lang}/book?treatment=${pkg.slug}` : `/${lang}/book`}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 50, background: '#C4924A', color: '#fff', borderRadius: 2, font: '600 11px Inter,sans-serif', letterSpacing: '2.5px', textTransform: 'uppercase' }}
                    onClick={() => { if (window.gtag) window.gtag('event', 'book_now_click', { method: 'pricing_package', treatment: pkg.name }) }}>
                    {t(dict, 'home.pricing.bookNow')}
                  </a>
                </div>
              </div>
            )
          })}
        </div>

        <p style={{ textAlign: 'center', font: '400 13px Inter,sans-serif', color: 'rgba(255,255,255,0.66)', marginTop: 28 }}>
          {t(dict, 'home.pricing.footerNote')}
        </p>
      </div>
    </section>
  )
}
