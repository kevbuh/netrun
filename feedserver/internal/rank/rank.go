package rank

import (
	"math"
	"regexp"
	"sort"
	"strings"
	"time"

	"feedserver/internal/model"
	"feedserver/internal/store"
)

var stopWords = map[string]bool{
	"the": true, "a": true, "an": true, "and": true, "or": true, "but": true,
	"in": true, "on": true, "at": true, "to": true, "for": true, "of": true,
	"with": true, "by": true, "from": true, "is": true, "it": true, "that": true,
	"this": true, "are": true, "was": true, "were": true, "be": true, "been": true,
	"has": true, "have": true, "had": true, "not": true, "no": true, "do": true,
	"does": true, "did": true, "will": true, "would": true, "can": true, "could": true,
	"should": true, "may": true, "might": true, "shall": true, "into": true, "as": true,
	"if": true, "its": true, "than": true, "so": true, "very": true, "just": true,
	"about": true, "also": true, "more": true, "other": true, "some": true, "only": true,
	"over": true, "such": true, "after": true, "before": true, "between": true,
	"each": true, "all": true, "both": true, "through": true, "during": true,
	"up": true, "out": true, "then": true, "them": true, "these": true, "those": true,
	"own": true, "same": true, "how": true, "our": true, "new": true, "using": true,
	"via": true, "based": true, "we": true, "i": true, "you": true, "he": true,
	"she": true, "they": true, "what": true, "which": true, "who": true, "when": true,
	"where": true, "why": true, "two": true, "one": true, "three": true, "first": true,
	"second": true, "third": true, "most": true, "many": true, "any": true, "few": true,
	"large": true, "small": true, "high": true, "low": true, "long": true, "short": true,
	"old": true,
}

var nonAlphaRe = regexp.MustCompile(`[^a-z0-9\s-]`)

func tokenize(title string) []string {
	lower := strings.ToLower(title)
	cleaned := nonAlphaRe.ReplaceAllString(lower, "")
	words := strings.Fields(cleaned)
	var out []string
	for _, w := range words {
		if len(w) > 2 && !stopWords[w] {
			out = append(out, w)
		}
	}
	return out
}

type interestProfile struct {
	TopTopics     []string
	TopCategories []string
}

func getInterestProfile(items []model.FeedItemJSON, state *model.UserState) interestProfile {
	topicScores := make(map[string]float64)
	catScores := make(map[string]float64)

	addTitle := func(title string, weight float64) {
		for _, w := range tokenize(title) {
			topicScores[w] += weight
		}
	}
	addCats := func(cats []string, weight float64) {
		for _, c := range cats {
			catScores[c] += weight
		}
	}

	for _, item := range items {
		if state.ReadPosts[item.Link] {
			addTitle(item.Title, 1)
			addCats(item.Categories, 1)
		}
		if _, ok := state.SavedPosts[item.Link]; ok {
			addTitle(item.Title, 3)
			addCats(item.Categories, 3)
		}
		if r, ok := state.Ratings[item.Link]; ok && r > 0 {
			addTitle(item.Title, float64(r))
			addCats(item.Categories, float64(r))
		}
		if state.HiddenPosts[item.Link] {
			addTitle(item.Title, -0.5)
			addCats(item.Categories, -0.5)
		}
	}

	return interestProfile{
		TopTopics:     topN(topicScores, 15),
		TopCategories: topN(catScores, 10),
	}
}

func topN(scores map[string]float64, n int) []string {
	type kv struct {
		k string
		v float64
	}
	var sorted []kv
	for k, v := range scores {
		if v > 0 {
			sorted = append(sorted, kv{k, v})
		}
	}
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].v > sorted[j].v })
	if len(sorted) > n {
		sorted = sorted[:n]
	}
	out := make([]string, len(sorted))
	for i, kv := range sorted {
		out[i] = kv.k
	}
	return out
}

func getSourceAffinity(items []model.FeedItemJSON, state *model.UserState) map[string]float64 {
	type counts struct {
		total, read, saved, rated, hidden int
	}
	sc := make(map[string]*counts)
	for _, item := range items {
		c, ok := sc[item.Source]
		if !ok {
			c = &counts{}
			sc[item.Source] = c
		}
		c.total++
		if state.ReadPosts[item.Link] {
			c.read++
		}
		if _, ok := state.SavedPosts[item.Link]; ok {
			c.saved++
		}
		if _, ok := state.Ratings[item.Link]; ok {
			c.rated++
		}
		if state.HiddenPosts[item.Link] {
			c.hidden++
		}
	}

	aff := make(map[string]float64)
	for source, c := range sc {
		if c.total < 3 {
			aff[source] = 0.5
			continue
		}
		engagement := float64(c.read+c.saved*2+c.rated*3) / float64(c.total)
		penalty := float64(c.hidden) / float64(c.total) * 0.5
		aff[source] = math.Max(0.1, math.Min(1.0, engagement-penalty))
	}
	return aff
}

