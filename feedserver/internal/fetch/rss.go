package fetch

import (
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"feedserver/internal/model"
)

var (
	rssItemRe  = regexp.MustCompile(`(?is)<item>(.*?)</item>`)
	atomEntryRe = regexp.MustCompile(`(?is)<entry>(.*?)</entry>`)
	cdataRe    = regexp.MustCompile(`<!\[CDATA\[([\s\S]*?)\]\]>`)
	atomLinkRe = regexp.MustCompile(`(?i)<link[^>]*href="([^"]+)"`)
)

func tagContent(block, tag string) string {
	re := regexp.MustCompile(fmt.Sprintf(`(?is)<%s[^>]*>(.*?)</%s>`, tag, tag))
	m := re.FindStringSubmatch(block)
	if m == nil {
		return ""
	}
	s := cdataRe.ReplaceAllString(m[1], "$1")
	return strings.TrimSpace(s)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// ParseRSSItems parses RSS <item> or Atom <entry> blocks from XML.
func ParseRSSItems(xml, sourceKey string) []model.FeedItem {
	var items []model.FeedItem

	// Try RSS <item> first
	matches := rssItemRe.FindAllStringSubmatch(xml, -1)
	for _, m := range matches {
		block := m[1]
		title := tagContent(block, "title")
		link := tagContent(block, "link")
		if link == "" {
			link = tagContent(block, "guid")
		}
		if title == "" || link == "" {
			continue
		}
		pubDate := tagContent(block, "pubDate")
		if pubDate == "" {
			pubDate = tagContent(block, "dc:date")
		}
		if pubDate == "" {
			pubDate = tagContent(block, "published")
		}
		items = append(items, model.FeedItem{
			Source:      sourceKey,
			Title:       title,
			Link:        link,
			Authors:     firstNonEmpty(tagContent(block, "dc:creator"), tagContent(block, "author")),
			Categories:  "[]",
			Description: truncate(tagContent(block, "description"), 500),
			PubDate:     pubDate,
			DisplayDate: pubDate,
			Extra:       "{}",
		})
	}

	// If no RSS items, try Atom <entry>
	if len(items) == 0 {
		matches = atomEntryRe.FindAllStringSubmatch(xml, -1)
		for _, m := range matches {
			block := m[1]
			title := tagContent(block, "title")
			link := ""
			if lm := atomLinkRe.FindStringSubmatch(block); lm != nil {
				link = lm[1]
			}
			if link == "" {
				link = tagContent(block, "link")
			}
			if title == "" || link == "" {
				continue
			}
			author := tagContent(block, "name")
			if author == "" {
				author = tagContent(block, "author")
			}
			pubDate := tagContent(block, "published")
			if pubDate == "" {
				pubDate = tagContent(block, "updated")
			}
			desc := tagContent(block, "summary")
			if desc == "" {
				desc = tagContent(block, "content")
			}
			items = append(items, model.FeedItem{
				Source:      sourceKey,
				Title:       title,
				Link:        link,
				Authors:     author,
				Categories:  "[]",
				Description: truncate(desc, 500),
				PubDate:     pubDate,
				DisplayDate: pubDate,
				Extra:       "{}",
			})
		}
	}

	return items
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// FetchURL fetches a URL with timeout and returns the body as string.
func FetchURL(url string, timeout time.Duration) (string, error) {
	client := &http.Client{Timeout: timeout}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; FeedServer/1.0)")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(body), nil
}
