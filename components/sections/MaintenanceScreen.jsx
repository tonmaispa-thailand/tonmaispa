// Shown on every public page while settings.maintenance_mode = 'true'.
//
// Deliberately a dead end with exactly TWO ways out: WhatsApp, and the spa's
// current live website (SITE_LINK). No booking form, no Line, no phone, no
// email, no chat bubble — while this build is in maintenance, every other
// channel is a promise it might not keep. The dashboard and /login live
// outside /[lang], so staff can always get in and switch it back off.
//
// Copy is inlined per locale rather than added to the i18n dictionaries: it is
// five short strings that must render even if a dictionary fails to load, and
// this screen is exactly the moment you cannot afford a second failure.

// Where the "visit our website" link goes: the spa's live site on its real
// domain, which the old (Wix) site still serves while this build is held in
// maintenance. Hardcoded on purpose — NEXT_PUBLIC_SITE_URL is the address of
// THIS deployment, i.e. right now it resolves to this very holding page.
// NOTE: once the domain is cut over to this build, both addresses are the same
// page and this link becomes a loop back to itself — remove it at cut-over.
const SITE_LINK  = 'https://www.tonmaispa.com/'
const SITE_LABEL = 'www.tonmaispa.com'

const COPY = {
  en: {
    heading: 'We are just taking a moment.',
    body: 'Our website is briefly unavailable while we make some improvements. The spa team is still here — message us on WhatsApp and we will look after you personally.',
    cta: 'Message us on WhatsApp',
    note: 'We usually reply within a few minutes.',
    site: 'Visit',
  },
  th: {
    heading: 'เราขอเวลาสักครู่',
    body: 'เว็บไซต์ของเราปิดปรับปรุงชั่วคราว แต่ทีมงานยังอยู่ครบ ทักมาทาง WhatsApp ได้เลย เราดูแลคุณเป็นการส่วนตัว',
    cta: 'ทักเราทาง WhatsApp',
    note: 'เรามักตอบกลับภายในไม่กี่นาที',
    site: 'ไปที่',
  },
  ru: {
    heading: 'Нам нужна всего минута.',
    body: 'Наш сайт временно недоступен — мы вносим улучшения. Команда спа на месте: напишите нам в WhatsApp, и мы позаботимся о вас лично.',
    cta: 'Написать в WhatsApp',
    note: 'Обычно отвечаем в течение нескольких минут.',
    site: 'Перейти на',
  },
  zh: {
    heading: '我们稍作调整，很快回来。',
    body: '网站正在进行升级，暂时无法访问。水疗团队仍在为您服务 — 通过 WhatsApp 联系我们，我们将亲自为您安排。',
    cta: '通过 WhatsApp 联系我们',
    note: '我们通常在几分钟内回复。',
    site: '访问',
  },
}

export default function MaintenanceScreen({ lang = 'en', whatsapp = '66822866058' }) {
  const t = COPY[lang] ?? COPY.en
  const digits = String(whatsapp).replace(/\D/g, '')
  const href = `https://wa.me/${digits}?text=${encodeURIComponent('Hello Ton Mai Spa')}`

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#3B5249',
        color: '#FAF6F0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'clamp(24px, 6vw, 64px)',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 520, width: '100%' }}>
        <div style={{ font: '400 clamp(26px, 4vw, 34px) Cormorant Garamond,serif', letterSpacing: 0.5 }}>
          Ton Mai Spa
        </div>

        <h1
          style={{
            font: '400 clamp(30px, 5.5vw, 46px)/1.15 Cormorant Garamond,serif',
            // globals.css sets `h1..h6 { color: var(--color-text) }`, which is
            // near-black and wins over inheriting from <main> — on this dark
            // green that renders the headline almost invisible. Be explicit.
            color: '#FAF6F0',
            margin: '28px 0 16px',
            textWrap: 'balance',
          }}
        >
          {t.heading}
        </h1>

        <p
          style={{
            font: '400 15px/1.75 Inter,sans-serif',
            color: 'rgba(250,246,240,0.78)',
            margin: '0 auto 36px',
            maxWidth: '44ch',
          }}
        >
          {t.body}
        </p>

        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            background: '#25D366',
            color: '#0B2E13',
            textDecoration: 'none',
            font: '600 15px Inter,sans-serif',
            padding: '16px 30px',
            borderRadius: 999,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
          </svg>
          {t.cta}
        </a>

        <p
          style={{
            font: '400 12.5px Inter,sans-serif',
            color: 'rgba(250,246,240,0.5)',
            marginTop: 20,
          }}
        >
          {t.note}
        </p>

        {/* Secondary way out: the spa's live website on its real domain. */}
        <div style={{ marginTop: 28 }}>
          <a
            href={SITE_LINK}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              color: '#FAF6F0',
              textDecoration: 'none',
              font: '500 14px Inter,sans-serif',
              padding: '12px 24px',
              borderRadius: 999,
              border: '1px solid rgba(250,246,240,0.4)',
            }}
          >
            {t.site} {SITE_LABEL}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </a>
        </div>
      </div>
    </main>
  )
}
