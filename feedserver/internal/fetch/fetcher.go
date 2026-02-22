package fetch

import (
	"log"
	"sync"
	"time"

	"feedserver/internal/model"
	"feedserver/internal/store"
)

const (
	StaleThreshold = 600 // 10 minutes in seconds
	MaxConcurrent  = 10
)

// Fetcher manages concurrent feed fetching with freshness checks.
type Fetcher struct {
	store   *store.Store
	sources []model.Source
}

func NewFetcher(s *store.Store, sources []model.Source) *Fetcher {
	return &Fetcher{store: s, sources: sources}
}

// AddSource appends a source to the in-memory list so it can be fetched.
func (f *Fetcher) AddSource(src model.Source) {
	for _, s := range f.sources {
		if s.Key == src.Key {
			return // already known
		}
	}
	f.sources = append(f.sources, src)
}

// RefreshAll fetches all stale sources concurrently.
func (f *Fetcher) RefreshAll() int {
	keys := make([]string, len(f.sources))
	sourceMap := make(map[string]model.Source)
	for i, s := range f.sources {
		keys[i] = s.Key
		sourceMap[s.Key] = s
	}

	freshness, err := f.store.GetSourceFreshness(keys)
	if err != nil {
		log.Printf("freshness check error: %v", err)
		freshness = make(map[string]int64)
	}

	now := time.Now().Unix()
	var stale []model.Source
	for _, src := range f.sources {
		lastFetch, ok := freshness[src.Key]
		if !ok || (now-lastFetch) > StaleThreshold {
			stale = append(stale, src)
		}
	}

	if len(stale) == 0 {
		return 0
	}

	log.Printf("refreshing %d stale sources", len(stale))
	sem := make(chan struct{}, MaxConcurrent)
	var mu sync.Mutex
	var allItems []model.FeedItem

	var wg sync.WaitGroup
	for _, src := range stale {
		wg.Add(1)
		go func(src model.Source) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			items, err := fetchSource(src)
			if err != nil {
				log.Printf("fetch %s: %v", src.Key, err)
				return
			}
			nowTs := time.Now().Unix()
			for i := range items {
				if items[i].FetchedAt == 0 {
					items[i].FetchedAt = nowTs
				}
			}
			mu.Lock()
			allItems = append(allItems, items...)
			mu.Unlock()
			log.Printf("fetched %s: %d items", src.Key, len(items))
		}(src)
	}
	wg.Wait()

	if len(allItems) > 0 {
		if err := f.store.UpsertFeedItems(allItems); err != nil {
			log.Printf("upsert error: %v", err)
		}
	}

	return len(allItems)
}

// RefreshSources refreshes specific sources by key.
func (f *Fetcher) RefreshSources(keys []string) int {
	sourceMap := make(map[string]model.Source)
	for _, s := range f.sources {
		sourceMap[s.Key] = s
	}

	var toFetch []model.Source
	for _, k := range keys {
		if src, ok := sourceMap[k]; ok {
			toFetch = append(toFetch, src)
		}
	}

	sem := make(chan struct{}, MaxConcurrent)
	var mu sync.Mutex
	var allItems []model.FeedItem

	var wg sync.WaitGroup
	for _, src := range toFetch {
		wg.Add(1)
		go func(src model.Source) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			items, err := fetchSource(src)
			if err != nil {
				log.Printf("fetch %s: %v", src.Key, err)
				return
			}
			now := time.Now().Unix()
			for i := range items {
				if items[i].FetchedAt == 0 {
					items[i].FetchedAt = now
				}
			}
			mu.Lock()
			allItems = append(allItems, items...)
			mu.Unlock()
		}(src)
	}
	wg.Wait()

	if len(allItems) > 0 {
		if err := f.store.UpsertFeedItems(allItems); err != nil {
			log.Printf("upsert error: %v", err)
		}
	}
	return len(allItems)
}

func fetchSource(src model.Source) ([]model.FeedItem, error) {
	switch src.Special {
	case "arxiv":
		return FetchArxiv()
	case "hn":
		return FetchHN()
	case "polymarket":
		return FetchPolymarket()
	default:
		if src.URL == "" {
			return nil, nil
		}
		body, err := FetchURL(src.URL, 15*time.Second)
		if err != nil {
			return nil, err
		}
		return ParseRSSItems(body, src.Key), nil
	}
}
