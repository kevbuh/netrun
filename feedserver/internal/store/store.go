package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"feedserver/internal/model"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func New(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	// WAL mode + pragmas
	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA synchronous=NORMAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA foreign_keys=ON",
	} {
		if _, err := db.Exec(pragma); err != nil {
			return nil, fmt.Errorf("pragma %s: %w", pragma, err)
		}
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS sources (
			key      TEXT PRIMARY KEY,
			name     TEXT NOT NULL,
			desc_    TEXT NOT NULL DEFAULT '',
			cat      TEXT NOT NULL DEFAULT '',
			url      TEXT NOT NULL DEFAULT '',
			special  TEXT NOT NULL DEFAULT '',
			favicon  TEXT NOT NULL DEFAULT '',
			enabled  INTEGER NOT NULL DEFAULT 1
		);

		CREATE TABLE IF NOT EXISTS feed_items (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			source       TEXT NOT NULL,
			title        TEXT NOT NULL,
			link         TEXT NOT NULL,
			authors      TEXT NOT NULL DEFAULT '',
			categories   TEXT NOT NULL DEFAULT '[]',
			description  TEXT NOT NULL DEFAULT '',
			pub_date     TEXT NOT NULL DEFAULT '',
			display_date TEXT NOT NULL DEFAULT '',
			arxiv_id     TEXT NOT NULL DEFAULT '',
			extra        TEXT NOT NULL DEFAULT '{}',
			fetched_at   INTEGER NOT NULL DEFAULT 0,
			UNIQUE(source, link)
		);

		CREATE INDEX IF NOT EXISTS idx_feed_items_source ON feed_items(source);
		CREATE INDEX IF NOT EXISTS idx_feed_items_pub_date ON feed_items(pub_date);

		CREATE TABLE IF NOT EXISTS users (
			id   TEXT PRIMARY KEY DEFAULT 'default'
		);

		CREATE TABLE IF NOT EXISTS user_read_posts (
			user_id TEXT NOT NULL DEFAULT 'default',
			link    TEXT NOT NULL,
			read_at INTEGER NOT NULL,
			PRIMARY KEY(user_id, link)
		);

		CREATE TABLE IF NOT EXISTS user_saved_posts (
			user_id  TEXT NOT NULL DEFAULT 'default',
			link     TEXT NOT NULL,
			saved_at INTEGER NOT NULL,
			PRIMARY KEY(user_id, link)
		);

		CREATE TABLE IF NOT EXISTS user_hidden_posts (
			user_id   TEXT NOT NULL DEFAULT 'default',
			link      TEXT NOT NULL,
			hidden_at INTEGER NOT NULL,
			PRIMARY KEY(user_id, link)
		);

		CREATE TABLE IF NOT EXISTS user_ratings (
			user_id TEXT NOT NULL DEFAULT 'default',
			link    TEXT NOT NULL,
			rating  INTEGER NOT NULL,
			PRIMARY KEY(user_id, link)
		);

		CREATE TABLE IF NOT EXISTS user_blocked_words (
			user_id TEXT NOT NULL DEFAULT 'default',
			word    TEXT NOT NULL,
			PRIMARY KEY(user_id, word)
		);

		CREATE TABLE IF NOT EXISTS user_source_prefs (
			user_id TEXT NOT NULL DEFAULT 'default',
			source  TEXT NOT NULL,
			enabled INTEGER NOT NULL DEFAULT 1,
			PRIMARY KEY(user_id, source)
		);

		CREATE TABLE IF NOT EXISTS user_rank_params (
			user_id            TEXT PRIMARY KEY DEFAULT 'default',
			weight_base        REAL NOT NULL DEFAULT 0.7,
			weight_affinity    REAL NOT NULL DEFAULT 0.3,
			weight_recency     REAL NOT NULL DEFAULT 1.0,
			weight_exploration REAL NOT NULL DEFAULT 0.10,
			max_per_cat_run    INTEGER NOT NULL DEFAULT 3
		);
	`)
	return err
}

// ── Sources ──

func (s *Store) UpsertSource(src model.Source) error {
	_, err := s.db.Exec(`
		INSERT INTO sources (key, name, desc_, cat, url, special, favicon)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			name=excluded.name, desc_=excluded.desc_, cat=excluded.cat,
			url=excluded.url, special=excluded.special, favicon=excluded.favicon
	`, src.Key, src.Name, src.Desc, src.Cat, src.URL, src.Special, src.Favicon)
	return err
}

func (s *Store) ListSources() ([]model.Source, error) {
	rows, err := s.db.Query("SELECT key, name, desc_, cat, url, special, favicon FROM sources ORDER BY key")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var sources []model.Source
	for rows.Next() {
		var src model.Source
		if err := rows.Scan(&src.Key, &src.Name, &src.Desc, &src.Cat, &src.URL, &src.Special, &src.Favicon); err != nil {
			return nil, err
		}
		sources = append(sources, src)
	}
	return sources, rows.Err()
}

func (s *Store) SourceCount() (int, error) {
	var n int
	err := s.db.QueryRow("SELECT COUNT(*) FROM sources").Scan(&n)
	return n, err
}

// ── Feed Items ──

func (s *Store) UpsertFeedItems(items []model.FeedItem) error {
	if len(items) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO feed_items (source, title, link, authors, categories, description, pub_date, display_date, arxiv_id, extra, fetched_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(source, link) DO UPDATE SET
			title=excluded.title, authors=excluded.authors, categories=excluded.categories,
			description=excluded.description, pub_date=excluded.pub_date, display_date=excluded.display_date,
			arxiv_id=excluded.arxiv_id, extra=excluded.extra, fetched_at=excluded.fetched_at
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, it := range items {
		if _, err := stmt.Exec(it.Source, it.Title, it.Link, it.Authors, it.Categories,
			it.Description, it.PubDate, it.DisplayDate, it.ArxivID, it.Extra, it.FetchedAt); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) GetFeedItems(sourceKeys []string, limit int) ([]model.FeedItem, error) {
	if len(sourceKeys) == 0 {
		return nil, nil
	}
	placeholders := make([]string, len(sourceKeys))
	args := make([]any, len(sourceKeys)+1)
	for i, k := range sourceKeys {
		placeholders[i] = "?"
		args[i] = k
	}
	args[len(sourceKeys)] = limit

	query := fmt.Sprintf(`
		SELECT id, source, title, link, authors, categories, description,
		       pub_date, display_date, arxiv_id, extra, fetched_at
		FROM feed_items
		WHERE source IN (%s)
		ORDER BY pub_date DESC
		LIMIT ?
	`, strings.Join(placeholders, ","))

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []model.FeedItem
	for rows.Next() {
		var it model.FeedItem
		if err := rows.Scan(&it.ID, &it.Source, &it.Title, &it.Link, &it.Authors,
			&it.Categories, &it.Description, &it.PubDate, &it.DisplayDate,
			&it.ArxivID, &it.Extra, &it.FetchedAt); err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

func (s *Store) GetAllFeedItems(limit int) ([]model.FeedItem, error) {
	rows, err := s.db.Query(`
		SELECT id, source, title, link, authors, categories, description,
		       pub_date, display_date, arxiv_id, extra, fetched_at
		FROM feed_items ORDER BY pub_date DESC LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []model.FeedItem
	for rows.Next() {
		var it model.FeedItem
		if err := rows.Scan(&it.ID, &it.Source, &it.Title, &it.Link, &it.Authors,
			&it.Categories, &it.Description, &it.PubDate, &it.DisplayDate,
			&it.ArxivID, &it.Extra, &it.FetchedAt); err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

func (s *Store) GetSourceFreshness(keys []string) (map[string]int64, error) {
	if len(keys) == 0 {
		return nil, nil
	}
	placeholders := make([]string, len(keys))
	args := make([]any, len(keys))
	for i, k := range keys {
		placeholders[i] = "?"
		args[i] = k
	}
	query := fmt.Sprintf(`
		SELECT source, MAX(fetched_at) FROM feed_items
		WHERE source IN (%s) GROUP BY source
	`, strings.Join(placeholders, ","))

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]int64)
	for rows.Next() {
		var source string
		var ts int64
		if err := rows.Scan(&source, &ts); err != nil {
			return nil, err
		}
		result[source] = ts
	}
	return result, rows.Err()
}

