package push

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

var (
	vapidPrivateKey string
	vapidPublicKey  string
)

type PushSubscriptionStruct struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

type VapidKeys struct {
	PrivateKey string `json:"privateKey"`
	PublicKey  string `json:"publicKey"`
}

type WebhookPayload struct {
	Type   string                 `json:"type"`
	Table  string                 `json:"table"`
	Record map[string]interface{} `json:"record"`
	Schema string                 `json:"schema"`
}

// Initialize Push Notifications
func InitPush() {
	// Check env first
	vapidPrivateKey = os.Getenv("VAPID_PRIVATE_KEY")
	vapidPublicKey = os.Getenv("VAPID_PUBLIC_KEY")

	// If not in env, check file
	if vapidPrivateKey == "" || vapidPublicKey == "" {
		fileKeys, err := loadVapidKeysFromFile()
		if err == nil {
			vapidPrivateKey = fileKeys.PrivateKey
			vapidPublicKey = fileKeys.PublicKey
			log.Println("✅ Loaded VAPID keys from vapid_keys.json")
		}
	}

	if vapidPrivateKey == "" || vapidPublicKey == "" {
		privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
		if err != nil {
			log.Fatal("Failed to generate VAPID keys:", err)
		}
		vapidPrivateKey = privateKey
		vapidPublicKey = publicKey

		log.Println("⚠️  GENERATED NEW VAPID KEYS")

		// Save to file for persistence (if possible)
		err = saveVapidKeysToFile(vapidPrivateKey, vapidPublicKey)
		if err != nil {
			log.Println("⚠️  Could not save keys to file (likely read-only fs):", err)
			log.Println("⚠️  YOU MUST SET THE FOLLOWING ENV VARS IN YOUR DEPLOYMENT SETTINGS TO PERSIST KEYS:")
		} else {
			log.Println("✅ Saved new VAPID keys to vapid_keys.json")
			log.Println("Add these to your .env file to persist them (optional since we saved to file):")
		}

		fmt.Printf("VAPID_PRIVATE_KEY=%s\n", vapidPrivateKey)
		fmt.Printf("VAPID_PUBLIC_KEY=%s\n", vapidPublicKey)
	}
}

func loadVapidKeysFromFile() (*VapidKeys, error) {
	file, err := os.Open("vapid_keys.json")
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var keys VapidKeys
	if err := json.NewDecoder(file).Decode(&keys); err != nil {
		return nil, err
	}
	return &keys, nil
}

func saveVapidKeysToFile(privateKey, publicKey string) error {
	keys := VapidKeys{
		PrivateKey: privateKey,
		PublicKey:  publicKey,
	}

	file, err := os.Create("vapid_keys.json")
	if err != nil {
		return err
	}
	defer file.Close()

	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	return encoder.Encode(keys)
}

func GetVapidPublicKey() string {
	return vapidPublicKey
}

func GetVapidPrivateKey() string {
	return vapidPrivateKey
}

// HandleNotify handles the Webhook request from Supabase
func HandleNotify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Secret validation (Optional but recommended)
	// serviceRoleKey := os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	// if r.Header.Get("Authorization") != "Bearer "+serviceRoleKey {
	// 	// Note: Supabase Webhooks might not send this header by default unless configured
	// }

	var payload WebhookPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		log.Println("Webhook decode error:", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	// Filter for INSERT events on messages table
	if payload.Type != "INSERT" || payload.Table != "messages" {
		w.WriteHeader(http.StatusOK) // Ignore other events
		return
	}

	record := payload.Record

	// Run logic in goroutine to respond quickly to webhook
	go handleNewMessage(record)

	w.WriteHeader(http.StatusOK)
}

