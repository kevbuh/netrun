package model

import "encoding/json"

// Source represents a feed source from the catalog.
type Source struct {
	Key     string `json:"key"`
	Name    string `json:"name"`
	Desc    string `json:"desc"`
	Cat     string `json:"cat"`
	URL     string `json:"url,omitempty"`
	Special string `json:"special,omitempty"`
	Favicon string `json:"favicon,omitempty"`
}

// FeedItem represents a single feed entry stored in the database.
type FeedItem struct {
	ID          int64  `json:"id"`
	Source      string `json:"source"`
	Title       string `json:"title"`
	Link        string `json:"link"`
	Authors     string `json:"authors"`
	Categories  string `json:"categories"`  // JSON array string
	Description string `json:"description"`
	PubDate     string `json:"pub_date"`
	DisplayDate string `json:"display_date"`
	ArxivID     string `json:"arxiv_id,omitempty"`
	Extra       string `json:"extra"` // JSON object string
	FetchedAt   int64  `json:"fetched_at"`
}

// FeedItemJSON is the API response format with parsed JSON fields.
type FeedItemJSON struct {
	ID          int64    `json:"id"`
	Source      string   `json:"source"`
	Title       string   `json:"title"`
	Link        string   `json:"link"`
	Authors     string   `json:"authors"`
	Categories  []string `json:"categories"`
	Description string   `json:"description"`
	PubDate     string   `json:"pubDate"`
	Date        string   `json:"date"`
	ArxivID     string   `json:"arxivId,omitempty"`
	Extra       map[string]any `json:"extra,omitempty"`
}

// MarshalJSON flattens Extra fields into the top-level JSON object.
// The frontend expects fields like hnScore, polyYesPct at top level.
func (f FeedItemJSON) MarshalJSON() ([]byte, error) {
	m := map[string]any{
		"id":          f.ID,
		"source":      f.Source,
		"title":       f.Title,
		"link":        f.Link,
		"authors":     f.Authors,
		"categories":  f.Categories,
		"description": f.Description,
		"pubDate":     f.PubDate,
		"date":        f.Date,
	}
	if f.ArxivID != "" {
		m["arxivId"] = f.ArxivID
	}
	for k, v := range f.Extra {
		m[k] = v
	}
	return json.Marshal(m)
}

// UserState holds all user engagement data for ranking.
type UserState struct {
	UserID       string
	ReadPosts    map[string]bool
	SavedPosts   map[string]int64 // link -> saved_at timestamp
	HiddenPosts  map[string]bool
	Ratings      map[string]int   // link -> rating value
	BlockedWords []string
	SourcePrefs  map[string]bool  // source key -> enabled
	RankParams   RankParams
}

// RankParams holds tunable ranking weights.
type RankParams struct {
	WeightBase        float64 `json:"weightBase"`
	WeightAffinity    float64 `json:"weightAffinity"`
	WeightRecency     float64 `json:"weightRecency"`
	WeightExploration float64 `json:"weightExploration"`
	MaxPerCategoryRun int     `json:"maxPerCategoryRun"`
}

// DefaultRankParams returns the default ranking parameters.
func DefaultRankParams() RankParams {
	return RankParams{
		WeightBase:        0.7,
		WeightAffinity:    0.3,
		WeightRecency:     1.0,
		WeightExploration: 0.10,
		MaxPerCategoryRun: 3,
	}
}
