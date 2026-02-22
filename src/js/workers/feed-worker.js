// feed-worker.js — Web Worker for feed scoring/filtering/sorting pipeline
// Receives allPapers + userState snapshot, returns sorted/filtered indices + scores

const _STOP_WORDS = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','it','that','this','are','was','were','be','been','has','have','had','not','no','do','does','did','will','would','can','could','should','may','might','shall','into','as','if','its','than','so','very','just','about','also','more','other','some','only','over','such','after','before','between','each','all','both','through','during','up','out','then','them','these','those','own','same','how','our','new','using','via','based','we','i','you','he','she','they','what','which','who','when','where','why','how','two','one','three','first','second','third','most','many','any','few','large','small','high','low','long','short','old']);

function _normalizeRatingKey(link) {
  var k = link;
  try {
    var u = new URL(k);
    if (u.hostname.includes('arxiv.org')) {
      u.protocol = 'https:';
      u.pathname = u.pathname.replace(/(\/abs\/[\d.]+)v\d+$/, '$1');
      u.pathname = u.pathname.replace(/^\/pdf\//, '/abs/');
      k = u.origin + u.pathname;
    }
  } catch (e) { /* ignore */ }
  return k;
}

function parseSearchQuery(raw) {
  var authorFilter = null, sourceFilter = null, sortOverride = null;
  var textTokens = [], exactPhrases = [], titleTokens = [], titlePhrases = [];

  var byMatch = raw.match(/\bby:(.+)/);
  if (byMatch) {
    authorFilter = byMatch[1].trim().toLowerCase();
    raw = raw.slice(0, byMatch.index).trim();
  }

  var s = raw.replace(/title:"([^"]+)"/g, function(_, ph) { titlePhrases.push(ph.toLowerCase()); return ''; });
  s = s.replace(/"([^"]+)"/g, function(_, ph) { exactPhrases.push(ph.toLowerCase()); return ''; });

  var tokens = s.split(/\s+/).filter(Boolean);
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t.startsWith('source:')) sourceFilter = t.slice(7).toLowerCase();
    else if (t.startsWith('sort:')) sortOverride = t.slice(5).toLowerCase();
    else if (t.startsWith('title:')) titleTokens.push(t.slice(6).toLowerCase());
    else textTokens.push(t);
  }
  return { authorFilter, sourceFilter, sortOverride, textTokens, exactPhrases, titleTokens, titlePhrases };
}

function getInterestProfile(papers, userState) {
  var readPosts = userState.readPosts || [];
  var savedPosts = userState.savedPosts || {};
  var hiddenPosts = userState.hiddenPosts || [];
  var ratings = userState.ratings || {};

  var topicScores = {};
  var catScores = {};

  function addTitle(title, weight) {
    if (!title) return;
    var words = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').split(/\s+/).filter(function(w) { return w.length > 2 && !_STOP_WORDS.has(w); });
    for (var i = 0; i < words.length; i++) {
      topicScores[words[i]] = (topicScores[words[i]] || 0) + weight;
    }
  }

  function addCategories(cats, weight) {
    if (!Array.isArray(cats)) return;
    for (var i = 0; i < cats.length; i++) {
      catScores[cats[i]] = (catScores[cats[i]] || 0) + weight;
    }
  }

  // Read posts: weight 1
  var readSet = new Set(readPosts);
  for (var i = 0; i < papers.length; i++) {
    if (readSet.has(papers[i].link)) {
      addTitle(papers[i].title, 1);
      addCategories(papers[i].categories, 1);
    }
  }

  // Saved posts: weight 3
  var savedSet = new Set(Object.keys(savedPosts));
  for (var i = 0; i < papers.length; i++) {
    if (savedSet.has(papers[i].link)) {
      addTitle(papers[i].title, 3);
      addCategories(papers[i].categories, 3);
    }
  }

  // Rated posts: weight = rating value
  for (var i = 0; i < papers.length; i++) {
    var nLink = _normalizeRatingKey(papers[i].link);
    var rating = ratings[nLink] || ratings[papers[i].link] || 0;
    if (rating > 0) {
      addTitle(papers[i].title, rating);
      addCategories(papers[i].categories, rating);
    }
  }

  // Hidden posts: negative weight
  var hiddenSet = new Set(hiddenPosts);
  for (var i = 0; i < papers.length; i++) {
    if (hiddenSet.has(papers[i].link)) {
      addTitle(papers[i].title, -0.5);
      addCategories(papers[i].categories, -0.5);
    }
  }

  var topTopics = Object.entries(topicScores)
    .filter(function(e) { return e[1] > 0; })
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 15)
    .map(function(e) { return e[0]; });

  var topCategories = Object.entries(catScores)
    .filter(function(e) { return e[1] > 0; })
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 10)
    .map(function(e) { return e[0]; });

  return { topTopics, topCategories };
}

