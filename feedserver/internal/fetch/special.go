package fetch

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"

	"feedserver/internal/model"
)

var arxivIDRe = regexp.MustCompile(`(\d{4}\.\d{4,5})`)

// FetchArxiv fetches the arXiv CS RSS feed.
func FetchArxiv() ([]model.FeedItem, error) {
	body, err := FetchURL("https://rss.arxiv.org/rss/cs", 15*time.Second)
	if err != nil {
		return nil, err
	}
	items := ParseRSSItems(body, "arxiv")
	for i := range items {
		if m := arxivIDRe.FindString(items[i].Link); m != "" {
			items[i].ArxivID = m
		}
		// Clean "arXiv:XXXX.XXXXX" prefix from description
		items[i].Description = regexp.MustCompile(`(?i)^arXiv:\d{4}\.\d{4,5}\s*`).ReplaceAllString(items[i].Description, "")
	}
	return items, nil
}

type hnStory struct {
	ID          int    `json:"id"`
	Type        string `json:"type"`
	Title       string `json:"title"`
	URL         string `json:"url"`
	By          string `json:"by"`
	Time        int64  `json:"time"`
	Score       int    `json:"score"`
	Descendants int    `json:"descendants"`
}

// FetchHN fetches top 30 Hacker News stories.
func FetchHN() ([]model.FeedItem, error) {
	body, err := FetchURL("https://hacker-news.firebaseio.com/v0/beststories.json", 15*time.Second)
	if err != nil {
		return nil, err
	}
	var ids []int
	if err := json.Unmarshal([]byte(body), &ids); err != nil {
		return nil, fmt.Errorf("parse HN IDs: %w", err)
	}
	if len(ids) > 30 {
		ids = ids[:30]
	}

	type result struct {
		story hnStory
		err   error
	}
	ch := make(chan result, len(ids))
	for _, id := range ids {
		go func(id int) {
			url := fmt.Sprintf("https://hacker-news.firebaseio.com/v0/item/%d.json", id)
			b, err := FetchURL(url, 10*time.Second)
			if err != nil {
				ch <- result{err: err}
				return
			}
			var s hnStory
			if err := json.Unmarshal([]byte(b), &s); err != nil {
				ch <- result{err: err}
				return
			}
			ch <- result{story: s}
		}(id)
	}

	now := time.Now().Unix()
	var items []model.FeedItem
	for range ids {
		r := <-ch
		if r.err != nil || r.story.Type != "story" {
			continue
		}
		s := r.story
		link := s.URL
		if link == "" {
			link = fmt.Sprintf("https://news.ycombinator.com/item?id=%d", s.ID)
		}
		pubDate := ""
		if s.Time > 0 {
			pubDate = time.Unix(s.Time, 0).UTC().Format(time.RFC3339)
		}
		extra, _ := json.Marshal(map[string]any{
			"hnId": s.ID, "hnScore": s.Score, "hnComments": s.Descendants,
		})
		items = append(items, model.FeedItem{
			Source:      "hn",
			Title:       s.Title,
			Link:        link,
			Authors:     s.By,
			Categories:  "[]",
			PubDate:     pubDate,
			DisplayDate: pubDate,
			Extra:       string(extra),
			FetchedAt:   now,
		})
	}
	return items, nil
}

// FetchPolymarket fetches prediction markets from Polymarket.
func FetchPolymarket() ([]model.FeedItem, error) {
	body, err := FetchURL("https://polymarket.com/breaking", 15*time.Second)
	if err != nil {
		return nil, err
	}
	marker := `__NEXT_DATA__" type="application/json" crossorigin="anonymous">`
	idx := strings.Index(body, marker)
	if idx == -1 {
		return nil, fmt.Errorf("polymarket: could not find __NEXT_DATA__")
	}
	start := idx + len(marker)
	end := strings.Index(body[start:], "</script>")
	if end == -1 {
		return nil, fmt.Errorf("polymarket: could not find end of script")
	}
	jsonStr := body[start : start+end]

	var nextData struct {
		Props struct {
			PageProps struct {
				DehydratedState struct {
					Queries []struct {
						QueryKey []string `json:"queryKey"`
						State    struct {
							Data struct {
								Markets []json.RawMessage `json:"markets"`
							} `json:"data"`
						} `json:"state"`
					} `json:"queries"`
				} `json:"dehydratedState"`
			} `json:"pageProps"`
		} `json:"props"`
	}
	if err := json.Unmarshal([]byte(jsonStr), &nextData); err != nil {
		return nil, fmt.Errorf("polymarket: parse JSON: %w", err)
	}

	var rawMarkets []json.RawMessage
	for _, q := range nextData.Props.PageProps.DehydratedState.Queries {
		for _, k := range q.QueryKey {
			if k == "biggest-movers" {
				rawMarkets = q.State.Data.Markets
				break
			}
		}
		if rawMarkets != nil {
			break
		}
	}

	now := time.Now()
	nowUnix := now.Unix()
	var items []model.FeedItem
	for _, raw := range rawMarkets {
		var m struct {
			Question         string    `json:"question"`
			Slug             string    `json:"slug"`
			Image            string    `json:"image"`
			OutcomePrices    []string  `json:"outcomePrices"`
			OneDayPriceChange float64  `json:"oneDayPriceChange"`
			Events           []struct {
				Slug   string  `json:"slug"`
				Volume float64 `json:"volume"`
			} `json:"events"`
		}
		if err := json.Unmarshal(raw, &m); err != nil {
			continue
		}
		yesPct := 0
		if len(m.OutcomePrices) > 0 {
			var p float64
			fmt.Sscanf(m.OutcomePrices[0], "%f", &p)
			yesPct = int(math.Round(p * 100))
		}
		changePct := int(math.Round(m.OneDayPriceChange * 100))
		volume := 0
		eventSlug := m.Slug
		if len(m.Events) > 0 {
			volume = int(math.Round(m.Events[0].Volume))
			eventSlug = m.Events[0].Slug
		}
		url := fmt.Sprintf("https://polymarket.com/event/%s", eventSlug)
		extra, _ := json.Marshal(map[string]any{
			"polyYesPct": yesPct, "polyChangePct": changePct,
			"polyVolume": volume, "polyImage": m.Image, "polySlug": m.Slug,
		})
		items = append(items, model.FeedItem{
			Source:      "polymarket",
			Title:       m.Question,
			Link:        url,
			Categories:  "[]",
			PubDate:     now.UTC().Format(time.RFC3339),
			DisplayDate: now.UTC().Format(time.RFC3339),
			Extra:       string(extra),
			FetchedAt:   nowUnix,
		})
	}
	return items, nil
}
