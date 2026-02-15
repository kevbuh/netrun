/* Aether Design Tokens — single source of truth
   All design values live here. CSS vars, Tailwind, and JS consumers read from this. */

(function() {
  'use strict';

  const tokens = {

    // ─── Color: Semantic Surface Hierarchy ─────────────────
    color: {
      bg: {
        body:    '#0a0a0a',
        surface: '#151515',
        raised:  '#1e1e1e',
        sunken:  '#0d0d0d',
        overlay: '#181818',
        input:   '#1a1a1a',
      },
      text: {
        primary:    '#e0e0e0',
        secondary:  '#888',
        tertiary:   '#666',
        quaternary: '#555',
        inverse:    '#fff',
        link:       '#d4845a',
      },
      border: {
        default:  '#222',
        strong:   '#333',
        subtle:   '#252525',
        dim:      '#1a1a1a',
      },
      accent: {
        default: '#b4451a',
        hover:   '#c9562a',
      },
      shadow: {
        card:    'rgba(0,0,0,0.3)',
        popup:   'rgba(0,0,0,0.5)',
        overlay: 'rgba(0,0,0,0.5)',
      },
      feedback: {
        tooltip:       '#222',
        tooltipBorder: '#333',
      },
    },

    // ─── Typography (Apple SF-inspired scale) ──────────────
    typography: {
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif",
      fontMono:   "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, Consolas, monospace",
      scale: {
        largeTitle: { size: '2.125rem', weight: 700, lineHeight: 1.1, tracking: '-0.02em' },
        title1:     { size: '1.75rem',  weight: 700, lineHeight: 1.15, tracking: '-0.018em' },
        title2:     { size: '1.375rem', weight: 600, lineHeight: 1.2, tracking: '-0.015em' },
        title3:     { size: '1.125rem', weight: 600, lineHeight: 1.25, tracking: '-0.01em' },
        headline:   { size: '1rem',     weight: 600, lineHeight: 1.3, tracking: '-0.005em' },
        body:       { size: '0.9375rem', weight: 400, lineHeight: 1.5, tracking: '0' },
        callout:    { size: '0.875rem', weight: 400, lineHeight: 1.45, tracking: '0' },
        subhead:    { size: '0.8125rem', weight: 400, lineHeight: 1.4, tracking: '0.005em' },
        footnote:   { size: '0.75rem',  weight: 400, lineHeight: 1.35, tracking: '0.01em' },
        caption1:   { size: '0.6875rem', weight: 500, lineHeight: 1.3, tracking: '0.015em' },
        caption2:   { size: '0.625rem', weight: 500, lineHeight: 1.25, tracking: '0.02em' },
      }
    },

    // ─── Spacing (4px base grid) ───────────────────────────
    space: {
      0:  '0',
      1:  '4px',
      2:  '8px',
      3:  '12px',
      4:  '16px',
      5:  '20px',
      6:  '24px',
      8:  '32px',
      10: '40px',
      12: '48px',
      16: '64px',
      20: '80px',
    },

    // ─── Radii ─────────────────────────────────────────────
    radius: {
      xs:   '4px',
      sm:   '6px',
      md:   '8px',
      lg:   '12px',
      xl:   '16px',
      '2xl': '20px',
      full: '9999px',
    },

    // ─── Motion (mirrors motion.js tokens) ─────────────────
    motion: {
      spring: {
        snappy:  { tension: 300, friction: 20, mass: 1 },
        smooth:  { tension: 170, friction: 26, mass: 1 },
        gentle:  { tension: 120, friction: 14, mass: 1 },
        bouncy:  { tension: 200, friction: 10, mass: 1 },
      },
      duration: {
        instant: 100,
        fast:    200,
        normal:  350,
        slow:    600,
      },
      stagger: {
        tight:   20,
        normal:  40,
        relaxed: 80,
      },
      easing: {
        snappy:     'cubic-bezier(0.34, 1.56, 0.64, 1)',
        smooth:     'cubic-bezier(0.25, 1.0, 0.5, 1.0)',
        gentle:     'cubic-bezier(0.22, 1.2, 0.36, 1.0)',
        bouncy:     'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        'ease-out': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },

    // ─── Materials (vibrancy/translucency tiers) ───────────
    materials: {
      ultraThin: { blur: 4,  saturation: 110, opacity: 0.3 },
      thin:      { blur: 8,  saturation: 120, opacity: 0.4 },
      regular:   { blur: 16, saturation: 140, opacity: 0.55 },
      thick:     { blur: 24, saturation: 160, opacity: 0.7 },
      chrome:    { blur: 32, saturation: 180, opacity: 0.85 },
    },

    // ─── Z-Index Scale ─────────────────────────────────────
    z: {
      base:    0,
      raised:  10,
      sticky:  100,
      overlay: 1000,
      modal:   5000,
      toast:   8000,
      pill:    9999,
      max:     10002,
    },
  };

  // ─── Dot-path lookup helper ──────────────────────────────
  function tokenGet(path) {
    var parts = path.split('.');
    var value = tokens;
    for (var i = 0; i < parts.length; i++) {
      if (value == null) return undefined;
      value = value[parts[i]];
    }
    return value;
  }

  window.AetherTokens = tokens;
  window.AetherTokens.get = tokenGet;

})();