func contentScore(item model.FeedItemJSON, profile interestProfile) float64 {
	score := 30.0
	titleWords := tokenize(item.Title)
	topicSet := toSet(profile.TopTopics)
	matches := 0
	for _, w := range titleWords {
		if topicSet[w] {
			matches++
		}
	}
	score += math.Min(40, float64(matches)*15)

	catSet := toSet(profile.TopCategories)
	catMatches := 0
	for _, c := range item.Categories {
		if catSet[c] {
			catMatches++
		}
	}
	score += math.Min(30, float64(catMatches)*15)
	return math.Min(100, score)
}

func toSet(ss []string) map[string]bool {
	m := make(map[string]bool, len(ss))
	for _, s := range ss {
		m[s] = true
	}
	return m
}

// RankParams controls the scoring behavior.
type Params struct {
	Sort     string // "foryou", "latest", "citations"
	Category string
	Search   string
	Limit    int
	Offset   int
}

// CatMap maps source keys to categories.
type CatMap map[string]string

// RankedResult is the output of the ranking pipeline.
type RankedResult struct {
	Items []model.FeedItemJSON `json:"items"`
	Total int                  `json:"total"`
}

// Rank filters, scores, and sorts feed items.
func Rank(items []model.FeedItemJSON, state *model.UserState, catMap CatMap, params Params) RankedResult {
	// Filter
	filtered := filterItems(items, state, catMap, params)

	// Sort
	effectiveSort := params.Sort
	if effectiveSort == "" {
		effectiveSort = "foryou"
	}

	switch effectiveSort {
	case "foryou":
		sortForYou(filtered, items, state, catMap)
	case "citations":
		sort.Slice(filtered, func(i, j int) bool {
			return getScore(filtered[i]) > getScore(filtered[j])
		})
	default: // "latest"
		sort.Slice(filtered, func(i, j int) bool {
			return filtered[i].PubDate > filtered[j].PubDate
		})
	}

	// Interleave by category
	if effectiveSort == "foryou" && len(filtered) > 1 {
		maxRun := state.RankParams.MaxPerCategoryRun
		if maxRun <= 0 {
			maxRun = 3
		}
		filtered = interleave(filtered, catMap, maxRun)
	}

	total := len(filtered)

	// Pagination
	if params.Offset > 0 && params.Offset < len(filtered) {
		filtered = filtered[params.Offset:]
	} else if params.Offset >= len(filtered) {
		filtered = nil
	}
	if params.Limit > 0 && params.Limit < len(filtered) {
		filtered = filtered[:params.Limit]
	}

	return RankedResult{Items: filtered, Total: total}
}