function getSourceAffinity(papers, userState) {
  var readSet = new Set(userState.readPosts || []);
  var savedSet = new Set(Object.keys(userState.savedPosts || {}));
  var hiddenSet = new Set(userState.hiddenPosts || []);
  var ratings = userState.ratings || {};

  var sourceCounts = {};
  for (var i = 0; i < papers.length; i++) {
    var p = papers[i];
    if (!sourceCounts[p.source]) sourceCounts[p.source] = { total: 0, read: 0, saved: 0, rated: 0, hidden: 0 };
    var c = sourceCounts[p.source];
    c.total++;
    if (readSet.has(p.link)) c.read++;
    if (savedSet.has(p.link)) c.saved++;
    var nLink = _normalizeRatingKey(p.link);
    if (ratings[nLink] || ratings[p.link]) c.rated++;
    if (hiddenSet.has(p.link)) c.hidden++;
  }

  var affinity = {};
  var sources = Object.keys(sourceCounts);
  for (var i = 0; i < sources.length; i++) {
    var source = sources[i];
    var c = sourceCounts[source];
    if (c.total < 3) { affinity[source] = 0.5; continue; }
    var engagement = (c.read + c.saved * 2 + c.rated * 3) / c.total;
    var penalty = (c.hidden / c.total) * 0.5;
    affinity[source] = Math.max(0.1, Math.min(1.0, engagement - penalty));
  }
  return affinity;
}

