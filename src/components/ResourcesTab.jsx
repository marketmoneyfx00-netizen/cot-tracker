/**
 * ResourcesTab.jsx
 * Premium resources section — brokers, tools, platforms for traders.
 * Scalable: add new resources to the RESOURCES array. Supports featured cards,
 * coming-soon placeholders, badges, external links and category grouping.
 */

import { useState } from 'react';
import { buildTheme } from '../lib/theme.js';

// ── Config ────────────────────────────────────────────────────────────────────

const IC_TRADING_URL = 'https://www.ictrading.com?camp=88636';

export const RESOURCES = [
  {
    id: 'ictrading',
    category: 'broker',
    categoryLabel: 'Broker Recomendado',
    featured: true,
    name: 'IC Trading',
    tagline: 'El broker que utilizamos y recomendamos para operar con mayor seguridad y estabilidad.',
    description:
      'Acceso a Forex, índices, oro, commodities, acciones y miles de CFDs desde una plataforma regulada y reconocida internacionalmente.',
    features: [
      'Forex', 'Índices', 'Oro y commodities',
      'Acciones CFD', 'Cripto CFDs', 'Ejecución rápida',
      'Broker regulado', 'Spreads competitivos',
    ],
    ctaPrimary: 'Ver broker recomendado',
    ctaSecondary: 'Abrir cuenta',
    url: IC_TRADING_URL,
    badge: 'Regulado',
    badgeColor: '#22c55e',
  },
];

const COMING_SOON = [
  { icon: '🖥️', label: 'VPS Trading',   desc: 'Servidores optimizados para EAs y bots' },
  { icon: '🤖', label: 'IA Tools',       desc: 'Análisis con inteligencia artificial' },
  { icon: '🏢', label: 'Prop Firms',     desc: 'Financiación para traders evaluados' },
  { icon: '📚', label: 'Formación',      desc: 'Cursos y comunidades verificadas' },
];

// ── Main component ─────────────────────────────────────────────────────────────

export default function ResourcesTab({ darkMode }) {
  const T = buildTheme(darkMode);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 700;

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: isMobile ? '20px 16px 48px' : '36px 32px 64px' }}>

      {/* ── Page header ── */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Recursos
          </span>
          <div style={{ flex: 1, height: 1, background: T.border }} />
        </div>
        <h1 style={{ margin: '0 0 8px', fontSize: isMobile ? 21 : 26, fontWeight: 800, color: T.txt, letterSpacing: '-0.4px' }}>
          Herramientas para Traders
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: T.sub, lineHeight: 1.65, maxWidth: 520 }}>
          Brokers, plataformas y recursos que hemos revisado y utilizamos. Ninguna recomendación sin haberla evaluado primero.
        </p>
      </div>

      {/* ── Featured broker ── */}
      {RESOURCES.filter(r => r.featured).map(r => (
        <FeaturedBrokerCard key={r.id} resource={r} darkMode={darkMode} T={T} />
      ))}

      {/* ── Coming soon grid ── */}
      <div style={{ marginTop: 44 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: T.sub, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Próximamente
          </span>
          <div style={{ flex: 1, height: 1, background: T.border }} />
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)',
          gap: 12,
        }}>
          {COMING_SOON.map(item => (
            <ComingSoonCard key={item.label} item={item} T={T} />
          ))}
        </div>
      </div>

      {/* ── Disclaimer ── */}
      <div style={{
        marginTop: 44, padding: '14px 18px', borderRadius: 10,
        background: T.card2, border: `1px solid ${T.border}`,
      }}>
        <p style={{ margin: 0, fontSize: 11, color: T.sub, lineHeight: 1.75 }}>
          <span style={{ fontWeight: 600 }}>Nota: </span>
          Algunos recursos pueden incluir enlaces de afiliado que ayudan a mantener y mejorar la plataforma sin coste adicional para el usuario. Solo recomendamos herramientas que hemos utilizado o evaluado directamente.
        </p>
      </div>
    </div>
  );
}

// ── IC Trading brand colors ────────────────────────────────────────────────────
const IC_GREEN = '#1FD458';

// ── Featured broker card ───────────────────────────────────────────────────────

