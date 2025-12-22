package handler

import (
	"net/http"
	"os"
)

// Handler is the serverless function entry point for Vercel
func Handler(w http.ResponseWriter, r *http.Request) {
	// Serve static files
	if r.URL.Path == "/" {
		serveFile(w, r, "static/index.html")
		return
	}

	if r.URL.Path == "/app" {
		serveFile(w, r, "static/app.html")
		return
	}

	// Handle static assets
	if len(r.URL.Path) > 8 && r.URL.Path[:8] == "/static/" {
		serveFile(w, r, r.URL.Path[1:]) // Remove leading /
		return
	}

	// Add API routes here if needed
	// For now, just serve the index for any other route
	serveFile(w, r, "static/index.html")
}

func serveFile(w http.ResponseWriter, r *http.Request, path string) {
	// Try to read the file
	data, err := os.ReadFile(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	// Set content type based on file extension
	contentType := getContentType(path)
	w.Header().Set("Content-Type", contentType)
	w.Write(data)
}

func getContentType(path string) string {
	if len(path) < 4 {
		return "text/plain"
	}

	ext := path[len(path)-4:]
	switch ext {
	case ".html", "html":
		return "text/html"
	case ".css", ".css":
		return "text/css"
	case ".js", "e.js":
		return "application/javascript"
	case ".json", "json":
		return "application/json"
	case ".png", ".png":
		return "image/png"
	case ".jpg", ".jpg", "jpeg":
		return "image/jpeg"
	case ".gif", ".gif":
		return "image/gif"
	case ".svg", ".svg":
		return "image/svg+xml"
	default:
		return "text/plain"
	}
}