function _computeContentScore(paper, profile) {
  var score = 30;
  if (!profile) return score;

  var titleWords = (paper.title || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').split(/\s+/).filter(function(w) { return w.length > 2; });
  var topTopics = profile.topTopics || [];
  var topCategories = profile.topCategories || [];

  var topicMatches = 0;
  var topTopicSet = new Set(topTopics);
  for (var j = 0; j < titleWords.length; j++) {
    if (topTopicSet.has(titleWords[j])) topicMatches++;
  }
  score += Math.min(40, topicMatches * 15);

  var paperCats = Array.isArray(paper.categories) ? paper.categories : [];
  var topCatSet = new Set(topCategories);
  var catMatches = 0;
  for (var k = 0; k < paperCats.length; k++) {
    if (topCatSet.has(paperCats[k])) catMatches++;
  }
  score += Math.min(30, catMatches * 15);

  return Math.min(100, score);
}

function filterAndScore(papers, userState, params) {
  var hiddenSet = new Set(userState.hiddenPosts || []);
  var blockedWordsSet = new Set(userState.blockedWords || []);
  var hiddenSourceFilters = new Set(params.hiddenSourceFilters || []);
  var category = params.category || '';
  var rawSearch = (params.searchQuery || '').toLowerCase();
  var currentSort = params.currentSort || 'foryou';
  var SOURCE_NAMES = params.SOURCE_NAMES || {};
  var FEED_CAT_MAP = params.FEED_CAT_MAP || {};

  var parsed = parseSearchQuery(rawSearch);
  var authorFilter = parsed.authorFilter, sourceFilter = parsed.sourceFilter, sortOverride = parsed.sortOverride;
  var textTokens = parsed.textTokens, exactPhrases = parsed.exactPhrases;
  var titleTokens = parsed.titleTokens, titlePhrases = parsed.titlePhrases;

  // Filter
  var filteredIndices = [];
  for (var i = 0; i < papers.length; i++) {
    var p = papers[i];
    if (hiddenSourceFilters.has(p.source)) continue;
    if (hiddenSet.has(p.link)) continue;
    if (blockedWordsSet.size > 0) {
      var titleLower = p.title.toLowerCase();
      var blocked = false;
      for (var w of blockedWordsSet) {
        if (titleLower.includes(w)) { blocked = true; break; }
      }
      if (blocked) continue;
    }
    if (category && !(Array.isArray(p.categories) ? p.categories : []).includes(category)) continue;
    if (authorFilter && !(p.authors || '').toLowerCase().includes(authorFilter)) continue;
    if (sourceFilter && !p.source.toLowerCase().includes(sourceFilter) && !(SOURCE_NAMES[p.source] || '').toLowerCase().includes(sourceFilter)) continue;
    var allPhrases = exactPhrases.slice();
    if (textTokens.length) allPhrases.push(textTokens.join(' '));
    if (allPhrases.length || titleTokens.length || titlePhrases.length) {
      var titleLow = p.title.toLowerCase();
      var h = (p.title + ' ' + p.authors + ' ' + p.description).toLowerCase();
      if (!allPhrases.every(function(ph) { return h.includes(ph); })) continue;
      if (!titlePhrases.every(function(ph) { return titleLow.includes(ph); })) continue;
      if (!titleTokens.every(function(t) { return titleLow.includes(t); })) continue;
    }
    filteredIndices.push(i);
  }

  // Compute scores
  var compositeScores = {};
  var interestProfile = null;
  var effectiveSort = sortOverride === 'cited' || sortOverride === 'popular' ? 'citations' : sortOverride === 'latest' ? 'latest' : currentSort;

  if (effectiveSort === 'foryou') {
    var affinity = getSourceAffinity(papers, userState);
    var profile = getInterestProfile(papers, userState);
    interestProfile = profile;
    var now = Date.now();
    var wBase = parseFloat(params.fyWeightBase || '0.7');
    var wAff = parseFloat(params.fyWeightAffinity || '0.3');
    var wRecency = parseFloat(params.fyWeightRecency || '1.0');
    var wExplore = parseFloat(params.fyWeightExploration || '0.10');

    for (var j = 0; j < filteredIndices.length; j++) {
      var idx = filteredIndices[j];
      var p = papers[idx];
      var content = _computeContentScore(p, profile);
      var aff = affinity[p.source] != null ? affinity[p.source] : 0.5;
      var age = p.pubDate ? Math.max(0, (now - new Date(p.pubDate).getTime()) / 3600000) : 24;
      var recency = Math.max(0, 10 - age * 0.5) * wRecency;
      var explore = (aff <= 0.5 ? 1 : 0) * wExplore * 10;
      compositeScores[idx] = content * (wBase + aff * wAff) + recency + explore;
    }
    filteredIndices.sort(function(a, b) { return compositeScores[b] - compositeScores[a]; });
  } else if (effectiveSort === 'citations') {
    filteredIndices.sort(function(a, b) {
      var pa = papers[a], pb = papers[b];
      var aScore = pa.source === 'hn' ? (pa.hnScore || 0) : (pa.citations || 0);
      var bScore = pb.source === 'hn' ? (pb.hnScore || 0) : (pb.citations || 0);
      return bScore - aScore;
    });
  } else {
    filteredIndices.sort(function(a, b) {
      var da = papers[a].pubDate ? new Date(papers[a].pubDate).getTime() : 0;
      var db = papers[b].pubDate ? new Date(papers[b].pubDate).getTime() : 0;
      return db - da;
    });
  }

  // Category-aware interleaving
  var maxRun = parseInt(params.maxPerCategoryRun || '3', 10) || 3;
  if (filteredIndices.length > 1) {
    var buckets = new Map();
    var catOrder = [];
    for (var j = 0; j < filteredIndices.length; j++) {
      var idx = filteredIndices[j];
      var cat = FEED_CAT_MAP[papers[idx].source] || papers[idx].source;
      if (!buckets.has(cat)) { buckets.set(cat, []); catOrder.push(cat); }
      buckets.get(cat).push(idx);
    }
    if (buckets.size > 1) {
      var result = [];
      var cursors = new Map();
      for (var ci = 0; ci < catOrder.length; ci++) cursors.set(catOrder[ci], 0);
      var remaining = filteredIndices.length;
      while (remaining > 0) {
        for (var ci = 0; ci < catOrder.length; ci++) {
          var cat = catOrder[ci];
          var arr = buckets.get(cat);
          var cur = cursors.get(cat);
          if (cur >= arr.length) continue;
          var take = Math.min(maxRun, arr.length - cur);
          for (var k = 0; k < take; k++) result.push(arr[cur + k]);
          cursors.set(cat, cur + take);
          remaining -= take;
        }
      }
      filteredIndices = result;
    }
  }

  return { filteredIndices, compositeScores, interestProfile };
}

// ── Worker message handler ──
self.onmessage = function(e) {
  var msg = e.data;
  if (msg.type === 'score') {
    var result = filterAndScore(msg.papers, msg.userState, msg.params);
    self.postMessage({
      type: 'scored',
      requestId: msg.requestId,
      filteredIndices: result.filteredIndices,
      compositeScores: result.compositeScores,
      interestProfile: result.interestProfile
    });
  }
};