// ── User State ──

func (s *Store) MarkRead(userID, link string) error {
	_, err := s.db.Exec(`
		INSERT INTO user_read_posts (user_id, link, read_at) VALUES (?, ?, ?)
		ON CONFLICT DO NOTHING
	`, userID, link, time.Now().Unix())
	return err
}

func (s *Store) SavePost(userID, link string) error {
	_, err := s.db.Exec(`
		INSERT INTO user_saved_posts (user_id, link, saved_at) VALUES (?, ?, ?)
		ON CONFLICT DO NOTHING
	`, userID, link, time.Now().Unix())
	return err
}

func (s *Store) UnsavePost(userID, link string) error {
	_, err := s.db.Exec(`DELETE FROM user_saved_posts WHERE user_id=? AND link=?`, userID, link)
	return err
}

func (s *Store) HidePost(userID, link string) error {
	_, err := s.db.Exec(`
		INSERT INTO user_hidden_posts (user_id, link, hidden_at) VALUES (?, ?, ?)
		ON CONFLICT DO NOTHING
	`, userID, link, time.Now().Unix())
	return err
}

func (s *Store) RatePost(userID, link string, rating int) error {
	_, err := s.db.Exec(`
		INSERT INTO user_ratings (user_id, link, rating) VALUES (?, ?, ?)
		ON CONFLICT(user_id, link) DO UPDATE SET rating=excluded.rating
	`, userID, link, rating)
	return err
}