func filterItems(items []model.FeedItemJSON, state *model.UserState, catMap CatMap, params Params) []model.FeedItemJSON {
	blockedSet := toSet(state.BlockedWords)
	disabledSources := make(map[string]bool)
	for k, enabled := range state.SourcePrefs {
		if !enabled {
			disabledSources[k] = true
		}
	}

	var parsed searchQuery
	if params.Search != "" {
		parsed = parseSearch(params.Search)
	}

	var out []model.FeedItemJSON
	for _, item := range items {
		if disabledSources[item.Source] {
			continue
		}
		if state.HiddenPosts[item.Link] {
			continue
		}
		if len(blockedSet) > 0 {
			titleLow := strings.ToLower(item.Title)
			blocked := false
			for w := range blockedSet {
				if strings.Contains(titleLow, w) {
					blocked = true
					break
				}
			}
			if blocked {
				continue
			}
		}
		if params.Category != "" {
			found := false
			for _, c := range item.Categories {
				if c == params.Category {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}
		if params.Search != "" && !matchSearch(item, catMap, parsed) {
			continue
		}
		out = append(out, item)
	}
	return out
}

type searchQuery struct {
	authorFilter  string
	sourceFilter  string
	sortOverride  string
	textTokens    []string
	exactPhrases  []string
	titleTokens   []string
	titlePhrases  []string
}

func parseSearch(raw string) searchQuery {
	var q searchQuery
	lower := strings.ToLower(raw)

	// by:author
	if idx := strings.Index(lower, "by:"); idx != -1 {
		q.authorFilter = strings.TrimSpace(lower[idx+3:])
		lower = strings.TrimSpace(lower[:idx])
	}

	// title:"phrase"
	titlePhraseRe := regexp.MustCompile(`title:"([^"]+)"`)
	for _, m := range titlePhraseRe.FindAllStringSubmatch(lower, -1) {
		q.titlePhrases = append(q.titlePhrases, m[1])
	}
	lower = titlePhraseRe.ReplaceAllString(lower, "")

	// "exact phrase"
	phraseRe := regexp.MustCompile(`"([^"]+)"`)
	for _, m := range phraseRe.FindAllStringSubmatch(lower, -1) {
		q.exactPhrases = append(q.exactPhrases, m[1])
	}
	lower = phraseRe.ReplaceAllString(lower, "")

	for _, tok := range strings.Fields(lower) {
		if strings.HasPrefix(tok, "source:") {
			q.sourceFilter = tok[7:]
		} else if strings.HasPrefix(tok, "sort:") {
			q.sortOverride = tok[5:]
		} else if strings.HasPrefix(tok, "title:") {
			q.titleTokens = append(q.titleTokens, tok[6:])
		} else {
			q.textTokens = append(q.textTokens, tok)
		}
	}
	return q
}

func matchSearch(item model.FeedItemJSON, catMap CatMap, q searchQuery) bool {
	if q.authorFilter != "" && !strings.Contains(strings.ToLower(item.Authors), q.authorFilter) {
		return false
	}
	if q.sourceFilter != "" && !strings.Contains(strings.ToLower(item.Source), q.sourceFilter) {
		return false
	}
	titleLow := strings.ToLower(item.Title)
	haystack := strings.ToLower(item.Title + " " + item.Authors + " " + item.Description)

	// Text tokens as phrase
	if len(q.textTokens) > 0 {
		phrase := strings.Join(q.textTokens, " ")
		if !strings.Contains(haystack, phrase) {
			return false
		}
	}
	for _, p := range q.exactPhrases {
		if !strings.Contains(haystack, p) {
			return false
		}
	}
	for _, p := range q.titlePhrases {
		if !strings.Contains(titleLow, p) {
			return false
		}
	}
	for _, t := range q.titleTokens {
		if !strings.Contains(titleLow, t) {
			return false
		}
	}
	return true
}

func sortForYou(filtered []model.FeedItemJSON, allItems []model.FeedItemJSON, state *model.UserState, catMap CatMap) {
	affinity := getSourceAffinity(allItems, state)
	profile := getInterestProfile(allItems, state)
	now := time.Now()
	p := state.RankParams

	scores := make(map[int]float64, len(filtered))
	for i, item := range filtered {
		content := contentScore(item, profile)
		aff := affinity[item.Source]
		if aff == 0 {
			aff = 0.5
		}

		ageHours := 24.0
		if item.PubDate != "" {
			if t, err := time.Parse(time.RFC3339, item.PubDate); err == nil {
				ageHours = math.Max(0, now.Sub(t).Hours())
			} else if t, err := time.Parse(time.RFC1123Z, item.PubDate); err == nil {
				ageHours = math.Max(0, now.Sub(t).Hours())
			} else if t, err := time.Parse(time.RFC1123, item.PubDate); err == nil {
				ageHours = math.Max(0, now.Sub(t).Hours())
			}
		}
		recency := math.Max(0, 10-ageHours*0.5) * p.WeightRecency
		explore := 0.0
		if aff <= 0.5 {
			explore = p.WeightExploration * 10
		}
		scores[i] = content*(p.WeightBase+aff*p.WeightAffinity) + recency + explore
	}

	sort.Slice(filtered, func(i, j int) bool {
		return scores[i] > scores[j]
	})
}

func getScore(item model.FeedItemJSON) float64 {
	if item.Source == "hn" {
		if v, ok := item.Extra["hnScore"]; ok {
			if f, ok := v.(float64); ok {
				return f
			}
		}
	}
	if v, ok := item.Extra["citations"]; ok {
		if f, ok := v.(float64); ok {
			return f
		}
	}
	return 0
}

func interleave(items []model.FeedItemJSON, catMap CatMap, maxRun int) []model.FeedItemJSON {
	type bucket struct {
		cat   string
		items []model.FeedItemJSON
	}
	bucketMap := make(map[string]*bucket)
	var catOrder []string

	for _, item := range items {
		cat := catMap[item.Source]
		if cat == "" {
			cat = item.Source
		}
		b, ok := bucketMap[cat]
		if !ok {
			b = &bucket{cat: cat}
			bucketMap[cat] = b
			catOrder = append(catOrder, cat)
		}
		b.items = append(b.items, item)
	}

	if len(bucketMap) <= 1 {
		return items
	}

	result := make([]model.FeedItemJSON, 0, len(items))
	cursors := make(map[string]int)
	remaining := len(items)

	for remaining > 0 {
		for _, cat := range catOrder {
			b := bucketMap[cat]
			cur := cursors[cat]
			if cur >= len(b.items) {
				continue
			}
			take := maxRun
			if take > len(b.items)-cur {
				take = len(b.items) - cur
			}
			result = append(result, b.items[cur:cur+take]...)
			cursors[cat] = cur + take
			remaining -= take
		}
	}
	return result
}

// BuildCatMap builds a source-key -> category map from sources.
func BuildCatMap(sources []model.Source) CatMap {
	m := make(CatMap, len(sources))
	for _, s := range sources {
		m[s.Key] = s.Cat
	}
	return m
}

// ItemsToJSON converts DB items to API format.
func ItemsToJSON(items []model.FeedItem) []model.FeedItemJSON {
	out := make([]model.FeedItemJSON, len(items))
	for i, it := range items {
		out[i] = store.MapToJSON(it)
	}
	return out
}
