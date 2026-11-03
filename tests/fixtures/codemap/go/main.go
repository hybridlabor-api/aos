package main

import (
	"net/http"
)

func main() {
	http.HandleFunc("/api/go/users", func(w http.ResponseWriter, r *http.Request) {})
	http.HandleFunc("/api/go/users/", func(w http.ResponseWriter, r *http.Request) {})
}