function FeaturedBrokerCard({ resource: r, darkMode, T }) {
  return (
    <div style={{
      border: `1px solid ${T.border}`,
      borderRadius: 16,
      overflow: 'hidden',
      background: T.card,
      boxShadow: darkMode
        ? '0 8px 40px rgba(0,0,0,0.4)'
        : '0 4px 28px rgba(0,0,0,0.08)',
    }}>
      {/* IC Trading brand stripe — black + green */}
      <div style={{ height: 3, background: `linear-gradient(90deg, #000 0%, ${IC_GREEN} 100%)` }} />

      {/* Header band with logo */}
      <div style={{
        background: darkMode ? '#0a0f0a' : '#0d0d0d',
        padding: '20px 28px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${darkMode ? '#1a2a1a' : '#1a1a1a'}`,
      }}>
        {/* Logo — horizontal IC Trading logo on dark bg */}
        <img
          src="/ic-trading-logo.png"
          alt="IC Trading"
          style={{ height: 32, objectFit: 'contain', display: 'block' }}
          onError={e => {
            e.target.style.display = 'none';
            e.target.nextSibling.style.display = 'flex';
          }}
        />
        {/* CSS fallback if image missing */}
        <div style={{
          display: 'none', alignItems: 'center', gap: 6,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 7, background: '#000',
            border: `1px solid ${IC_GREEN}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <img
              src="/ic-trading-icon.png"
              alt=""
              style={{ width: 26, height: 26, objectFit: 'contain' }}
              onError={e => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = `<span style="font-size:14px;font-weight:900;color:${IC_GREEN};font-style:italic;letter-spacing:-0.5px">ic</span>`; }}
            />
          </div>
          <span style={{ fontSize: 16, fontWeight: 800, color: '#fff', letterSpacing: '-0.3px' }}>IC Trading</span>
        </div>

        {/* Badge */}
        <span style={{
          fontSize: 10, fontWeight: 700, color: IC_GREEN,
          background: `${IC_GREEN}18`, border: `1px solid ${IC_GREEN}40`,
          padding: '4px 12px', borderRadius: 99, letterSpacing: '0.05em',
          flexShrink: 0,
        }}>
          ✓ {r.badge}
        </span>
      </div>

      <div style={{ padding: '22px 28px 28px' }}>

        {/* Category label */}
        <div style={{ marginBottom: 14 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, color: T.accent,
            letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>
            {r.categoryLabel}
          </span>
        </div>

        {/* Tagline */}
        <p style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600, color: T.txt, lineHeight: 1.5 }}>
          {r.tagline}
        </p>

        {/* Divider */}
        <div style={{ height: 1, background: T.border, margin: '16px 0' }} />

        {/* Description */}
        <p style={{ margin: '0 0 20px', fontSize: 13, color: T.sub, lineHeight: 1.72 }}>
          {r.description}
        </p>

        {/* Feature chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 26 }}>
          {r.features.map(f => (
            <FeatureChip key={f} label={f} T={T} />
          ))}
        </div>

        {/* CTA buttons */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <CTAButton
            href={r.url}
            id="referalLink"
            label={`${r.ctaPrimary} →`}
            primary
            T={T}
          />
          <CTAButton
            href={r.url}
            label={r.ctaSecondary}
            T={T}
          />
        </div>

      </div>
    </div>
  );
}

// ── Feature chip ───────────────────────────────────────────────────────────────

function FeatureChip({ label, T }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, color: T.sub,
      background: T.card2, border: `1px solid ${T.border}`,
      padding: '4px 12px', borderRadius: 99,
    }}>
      {label}
    </span>
  );
}

// ── CTA button ─────────────────────────────────────────────────────────────────

function CTAButton({ href, id, label, primary, T }) {
  const [hovered, setHovered] = useState(false);

  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '11px 22px', borderRadius: 10, textDecoration: 'none',
    fontSize: 13, fontWeight: 700, flexShrink: 0, cursor: 'pointer',
    transition: 'all 0.15s',
  };

  const style = primary
    ? {
        ...base,
        background: hovered ? '#1d4ed8' : T.accent,
        color: 'white',
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
        boxShadow: hovered ? `0 4px 16px ${T.accent}55` : 'none',
      }
    : {
        ...base,
        background: hovered ? `${T.accent}12` : 'transparent',
        color: T.accent,
        border: `1px solid ${hovered ? T.accent : T.accent + '50'}`,
      };

  return (
    <a
      href={href}
      id={id}
      target="_blank"
      rel="noopener noreferrer"
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {label}
    </a>
  );
}

// ── Coming soon card ───────────────────────────────────────────────────────────

function ComingSoonCard({ item, T }) {
  return (
    <div style={{
      padding: '18px 14px 16px', borderRadius: 12, textAlign: 'center',
      background: T.card, border: `1px solid ${T.border}`, opacity: 0.65,
    }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>{item.icon}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.txt, marginBottom: 4 }}>{item.label}</div>
      <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.5, marginBottom: 10 }}>{item.desc}</div>
      <span style={{
        fontSize: 9, fontWeight: 700, color: T.sub,
        letterSpacing: '0.08em', textTransform: 'uppercase',
        background: T.card2, border: `1px solid ${T.border}`,
        padding: '2px 8px', borderRadius: 99,
      }}>
        Próximamente
      </span>
    </div>
  );
}
