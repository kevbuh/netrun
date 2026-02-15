// ── Quote snapping (ported from Python _snap_quote_to_text) ──

/** Collapse runs of whitespace to single spaces and trim */
function normalizeWS(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function snapQuoteToText(quote: string, text: string): string | null {
  if (!quote || !text) return null;
  const textLower = text.toLowerCase();
  const quoteLower = quote.toLowerCase();

  // Exact match
  const idx = textLower.indexOf(quoteLower);
  if (idx !== -1) return text.slice(idx, idx + quote.length);

  // Whitespace-normalized exact match
  const normText = normalizeWS(text);
  const normTextLower = normText.toLowerCase();
  const normQuote = normalizeWS(quote);
  const normQuoteLower = normQuote.toLowerCase();
  const normIdx = normTextLower.indexOf(normQuoteLower);
  if (normIdx !== -1) {
    // Map back to original text by finding the approximate region
    // Use a sliding window on the original text to find the best match
    const targetLen = normQuote.length;
    const searchStart = Math.max(0, Math.floor(normIdx * text.length / normText.length) - targetLen);
    const searchEnd = Math.min(text.length, searchStart + targetLen * 3);
    const region = text.slice(searchStart, searchEnd);
    const regionLower = region.toLowerCase();
    // Try to find the normalized quote in this region with whitespace flexibility
    const normRegion = normalizeWS(region);
    const normRegionLower = normRegion.toLowerCase();
    const rIdx = normRegionLower.indexOf(normQuoteLower);
    if (rIdx !== -1) {
      // Walk the original region to find corresponding span
      let origStart = -1, origEnd = -1, normPos = 0;
      for (let i = 0; i < region.length; i++) {
        if (/\s/.test(region[i]) && (i === 0 || /\s/.test(region[i - 1]))) continue;
        if (normPos === rIdx && origStart === -1) origStart = i;
        if (/\s/.test(region[i])) normPos++;
        else normPos++;
        if (normPos === rIdx + normQuote.length && origEnd === -1) {
          origEnd = i + 1;
          break;
        }
      }
      if (origStart >= 0 && origEnd > origStart) {
        const snapped = region.slice(origStart, origEnd).trim();
        if (snapped.length >= 15) return snapped;
      }
    }
  }

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

  // Word-level contiguous subsequence matching
  const textWords = textLower.split(/\s+/);
  const qWords = normQuoteLower.split(/\s+/);
  if (qWords.length >= 3) {
    let bestRun = 0, bestRunStart = -1;
    for (let ti = 0; ti <= textWords.length - 3; ti++) {
      let run = 0;
      for (let qi = 0; qi < qWords.length && ti + run < textWords.length; qi++) {
        if (textWords[ti + run] === qWords[qi]) {
          run++;
        }
      }
      if (run > bestRun) {
        bestRun = run;
        bestRunStart = ti;
      }
    }
    const matchRatio = bestRun / qWords.length;
    if (matchRatio >= 0.6 && bestRunStart >= 0) {
      // Reconstruct from original text by finding the word positions
      const origWords = text.split(/\s+/);
      const snapped = origWords.slice(bestRunStart, bestRunStart + bestRun).join(' ');
      if (snapped.length >= 15) return snapped;
    }
  }

  // Bigram + word-overlap sliding window
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const wordSet = (s: string): Set<string> => new Set(s.split(/\s+/).filter(w => w.length > 0));

  const qBigrams = bigrams(quoteLower);
  const qWordSet = wordSet(quoteLower);
  if (qBigrams.size === 0) return null;

  let bestScore = 0;
  let bestStart = -1;
  const window = quote.length;
  const step = Math.max(1, Math.floor(window / 6)); // finer step for better scanning

  for (let start = 0; start <= textLower.length - window; start += step) {
    const candidate = textLower.slice(start, start + window);
    const cBigrams = bigrams(candidate);
    const intersection = [...qBigrams].filter(b => cBigrams.has(b)).length;
    const union = new Set([...qBigrams, ...cBigrams]).size;
    const bigramScore = union > 0 ? intersection / union : 0;

    // Word overlap (Jaccard)
    const cWordSet = wordSet(candidate);
    const wordIntersection = [...qWordSet].filter(w => cWordSet.has(w)).length;
    const wordUnion = new Set([...qWordSet, ...cWordSet]).size;
    const wordScore = wordUnion > 0 ? wordIntersection / wordUnion : 0;

    // Combined score: weighted average
    const score = bigramScore * 0.6 + wordScore * 0.4;
    if (score > bestScore) { bestScore = score; bestStart = start; }
  }

  // Refine
  if (bestStart >= 0 && bestScore > 0.35) {
    const searchStart = Math.max(0, bestStart - step);
    const searchEnd = Math.min(textLower.length - window + 1, bestStart + step + 1);
    for (let start = searchStart; start < searchEnd; start++) {
      const candidate = textLower.slice(start, start + window);
      const cBigrams = bigrams(candidate);
      const intersection = [...qBigrams].filter(b => cBigrams.has(b)).length;
      const union = new Set([...qBigrams, ...cBigrams]).size;
      const bigramScore = union > 0 ? intersection / union : 0;

      const cWordSet = wordSet(candidate);
      const wordIntersection = [...qWordSet].filter(w => cWordSet.has(w)).length;
      const wordUnion = new Set([...qWordSet, ...cWordSet]).size;
      const wordScore = wordUnion > 0 ? wordIntersection / wordUnion : 0;

      const score = bigramScore * 0.6 + wordScore * 0.4;
      if (score > bestScore) { bestScore = score; bestStart = start; }
    }
  }

  if (bestScore >= 0.45 && bestStart >= 0) {
    while (bestStart > 0 && !' \t\n'.includes(text[bestStart - 1])) bestStart--;
    let end = bestStart + window;
    while (end < text.length && !' \t\n'.includes(text[end])) end++;
    const snapped = text.slice(bestStart, end).trim();
    return snapped.length >= 15 ? snapped : null;
  }

  return null;
}
