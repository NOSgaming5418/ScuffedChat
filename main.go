package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"scuffedsnap/handlers"
	"scuffedsnap/pkg/push"

	"github.com/joho/godotenv"
)

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("⚠️  No .env file found, using environment variables")
	}

	// Get port from environment or use default
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Initialize Push Service
	push.InitPush()

	// Static files
	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("./static"))))

	// API endpoint for config
	http.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		config := map[string]string{
			"supabaseUrl":     os.Getenv("SUPABASE_URL"),
			"supabaseAnonKey": os.Getenv("SUPABASE_ANON_KEY"),
			"vapidPublicKey":  push.GetVapidPublicKey(),
		}
		json.NewEncoder(w).Encode(config)
	})

	// Webhook endpoint for Supabase
	http.HandleFunc("/api/notify", push.HandleNotify)

	// TEMPORARY: Debug endpoint to get VAPID keys for setup
	http.HandleFunc("/api/debug-keys", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		keys := map[string]string{
			"NOTE":              "COPY THESE VALUES TO YOUR VERCEL ENVIRONMENT VARIABLES IMMEDIATELY, THEN REMOVE THIS ENDPOINT",
			"VAPID_PRIVATE_KEY": push.GetVapidPrivateKey(),
			"VAPID_PUBLIC_KEY":  push.GetVapidPublicKey(),
		}
		json.NewEncoder(w).Encode(keys)
	})

	// HTML pages
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "./static/index.html")
	})
	http.HandleFunc("/app", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "./static/app.html")
	})
	http.HandleFunc("/admin", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "./static/admin.html")
	})

	// WebSocket endpoint for real-time features
	http.HandleFunc("/ws", handlers.HandleWebSocket)

	// Start WebSocket hub in background
	go handlers.RunHub()

	// Start server
	log.Printf("🚀 ScuffedSnap server starting on http://localhost:%s\n", port)
	log.Printf("📱 Open your browser and navigate to http://localhost:%s\n", port)
	log.Println("✅ Using Supabase for authentication and database")

	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
