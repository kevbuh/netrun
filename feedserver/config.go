package main

import (
	"flag"
	"os"
)

type Config struct {
	Port   string
	DBPath string
}

func parseConfig() Config {
	port := flag.String("port", envOr("FEEDSERVER_PORT", "8400"), "HTTP listen port")
	dbPath := flag.String("db", envOr("FEEDSERVER_DB", "feedserver.db"), "SQLite database path")
	flag.Parse()
	return Config{Port: *port, DBPath: *dbPath}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
