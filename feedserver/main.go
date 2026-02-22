package main

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"feedserver/internal/api"
	"feedserver/internal/fetch"
	"feedserver/internal/store"
)

func main() {
	cfg := parseConfig()

	// Open database
	db, err := store.New(cfg.DBPath)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer db.Close()

	// Seed catalog
	for _, src := range SeedCatalog {
		if err := db.UpsertSource(src); err != nil {
			log.Fatalf("seed source %s: %v", src.Key, err)
		}
	}
	count, _ := db.SourceCount()
	log.Printf("seeded %d sources", count)

	// Create fetcher
	fetcher := fetch.NewFetcher(db, SeedCatalog)

	// Initial background refresh
	go func() {
		log.Println("starting initial feed refresh...")
		n := fetcher.RefreshAll()
		log.Printf("initial refresh complete: %d items", n)
	}()

	// Periodic refresh every 10 minutes
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			log.Println("periodic refresh starting...")
			n := fetcher.RefreshAll()
			log.Printf("periodic refresh complete: %d items", n)
		}
	}()

	// Start HTTP server
	srv := api.NewServer(db, fetcher, SeedCatalog)
	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("listening on %s", addr)
	if err := http.ListenAndServe(addr, srv.Handler()); err != nil {
		log.Fatalf("server: %v", err)
	}
}