func (s *Store) GetSavedPosts(userID string) ([]model.FeedItem, error) {
	rows, err := s.db.Query(`
		SELECT fi.id, fi.source, fi.title, fi.link, fi.authors, fi.categories,
		       fi.description, fi.pub_date, fi.display_date, fi.arxiv_id, fi.extra, fi.fetched_at
		FROM feed_items fi
		JOIN user_saved_posts sp ON fi.link = sp.link AND sp.user_id = ?
		ORDER BY sp.saved_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []model.FeedItem
	for rows.Next() {
		var it model.FeedItem
		if err := rows.Scan(&it.ID, &it.Source, &it.Title, &it.Link, &it.Authors,
			&it.Categories, &it.Description, &it.PubDate, &it.DisplayDate,
			&it.ArxivID, &it.Extra, &it.FetchedAt); err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

func (s *Store) GetUserState(userID string) (*model.UserState, error) {
	state := &model.UserState{
		UserID:      userID,
		ReadPosts:   make(map[string]bool),
		SavedPosts:  make(map[string]int64),
		HiddenPosts: make(map[string]bool),
		Ratings:     make(map[string]int),
		SourcePrefs: make(map[string]bool),
		RankParams:  model.DefaultRankParams(),
	}

	// Read posts
	rows, err := s.db.Query("SELECT link FROM user_read_posts WHERE user_id=?", userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var link string
		rows.Scan(&link)
		state.ReadPosts[link] = true
	}
	rows.Close()

	// Saved posts
	rows, err = s.db.Query("SELECT link, saved_at FROM user_saved_posts WHERE user_id=?", userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var link string
		var ts int64
		rows.Scan(&link, &ts)
		state.SavedPosts[link] = ts
	}
	rows.Close()

	// Hidden posts
	rows, err = s.db.Query("SELECT link FROM user_hidden_posts WHERE user_id=?", userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var link string
		rows.Scan(&link)
		state.HiddenPosts[link] = true
	}
	rows.Close()

	// Ratings
	rows, err = s.db.Query("SELECT link, rating FROM user_ratings WHERE user_id=?", userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var link string
		var rating int
		rows.Scan(&link, &rating)
		state.Ratings[link] = rating
	}
	rows.Close()

	// Blocked words
	rows, err = s.db.Query("SELECT word FROM user_blocked_words WHERE user_id=?", userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var word string
		rows.Scan(&word)
		state.BlockedWords = append(state.BlockedWords, word)
	}
	rows.Close()

	// Source prefs
	rows, err = s.db.Query("SELECT source, enabled FROM user_source_prefs WHERE user_id=?", userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var source string
		var enabled int
		rows.Scan(&source, &enabled)
		state.SourcePrefs[source] = enabled == 1
	}
	rows.Close()

	// Rank params
	row := s.db.QueryRow("SELECT weight_base, weight_affinity, weight_recency, weight_exploration, max_per_cat_run FROM user_rank_params WHERE user_id=?", userID)
	row.Scan(&state.RankParams.WeightBase, &state.RankParams.WeightAffinity,
		&state.RankParams.WeightRecency, &state.RankParams.WeightExploration,
		&state.RankParams.MaxPerCategoryRun)

	return state, nil
}

func (s *Store) UpdateRankParams(userID string, params model.RankParams) error {
	_, err := s.db.Exec(`
		INSERT INTO user_rank_params (user_id, weight_base, weight_affinity, weight_recency, weight_exploration, max_per_cat_run)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			weight_base=excluded.weight_base, weight_affinity=excluded.weight_affinity,
			weight_recency=excluded.weight_recency, weight_exploration=excluded.weight_exploration,
			max_per_cat_run=excluded.max_per_cat_run
	`, userID, params.WeightBase, params.WeightAffinity, params.WeightRecency,
		params.WeightExploration, params.MaxPerCategoryRun)
	return err
}

func (s *Store) SetSourcePrefs(userID string, prefs map[string]bool) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(`
		INSERT INTO user_source_prefs (user_id, source, enabled) VALUES (?, ?, ?)
		ON CONFLICT(user_id, source) DO UPDATE SET enabled=excluded.enabled
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for source, enabled := range prefs {
		v := 0
		if enabled {
			v = 1
		}
		if _, err := stmt.Exec(userID, source, v); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) ToggleSource(userID, sourceKey string) (bool, error) {
	// Check current state
	var enabled int
	err := s.db.QueryRow("SELECT enabled FROM user_source_prefs WHERE user_id=? AND source=?", userID, sourceKey).Scan(&enabled)
	if err == sql.ErrNoRows {
		// First toggle: disable it (sources are enabled by default)
		_, err = s.db.Exec("INSERT INTO user_source_prefs (user_id, source, enabled) VALUES (?, ?, 0)", userID, sourceKey)
		return false, err
	}
	if err != nil {
		return false, err
	}
	newEnabled := 1 - enabled
	_, err = s.db.Exec("UPDATE user_source_prefs SET enabled=? WHERE user_id=? AND source=?", newEnabled, userID, sourceKey)
	return newEnabled == 1, err
}

// MapToJSON converts a FeedItem to API response format.
func MapToJSON(it model.FeedItem) model.FeedItemJSON {
	var cats []string
	json.Unmarshal([]byte(it.Categories), &cats)
	if cats == nil {
		cats = []string{}
	}

	var extra map[string]any
	json.Unmarshal([]byte(it.Extra), &extra)

	return model.FeedItemJSON{
		ID:          it.ID,
		Source:      it.Source,
		Title:       it.Title,
		Link:        it.Link,
		Authors:     it.Authors,
		Categories:  cats,
		Description: it.Description,
		PubDate:     it.PubDate,
		Date:        it.DisplayDate,
		ArxivID:     it.ArxivID,
		Extra:       extra,
	}
}
