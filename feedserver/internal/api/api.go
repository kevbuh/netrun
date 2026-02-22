package api

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"feedserver/internal/fetch"
	"feedserver/internal/model"
	"feedserver/internal/rank"
	"feedserver/internal/store"
)

type Server struct {
	store   *store.Store
	fetcher *fetch.Fetcher
	sources []model.Source
	catMap  rank.CatMap
	mux     *http.ServeMux
}

func NewServer(s *store.Store, f *fetch.Fetcher, sources []model.Source) *Server {
	srv := &Server{
		store:   s,
		fetcher: f,
		sources: sources,
		catMap:  rank.BuildCatMap(sources),
		mux:     http.NewServeMux(),
	}
	srv.routes()
	return srv
}

func (s *Server) Handler() http.Handler {
	return withCORS(s.mux)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/timeline", s.handleTimeline)
	s.mux.HandleFunc("POST /api/refresh", s.handleRefresh)
	s.mux.HandleFunc("GET /api/sources", s.handleListSources)
	s.mux.HandleFunc("POST /api/sources", s.handleAddSource)
	s.mux.HandleFunc("PUT /api/sources/{key}/toggle", s.handleToggleSource)
	s.mux.HandleFunc("POST /api/read", s.handleMarkRead)
	s.mux.HandleFunc("POST /api/save", s.handleSave)
	s.mux.HandleFunc("DELETE /api/save", s.handleUnsave)
	s.mux.HandleFunc("POST /api/hide", s.handleHide)
	s.mux.HandleFunc("POST /api/rate", s.handleRate)
	s.mux.HandleFunc("GET /api/saved", s.handleListSaved)
	s.mux.HandleFunc("GET /api/state", s.handleGetState)
	s.mux.HandleFunc("PUT /api/rank-params", s.handleUpdateRankParams)
	s.mux.HandleFunc("POST /api/sources/sync", s.handleSyncSourcePrefs)
	s.mux.HandleFunc("GET /api/rss-proxy", s.handleRSSProxy)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

const defaultUserID = "default"

func (s *Server) handleTimeline(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	sortBy := q.Get("sort")
	category := q.Get("category")
	search := q.Get("search")
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	if limit <= 0 {
		limit = 100
	}

	// Get all enabled source keys
	state, err := s.store.GetUserState(defaultUserID)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}

	// Get items from all sources (or filter by enabled)
	items, err := s.store.GetAllFeedItems(2000)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}

	jsonItems := rank.ItemsToJSON(items)
	result := rank.Rank(jsonItems, state, s.catMap, rank.Params{
		Sort:     sortBy,
		Category: category,
		Search:   search,
		Limit:    limit,
		Offset:   offset,
	})
	writeJSON(w, result)
}

func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	n := s.fetcher.RefreshAll()
	writeJSON(w, map[string]int{"fetched": n})
}

func (s *Server) handleListSources(w http.ResponseWriter, r *http.Request) {
	sources, err := s.store.ListSources()
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, sources)
}

func (s *Server) handleAddSource(w http.ResponseWriter, r *http.Request) {
	var src model.Source
	if err := json.NewDecoder(r.Body).Decode(&src); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}
	if src.Key == "" || src.Name == "" {
		writeError(w, 400, "key and name required")
		return
	}
	if err := s.store.UpsertSource(src); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	s.sources = append(s.sources, src)
	s.catMap[src.Key] = src.Cat
	s.fetcher.AddSource(src)
	// Trigger background refresh for the new source
	go s.fetcher.RefreshSources([]string{src.Key})
	writeJSON(w, src)
}

func (s *Server) handleToggleSource(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	enabled, err := s.store.ToggleSource(defaultUserID, key)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]any{"key": key, "enabled": enabled})
}

type linkBody struct {
	Link string `json:"link"`
}

func (s *Server) handleMarkRead(w http.ResponseWriter, r *http.Request) {
	var body linkBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Link == "" {
		writeError(w, 400, "link required")
		return
	}
	if err := s.store.MarkRead(defaultUserID, body.Link); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

func (s *Server) handleSave(w http.ResponseWriter, r *http.Request) {
	var body linkBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Link == "" {
		writeError(w, 400, "link required")
		return
	}
	if err := s.store.SavePost(defaultUserID, body.Link); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

func (s *Server) handleUnsave(w http.ResponseWriter, r *http.Request) {
	var body linkBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Link == "" {
		writeError(w, 400, "link required")
		return
	}
	if err := s.store.UnsavePost(defaultUserID, body.Link); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

func (s *Server) handleHide(w http.ResponseWriter, r *http.Request) {
	var body linkBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Link == "" {
		writeError(w, 400, "link required")
		return
	}
	if err := s.store.HidePost(defaultUserID, body.Link); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

func (s *Server) handleRate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Link   string `json:"link"`
		Rating int    `json:"rating"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Link == "" {
		writeError(w, 400, "link and rating required")
		return
	}
	if err := s.store.RatePost(defaultUserID, body.Link, body.Rating); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

func (s *Server) handleListSaved(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.GetSavedPosts(defaultUserID)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	jsonItems := rank.ItemsToJSON(items)
	writeJSON(w, map[string]any{"items": jsonItems})
}

func (s *Server) handleGetState(w http.ResponseWriter, r *http.Request) {
	state, err := s.store.GetUserState(defaultUserID)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, state)
}

func (s *Server) handleUpdateRankParams(w http.ResponseWriter, r *http.Request) {
	var params model.RankParams
	if err := json.NewDecoder(r.Body).Decode(&params); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}
	if err := s.store.UpdateRankParams(defaultUserID, params); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	log.Printf("updated rank params: %+v", params)
	writeJSON(w, params)
}

func (s *Server) handleSyncSourcePrefs(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Sources map[string]bool `json:"sources"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}
	if len(body.Sources) == 0 {
		writeJSON(w, map[string]string{"status": "ok"})
		return
	}
	if err := s.store.SetSourcePrefs(defaultUserID, body.Sources); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	log.Printf("synced %d source prefs", len(body.Sources))
	writeJSON(w, map[string]string{"status": "ok"})
}

func (s *Server) handleRSSProxy(w http.ResponseWriter, r *http.Request) {
	url := r.URL.Query().Get("url")
	if url == "" {
		writeError(w, 400, "url required")
		return
	}
	body, err := fetch.FetchURL(url, 15*time.Second)
	if err != nil {
		writeError(w, 502, "fetch failed: "+err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/xml; charset=utf-8")
	io.WriteString(w, body)
}
