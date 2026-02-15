// ── Quote snapping (ported from Python _snap_quote_to_text) ──

export function snapQuoteToText(quote: string, text: string): string | null {
  if (!quote || !text) return null;
  const textLower = text.toLowerCase();
  const quoteLower = quote.toLowerCase();

  // Exact match
  const idx = textLower.indexOf(quoteLower);
  if (idx !== -1) return text.slice(idx, idx + quote.length);

  // Progressive prefix trimming
  const quoteWords = quoteLower.split(/\s+/);
  if (quoteWords.length < 3) return null;

  for (let trim = 0; trim < Math.min(Math.floor(quoteWords.length / 2), 8); trim++) {
    const end = quoteWords.length - trim;
    const partial = quoteWords.slice(0, end).join(' ');
    const pIdx = textLower.indexOf(partial);
    if (pIdx !== -1) {
      const grabLen = Math.min(quote.length + 20, text.length - pIdx);
      const candidate = text.slice(pIdx, pIdx + grabLen);
      const words = candidate.split(/\s+/);
      const targetWords = quote.split(/\s+/).length;
      const snapped = words.slice(0, targetWords).join(' ');
      return snapped.length >= 15 ? snapped : null;
    }
  }

  // Bigram sliding window
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const qBigrams = bigrams(quoteLower);
  if (qBigrams.size === 0) return null;

  let bestScore = 0;
  let bestStart = -1;
  const window = quote.length;
  const step = Math.max(1, Math.floor(window / 4));

  for (let start = 0; start <= textLower.length - window; start += step) {
    const candidate = textLower.slice(start, start + window);
    const cBigrams = bigrams(candidate);
    const intersection = [...qBigrams].filter(b => cBigrams.has(b)).length;
    const union = new Set([...qBigrams, ...cBigrams]).size;
    const score = union > 0 ? intersection / union : 0;
    if (score > bestScore) { bestScore = score; bestStart = start; }
  }

  // Refine
  if (bestStart >= 0 && bestScore > 0.4) {
    const searchStart = Math.max(0, bestStart - step);
    const searchEnd = Math.min(textLower.length - window + 1, bestStart + step + 1);
    for (let start = searchStart; start < searchEnd; start++) {
      const candidate = textLower.slice(start, start + window);
      const cBigrams = bigrams(candidate);
      const intersection = [...qBigrams].filter(b => cBigrams.has(b)).length;
      const union = new Set([...qBigrams, ...cBigrams]).size;
      const score = union > 0 ? intersection / union : 0;
      if (score > bestScore) { bestScore = score; bestStart = start; }
    }
  }

  if (bestScore >= 0.55 && bestStart >= 0) {
    while (bestStart > 0 && !' \t\n'.includes(text[bestStart - 1])) bestStart--;
    let end = bestStart + window;
    while (end < text.length && !' \t\n'.includes(text[end])) end++;
    const snapped = text.slice(bestStart, end).trim();
    return snapped.length >= 15 ? snapped : null;
  }

  return null;
}