func handleNewMessage(record map[string]interface{}) {
	senderID, _ := record["sender_id"].(string)
	receiverID, _ := record["receiver_id"].(string)

	content, _ := record["content"].(string)
	msgType, _ := record["type"].(string)

	if receiverID == "" {
		// Try converting from float64 if it's a number
		if ridFloat, ok := record["receiver_id"].(float64); ok {
			receiverID = fmt.Sprintf("%.0f", ridFloat)
		}
	}
	if senderID == "" {
		// Try converting from float64 if it's a number
		if sidFloat, ok := record["sender_id"].(float64); ok {
			senderID = fmt.Sprintf("%.0f", sidFloat)
		}
	}

	if receiverID == "" {
		return
	}

	log.Printf("📩 Webhook: New message for %s from %s", receiverID, senderID)
	// Retrieve subscriptions for receiverID from Supabase
	subscriptions, err := getSubscriptionsFromSupabase(receiverID)
	if err != nil {
		log.Println("Failed to get subscriptions:", err)
		return
	}

	for _, sub := range subscriptions {
		go sendPushNamespace(sub, content, msgType)
	}
}

func getSubscriptionsFromSupabase(userID string) ([]PushSubscriptionStruct, error) {
	supabaseURL := os.Getenv("SUPABASE_URL")
	anonKey := os.Getenv("SUPABASE_ANON_KEY")
	// Use Service Role key if available to bypass RLS
	serviceKey := os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	key := anonKey
	if serviceKey != "" {
		key = serviceKey
	} else {
		log.Println("⚠️  WARNING: Service Role Key missing, may fail to read subscriptions due to RLS")
	}

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", fmt.Sprintf("%s/rest/v1/push_subscriptions?user_id=eq.%s&select=endpoint,auth,p256dh", supabaseURL, userID), nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("apikey", key)
	req.Header.Set("Authorization", "Bearer "+key)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("supabase api error: %d", resp.StatusCode)
	}

	var subs []struct {
		Endpoint string `json:"endpoint"`
		Auth     string `json:"auth"`
		P256dh   string `json:"p256dh"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&subs); err != nil {
		return nil, err
	}

	var result []PushSubscriptionStruct
	for _, s := range subs {
		result = append(result, PushSubscriptionStruct{
			Endpoint: s.Endpoint,
			Keys: struct {
				P256dh string `json:"p256dh"`
				Auth   string `json:"auth"`
			}{
				P256dh: s.P256dh,
				Auth:   s.Auth,
			},
		})
	}

	return result, nil
}

func sendPushNamespace(sub PushSubscriptionStruct, content, msgType string) {
	if msgType == "image" {
		content = "Sent an image"
	} else {
		// Truncate
		if len(content) > 50 {
			content = content[:50] + "..."
		}
	}

	s := &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys: webpush.Keys{
			P256dh: sub.Keys.P256dh,
			Auth:   sub.Keys.Auth,
		},
	}

	// Send Notification
	payload, _ := json.Marshal(map[string]string{
		"title": "New Message",
		"body":  content,
		"url":   "/app", // Open app
	})

	resp, err := webpush.SendNotification(payload, s, &webpush.Options{
		Subscriber:      "mailto:pazeb@example.com", // Should be real email
		VAPIDPublicKey:  vapidPublicKey,
		VAPIDPrivateKey: vapidPrivateKey,
		TTL:             30,
	})
	if err != nil {
		log.Println("Push error:", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == 410 || resp.StatusCode == 401 || resp.StatusCode == 403 {
		// Delete subscription i it's gone or invalid
		log.Printf("Subscription invalid (Status %d), deleting...", resp.StatusCode)
		deleteSubscriptionFromSupabase(sub.Endpoint)
	}
}

func deleteSubscriptionFromSupabase(endpoint string) {
	// Similar to get, use DELETE on REST API
	// Need Service Role Key ideally
	supabaseURL := os.Getenv("SUPABASE_URL")
	serviceKey := os.Getenv("SUPABASE_SERVICE_ROLE_KEY")

	if serviceKey == "" {
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("DELETE", fmt.Sprintf("%s/rest/v1/push_subscriptions?endpoint=eq.%s", supabaseURL, endpoint), nil)
	if err != nil {
		return
	}

	req.Header.Set("apikey", serviceKey)
	req.Header.Set("Authorization", "Bearer "+serviceKey)

	client.Do(req)
}
