// urlbar-instant.js — Instant answers engine: math, color, conversion, timezone, weather, sports, stocks
import { icon } from '/js/core/icons.js';
import { escapeHtml } from '/js/core/core-utils.js';
import { apiGet } from '/js/api.js';

// ── Instant answer state ──
export let _instantAnswer = null; // { type, html } for non-definition instant answers
export let _instantDebounce = null;
export const _instantCache = {};

// ── Main dispatcher ──

export function _computeInstantAnswer(query) {
  if (!query) { _instantAnswer = null; return; }

  // 1. Math expressions — detect and evaluate synchronously
  const mathResult = _tryMathAnswer(query);
  if (mathResult) { _instantAnswer = mathResult; return; }

  // 2. Color preview — hex or rgb
  const colorResult = _tryColorAnswer(query);
  if (colorResult) { _instantAnswer = colorResult; return; }

  // 3. Unit conversion
  const convResult = _tryConversionAnswer(query);
  if (convResult) { _instantAnswer = convResult; return; }

  // 4. Timezone / world clock
  const tzResult = _tryTimezoneAnswer(query);
  if (tzResult) { _instantAnswer = tzResult; return; }

  // 5. Async answers (weather, sports, stocks) — debounced
  const weatherMatch = query.match(/^weather\s+(.+)$/i);
  const sportsMatch = _matchSportsQuery(query);
  const stockMatch = query.match(/^\$([A-Za-z]{1,5})$/) || query.match(/^([A-Za-z]{1,5})\s+stock$/i);

  if (weatherMatch || sportsMatch || stockMatch) {
    const cacheKey = query.toLowerCase();
    if (_instantCache[cacheKey]) {
      _instantAnswer = _instantCache[cacheKey];
      return;
    }
    // Keep previous instant answer while loading (don't flash)
    if (_instantDebounce) clearTimeout(_instantDebounce);
    _instantDebounce = setTimeout(async () => {
      let result = null;
      try {
        if (weatherMatch) result = await _fetchWeatherAnswer(weatherMatch[1].trim());
        else if (sportsMatch) result = await _fetchSportsAnswer(sportsMatch);
        else if (stockMatch) result = await _fetchStockAnswer(stockMatch[1].toUpperCase());
      } catch {}
      if (result) {
        _instantCache[cacheKey] = result;
        _instantAnswer = result;
      } else {
        _instantAnswer = null;
      }
      const { input } = window._getOmniInput();
      if (input && input.value.trim().toLowerCase() === query.toLowerCase()) {
        window._browseUrlShowHistory();
      }
    }, 300);
    return;
  }

  _instantAnswer = null;
}

