package main

import (
	"net/http"
)

func main() {
	http.HandleFunc("/api/go/users", func(w http.ResponseWriter, r *http.Request) {})
	http.HandleFunc("/api/go/users/", func(w http.ResponseWriter, r *http.Request) {})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v2/items/{id}", func(w http.ResponseWriter, r *http.Request) {})
	r.HandleFunc("POST /api/v2/items", func(w http.ResponseWriter, r *http.Request) {})
}