// ── Math ──
export function _tryMathAnswer(q) {
  // Only match math-like patterns
  if (!/[\d]/.test(q)) return null;
  if (/[a-zA-Z]{3,}/.test(q) && !/^(sqrt|cbrt|abs|log|ln|sin|cos|tan|pi|e|ceil|floor|round|pow|min|max)/i.test(q.replace(/[^a-zA-Z]/g, ''))) return null;
  // Sanitize: only allow digits, operators, parens, spaces, dots, and math functions
  const sanitized = q.replace(/\s/g, '')
    .replace(/×/g, '*').replace(/÷/g, '/').replace(/\^/g, '**')
    .replace(/%\s*of\s*/i, '/100*');
  if (!/^[\d+\-*/().%,\s^eπ]*$/.test(sanitized) && !/^[\d+\-*/().\s]*(?:sqrt|cbrt|abs|log|ln|sin|cos|tan|pi|ceil|floor|round|pow|min|max)[\d+\-*/().\s]*$/i.test(sanitized)) return null;
  try {
    const expr = sanitized
      .replace(/\bpi\b/gi, 'Math.PI').replace(/\be\b/g, 'Math.E')
      .replace(/\bsqrt\(/gi, 'Math.sqrt(').replace(/\bcbrt\(/gi, 'Math.cbrt(')
      .replace(/\babs\(/gi, 'Math.abs(').replace(/\blog\(/gi, 'Math.log10(')
      .replace(/\bln\(/gi, 'Math.log(').replace(/\bsin\(/gi, 'Math.sin(')
      .replace(/\bcos\(/gi, 'Math.cos(').replace(/\btan\(/gi, 'Math.tan(')
      .replace(/\bceil\(/gi, 'Math.ceil(').replace(/\bfloor\(/gi, 'Math.floor(')
      .replace(/\bround\(/gi, 'Math.round(').replace(/\bpow\(/gi, 'Math.pow(')
      .replace(/\bmin\(/gi, 'Math.min(').replace(/\bmax\(/gi, 'Math.max(');
    // Safety check: no identifiers besides Math
    if (/[a-zA-Z_$]/.test(expr.replace(/Math\.[a-zA-Z]+/g, '').replace(/[eE][+-]?\d/g, ''))) return null;
    const result = Function('"use strict"; return (' + expr + ')')();
    if (typeof result !== 'number' || !isFinite(result)) return null;
    // Don't show if result equals input (e.g. just a number)
    if (String(result) === sanitized || String(result) === q.trim()) return null;
    const formatted = Number.isInteger(result) ? result.toLocaleString() : parseFloat(result.toPrecision(10)).toLocaleString(undefined, { maximumFractionDigits: 10 });
    return { type: 'math', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);display:flex;align-items:center;gap:10px;">
      ${icon('hashtag', {size: 16, stroke: 'var(--nr-accent)'})}
      <div><span style="font-size:0.8rem;color:var(--nr-text-secondary);">${escapeHtml(q)} =</span> <span style="font-size:1.05rem;font-weight:700;color:var(--nr-text-primary);">${escapeHtml(formatted)}</span></div>
    </div>` };
  } catch { return null; }
}

// ── Color ──
export function _tryColorAnswer(q) {
  let color = null, label = q;
  const hexMatch = q.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    color = '#' + hex;
    label = '#' + hex.toUpperCase();
  }
  const rgbMatch = q.match(/^rgb[a]?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rgbMatch) {
    color = `rgb(${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]})`;
    label = color;
  }
  const hslMatch = q.match(/^hsl[a]?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})%?\s*,\s*(\d{1,3})%?/i);
  if (hslMatch) {
    color = `hsl(${hslMatch[1]},${hslMatch[2]}%,${hslMatch[3]}%)`;
    label = color;
  }
  if (!color) return null;
  return { type: 'color', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);display:flex;align-items:center;gap:12px;">
    <div style="width:36px;height:36px;border-radius:8px;background:${color};border:1px solid var(--nr-border-default);flex-shrink:0;"></div>
    <div><div style="font-size:0.95rem;font-weight:600;color:var(--nr-text-primary);">${escapeHtml(label)}</div>
    <div style="font-size:0.72rem;color:var(--nr-text-secondary);">Color preview</div></div>
  </div>` };
}

// ── Unit Conversion ──
export function _tryConversionAnswer(q) {
  const m = q.match(/^([\d.,]+)\s*([a-zA-Z°℃℉]+)\s+(?:to|in|as|=)\s+([a-zA-Z°℃℉]+)$/i);
  if (!m) return null;
  const val = parseFloat(m[1].replace(/,/g, ''));
  if (isNaN(val)) return null;
  const from = m[2].toLowerCase(), to = m[3].toLowerCase();
  const conversions = {
    'km_mi': v => v * 0.621371, 'mi_km': v => v * 1.60934,
    'km_m': v => v * 1000, 'm_km': v => v / 1000,
    'm_ft': v => v * 3.28084, 'ft_m': v => v / 3.28084,
    'mi_ft': v => v * 5280, 'ft_mi': v => v / 5280,
    'cm_in': v => v / 2.54, 'in_cm': v => v * 2.54,
    'mm_in': v => v / 25.4, 'in_mm': v => v * 25.4,
    'kg_lb': v => v * 2.20462, 'lb_kg': v => v / 2.20462,
    'kg_lbs': v => v * 2.20462, 'lbs_kg': v => v / 2.20462,
    'g_oz': v => v / 28.3495, 'oz_g': v => v * 28.3495,
    'l_gal': v => v * 0.264172, 'gal_l': v => v / 0.264172,
    'ml_oz': v => v / 29.5735, 'oz_ml': v => v * 29.5735,
    'c_f': v => v * 9/5 + 32, 'f_c': v => (v - 32) * 5/9,
    '°c_°f': v => v * 9/5 + 32, '°f_°c': v => (v - 32) * 5/9,
    'celsius_fahrenheit': v => v * 9/5 + 32, 'fahrenheit_celsius': v => (v - 32) * 5/9,
    '℃_℉': v => v * 9/5 + 32, '℉_℃': v => (v - 32) * 5/9,
    'mph_kph': v => v * 1.60934, 'kph_mph': v => v / 1.60934,
    'mph_kmh': v => v * 1.60934, 'kmh_mph': v => v / 1.60934,
    'yd_m': v => v * 0.9144, 'm_yd': v => v / 0.9144,
  };
  const key = from + '_' + to;
  const fn = conversions[key];
  if (!fn) return null;
  const result = fn(val);
  const formatted = parseFloat(result.toPrecision(6)).toLocaleString(undefined, { maximumFractionDigits: 6 });
  return { type: 'conversion', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);display:flex;align-items:center;gap:10px;">
    ${icon('repost', {size: 16, stroke: 'var(--nr-accent)'})}
    <div><span style="font-size:0.8rem;color:var(--nr-text-secondary);">${escapeHtml(m[1])} ${escapeHtml(m[2])} =</span> <span style="font-size:1.05rem;font-weight:700;color:var(--nr-text-primary);">${escapeHtml(formatted)} ${escapeHtml(m[3])}</span></div>
  </div>` };
}

// ── Timezone ──
export const _tzCityMap = {
  'tokyo': 'Asia/Tokyo', 'london': 'Europe/London', 'paris': 'Europe/Paris',
  'new york': 'America/New_York', 'nyc': 'America/New_York', 'ny': 'America/New_York',
  'los angeles': 'America/Los_Angeles', 'la': 'America/Los_Angeles',
  'chicago': 'America/Chicago', 'denver': 'America/Denver',
  'sydney': 'Australia/Sydney', 'melbourne': 'Australia/Melbourne',
  'berlin': 'Europe/Berlin', 'amsterdam': 'Europe/Amsterdam',
  'dubai': 'Asia/Dubai', 'singapore': 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong', 'seoul': 'Asia/Seoul',
  'mumbai': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata', 'india': 'Asia/Kolkata',
  'beijing': 'Asia/Shanghai', 'shanghai': 'Asia/Shanghai', 'china': 'Asia/Shanghai',
  'moscow': 'Europe/Moscow', 'toronto': 'America/Toronto',
  'vancouver': 'America/Vancouver', 'sf': 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles', 'seattle': 'America/Los_Angeles',
  'austin': 'America/Chicago', 'boston': 'America/New_York',
  'miami': 'America/New_York', 'atlanta': 'America/New_York',
  'hawaii': 'Pacific/Honolulu', 'honolulu': 'Pacific/Honolulu',
  'alaska': 'America/Anchorage', 'bangkok': 'Asia/Bangkok',
  'istanbul': 'Europe/Istanbul', 'cairo': 'Africa/Cairo',
  'rome': 'Europe/Rome', 'madrid': 'Europe/Madrid',
  'lisbon': 'Europe/Lisbon', 'dublin': 'Europe/Dublin',
  'zurich': 'Europe/Zurich', 'stockholm': 'Europe/Stockholm',
  'oslo': 'Europe/Oslo', 'helsinki': 'Europe/Helsinki',
  'warsaw': 'Europe/Warsaw', 'prague': 'Europe/Prague',
  'vienna': 'Europe/Vienna', 'budapest': 'Europe/Budapest',
  'taipei': 'Asia/Taipei', 'jakarta': 'Asia/Jakarta',
  'mexico city': 'America/Mexico_City', 'sao paulo': 'America/Sao_Paulo',
  'buenos aires': 'America/Argentina/Buenos_Aires',
  'johannesburg': 'Africa/Johannesburg', 'nairobi': 'Africa/Nairobi',
  'auckland': 'Pacific/Auckland',
};

export function _tryTimezoneAnswer(q) {
  const m = q.match(/^(?:time\s+in|what\s+time\s+(?:is\s+it\s+)?in)\s+(.+)$/i);
  if (!m) return null;
  const city = m[1].trim().toLowerCase();
  const tz = _tzCityMap[city];
  if (!tz) return null;
  try {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    const date = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
    const offset = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value || '';
    return { type: 'timezone', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);display:flex;align-items:center;gap:10px;">
      ${icon('clock', {size: 16, stroke: 'var(--nr-accent)'})}
      <div><div style="display:flex;align-items:baseline;gap:8px;"><span style="font-size:1.05rem;font-weight:700;color:var(--nr-text-primary);">${escapeHtml(time)}</span><span style="font-size:0.75rem;color:var(--nr-text-secondary);">${escapeHtml(date)}</span></div>
      <div style="font-size:0.72rem;color:var(--nr-text-secondary);">${escapeHtml(m[1].trim())} · ${escapeHtml(offset)}</div></div>
    </div>` };
  } catch { return null; }
}

// ── Weather (async) ──
export async function _fetchWeatherAnswer(city) {
  // External API - keep raw fetch
  const resp = await fetch('https://wttr.in/' + encodeURIComponent(city) + '?format=j1', { signal: AbortSignal.timeout(4000) });
  if (!resp.ok) return null;
  const data = await resp.json();
  const cur = data.current_condition?.[0];
  if (!cur) return null;
  const temp = cur.temp_C;
  const tempF = cur.temp_F;
  const desc = cur.weatherDesc?.[0]?.value || '';
  const feelsC = cur.FeelsLikeC;
  const humidity = cur.humidity;
  const wind = cur.windspeedKmph;
  const emoji = _weatherEmoji(desc);
  return { type: 'weather', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);display:flex;align-items:center;gap:12px;">
    <span style="font-size:1.6rem;">${emoji}</span>
    <div style="flex:1;">
      <div style="display:flex;align-items:baseline;gap:8px;"><span style="font-size:1.1rem;font-weight:700;color:var(--nr-text-primary);">${escapeHtml(temp)}°C</span><span style="font-size:0.82rem;color:var(--nr-text-secondary);">${escapeHtml(tempF)}°F</span></div>
      <div style="font-size:0.78rem;color:var(--nr-text-secondary);">${escapeHtml(desc)}</div>
      <div style="font-size:0.7rem;color:var(--nr-text-quaternary);margin-top:2px;">Feels ${escapeHtml(feelsC)}°C · Humidity ${escapeHtml(humidity)}% · Wind ${escapeHtml(wind)} km/h</div>
    </div>
    <div style="font-size:0.72rem;color:var(--nr-text-secondary);text-align:right;">${escapeHtml(city)}</div>
  </div>` };
}

export function _weatherEmoji(desc) {
  const d = (desc || '').toLowerCase();
  if (d.includes('sunny') || d.includes('clear')) return '☀️';
  if (d.includes('partly cloudy')) return '⛅';
  if (d.includes('cloud') || d.includes('overcast')) return '☁️';
  if (d.includes('rain') || d.includes('drizzle')) return '🌧️';
  if (d.includes('thunder') || d.includes('storm')) return '⛈️';
  if (d.includes('snow') || d.includes('blizzard')) return '🌨️';
  if (d.includes('fog') || d.includes('mist')) return '🌫️';
  if (d.includes('wind')) return '💨';
  return '🌤️';
}

// ── Sports ──
export const _sportsLeagues = {
  'nba': 'basketball', 'nfl': 'football', 'mlb': 'baseball', 'nhl': 'hockey',
  'premier league': 'soccer', 'epl': 'soccer', 'la liga': 'soccer',
  'bundesliga': 'soccer', 'serie a': 'soccer', 'ligue 1': 'soccer',
  'champions league': 'soccer', 'mls': 'soccer', 'ucl': 'soccer',
};
export const _sportsTeams = {
  'lakers': 'nba', 'celtics': 'nba', 'warriors': 'nba', 'bulls': 'nba', 'nets': 'nba',
  'knicks': 'nba', 'heat': 'nba', 'bucks': 'nba', 'suns': 'nba', 'nuggets': 'nba',
  'mavericks': 'nba', 'mavs': 'nba', 'clippers': 'nba', 'rockets': 'nba',
  'sixers': 'nba', '76ers': 'nba', 'raptors': 'nba', 'spurs': 'nba', 'thunder': 'nba',
  'timberwolves': 'nba', 'wolves': 'nba', 'grizzlies': 'nba', 'pelicans': 'nba',
  'chiefs': 'nfl', 'eagles': 'nfl', '49ers': 'nfl', 'cowboys': 'nfl', 'bills': 'nfl',
  'ravens': 'nfl', 'dolphins': 'nfl', 'lions': 'nfl', 'packers': 'nfl', 'jets': 'nfl',
  'patriots': 'nfl', 'steelers': 'nfl', 'bears': 'nfl', 'chargers': 'nfl',
  'yankees': 'mlb', 'dodgers': 'mlb', 'red sox': 'mlb', 'cubs': 'mlb', 'mets': 'mlb',
  'astros': 'mlb', 'braves': 'mlb', 'phillies': 'mlb', 'padres': 'mlb',
  'arsenal': 'epl', 'chelsea': 'epl', 'liverpool': 'epl', 'man city': 'epl',
  'manchester city': 'epl', 'man united': 'epl', 'manchester united': 'epl',
  'tottenham': 'epl', 'spurs fc': 'epl', 'barcelona': 'la liga', 'real madrid': 'la liga',
  'bayern': 'bundesliga', 'bayern munich': 'bundesliga', 'psg': 'ligue 1',
  'juventus': 'serie a', 'inter milan': 'serie a', 'ac milan': 'serie a',
};

export function _matchSportsQuery(q) {
  const lower = q.toLowerCase().trim();
  if (_sportsLeagues[lower]) return { type: 'league', key: lower };
  // Check for "X score" or "X game"
  const scoreMatch = lower.match(/^(.+?)\s+(?:score|game|scores|games|schedule|results?)$/);
  const teamName = scoreMatch ? scoreMatch[1] : lower;
  if (_sportsTeams[teamName]) return { type: 'team', key: teamName, league: _sportsTeams[teamName] };
  if (_sportsLeagues[teamName]) return { type: 'league', key: teamName };
  return null;
}

export async function _fetchSportsAnswer(match) {
  // Use ESPN's public API for scores
  const leagueMap = {
    'nba': 'basketball/nba', 'nfl': 'football/nfl', 'mlb': 'baseball/mlb', 'nhl': 'hockey/nhl',
    'premier league': 'soccer/eng.1', 'epl': 'soccer/eng.1', 'la liga': 'soccer/esp.1',
    'bundesliga': 'soccer/ger.1', 'serie a': 'soccer/ita.1', 'ligue 1': 'soccer/fra.1',
    'champions league': 'soccer/uefa.champions', 'ucl': 'soccer/uefa.champions',
    'mls': 'soccer/usa.1',
  };
  const league = match.type === 'league' ? match.key : match.league;
  const espnPath = leagueMap[league];
  if (!espnPath) return null;

  // External API - keep raw fetch
  const resp = await fetch('https://site.api.espn.com/apis/site/v2/sports/' + espnPath + '/scoreboard', { signal: AbortSignal.timeout(4000) });
  if (!resp.ok) return null;
  const data = await resp.json();
  let events = data.events || [];
  if (!events.length) return null;

  // Filter by team if searching for a specific team
  if (match.type === 'team') {
    const teamLower = match.key.toLowerCase();
    events = events.filter(ev => {
      const names = (ev.name || '').toLowerCase() + ' ' + (ev.shortName || '').toLowerCase();
      return names.includes(teamLower);
    });
    if (!events.length) return null;
  }

  // Show up to 4 games
  const games = events.slice(0, 4);
  let html = '<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);">';
  html += '<div style="font-size:0.65rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">' + escapeHtml(league.toUpperCase()) + ' Scores</div>';
  for (const ev of games) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const teams = comp.competitors || [];
    if (teams.length < 2) continue;
    const away = teams.find(t => t.homeAway === 'away') || teams[1];
    const home = teams.find(t => t.homeAway === 'home') || teams[0];
    const status = ev.status?.type?.shortDetail || '';
    const isLive = ev.status?.type?.state === 'in';
    html += `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:0.8rem;">`;
    html += `<div style="flex:1;display:flex;align-items:center;gap:6px;min-width:0;">`;
    if (away.team?.logo) html += `<img src="${escapeHtml(away.team.logo)}" style="width:16px;height:16px;flex-shrink:0;" onerror="this.style.display='none'">`;
    html += `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--nr-text-primary);${away.winner ? 'font-weight:700;' : ''}">${escapeHtml(away.team?.abbreviation || away.team?.shortDisplayName || '?')}</span>`;
    html += `<span style="font-weight:700;color:var(--nr-text-primary);min-width:18px;text-align:center;">${escapeHtml(away.score || '-')}</span>`;
    html += `</div>`;
    html += `<span style="color:var(--nr-text-quaternary);font-size:0.7rem;">@</span>`;
    html += `<div style="flex:1;display:flex;align-items:center;gap:6px;min-width:0;">`;
    html += `<span style="font-weight:700;color:var(--nr-text-primary);min-width:18px;text-align:center;">${escapeHtml(home.score || '-')}</span>`;
    if (home.team?.logo) html += `<img src="${escapeHtml(home.team.logo)}" style="width:16px;height:16px;flex-shrink:0;" onerror="this.style.display='none'">`;
    html += `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--nr-text-primary);${home.winner ? 'font-weight:700;' : ''}">${escapeHtml(home.team?.abbreviation || home.team?.shortDisplayName || '?')}</span>`;
    html += `</div>`;
    html += `<span style="font-size:0.68rem;color:${isLive ? 'var(--nr-accent)' : 'var(--nr-text-quaternary)'};white-space:nowrap;flex-shrink:0;min-width:50px;text-align:right;${isLive ? 'font-weight:600;' : ''}">${escapeHtml(status)}</span>`;
    html += `</div>`;
  }
  if (events.length > 4) html += `<div style="font-size:0.7rem;color:var(--nr-text-quaternary);padding-top:4px;">+${events.length - 4} more games</div>`;
  html += '</div>';
  return { type: 'sports', html };
}

// ── Stocks ──
export async function _fetchStockAnswer(ticker) {
  const data = await apiGet('/api/stock-quote?symbol=' + encodeURIComponent(ticker));
  if (!data.price && data.price !== 0) return null;
  const price = data.price;
  const change = data.change || 0;
  const changePct = data.changePercent || 0;
  const name = data.name || ticker;
  const isUp = change >= 0;
  const arrow = isUp ? '▲' : '▼';
  const color = isUp ? '#22c55e' : '#ef4444';
  return { type: 'stock', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);display:flex;align-items:center;gap:10px;">
    ${icon('trendingUp', {size: 16, stroke: 'var(--nr-accent)'})}
    <div style="flex:1;">
      <div style="display:flex;align-items:baseline;gap:8px;">
        <span style="font-size:0.82rem;font-weight:700;color:var(--nr-text-primary);">${escapeHtml(ticker)}</span>
        <span style="font-size:0.72rem;color:var(--nr-text-secondary);">${escapeHtml(name)}</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:8px;margin-top:2px;">
        <span style="font-size:1.05rem;font-weight:700;color:var(--nr-text-primary);">$${parseFloat(price).toFixed(2)}</span>
        <span style="font-size:0.78rem;font-weight:600;color:${color};">${arrow} ${Math.abs(change).toFixed(2)} (${Math.abs(changePct).toFixed(2)}%)</span>
      </div>
    </div>
  </div>` };
}
