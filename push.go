package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/gorilla/websocket"
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

type RealtimeMessage struct {
	Event   string `json:"event"`
	Payload struct {
		Type   string `json:"type"` // "INSERT"
		Record struct {
			ID         string    `json:"id"`
			SenderID   string    `json:"sender_id"`
			ReceiverID string    `json:"receiver_id"`
			Content    string    `json:"content"`
			Type       string    `json:"type"`
			CreatedAt  time.Time `json:"created_at"`
		} `json:"record"`
	} `json:"payload"`
}

type VapidKeys struct {
	PrivateKey string `json:"privateKey"`
	PublicKey  string `json:"publicKey"`
}

func InitPush() {
	// Try to load keys from .env or file, otherwise generate

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

func StartRealtimeListener() {
	supabaseURL := os.Getenv("SUPABASE_URL")
	// Use Service Role Key for Realtime if available to bypass RLS
	anonKey := os.Getenv("SUPABASE_ANON_KEY")
	serviceKey := os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	token := anonKey
	if serviceKey != "" {
		token = serviceKey
		log.Println("🔑 Using Service Role Key for Realtime (RLS Bypass)")
	} else {
		log.Println("⚠️  WARNING: Service Role Key missing. Realtime listener may fail to see new messages due to RLS.")
	}

	if supabaseURL == "" || token == "" {
		log.Println("❌ Supabase URL or Key missing, Realtime listener disabled")
		return
	}

	// Construct WebSocket URL
	wsURL := fmt.Sprintf("%s/realtime/v1/websocket?apikey=%s&vsn=1.0.0", supabaseURL, anonKey) // Connection auth often needs anon key in query param, but join payload needs auth token
	// Actually, the apikey in URL is usually the anon key key. Authentication happens in the channel join or access_token message.
	// But let's try using the token in URL too if anon fails.

	// Replace https:// with wss://
	if len(wsURL) > 8 && wsURL[:8] == "https://" {
		wsURL = "wss://" + wsURL[8:]
	}

	for {
		connectAndListen(wsURL, token)
		log.Println("Realtime disconnected, retrying in 5 seconds...")
		time.Sleep(5 * time.Second)
	}
}

func connectAndListen(wsURL, token string) {
	c, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		log.Println("Realtime connect error:", err)
		return
	}
	defer c.Close()

	log.Println("✅ Connected to Supabase Realtime")

	// 2. Define subscription config for INSERT on messages
	// The payload for subscription
	config := map[string]interface{}{
		"access_token": token, // Pass the token (Service Role Key) here for auth/RLS bypass
		"user_token":   token, // Include both just in case
		"config": map[string]interface{}{
			"postgres_changes": []map[string]interface{}{
				{
					"event":  "INSERT",
					"schema": "public",
					"table":  "messages",
				},
			},
		},
	}

	// 1. Join with config
	// Channel name can be anything for broadcast/presence, but for postgres_changes we typically use "realtime:public" or similar?
	// Actually "room_1" is fine as long as we send the config.
	channelName := "room_1"

	// Correct format: [Ref, Ref, Topic, Event, Payload]
	if err := c.WriteJSON([]interface{}{"1", "1", channelName, "phx_join", config}); err != nil {
		log.Println("Join error:", err)
		return
	}

	log.Printf("Listening for new messages on channel %s...", channelName)

	// Start heartbeat
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			if err := c.WriteJSON([]interface{}{nil, "5", "phoenix", "heartbeat", map[string]interface{}{}}); err != nil {
				return
			}
		}
	}()

	for {
		_, message, err := c.ReadMessage()
		if err != nil {
			log.Println("Read error:", err)
			return
		}

		// Parse message
		// Format: [join_ref, ref, topic, event, payload]
		var msg []interface{}
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}

		if len(msg) < 5 {
			continue
		}

		event, ok := msg[3].(string)
		if !ok {
			continue
		}

		if event == "postgres_changes" {
			// Handle change
			payloadMap, ok := msg[4].(map[string]interface{})
			if !ok {
				continue
			}

			data, ok := payloadMap["data"].(map[string]interface{})
			if !ok {
				continue
			}

			// Check if it's INSERT
			eventType, _ := data["type"].(string)
			if eventType != "INSERT" {
				continue
			}

			record, ok := data["record"].(map[string]interface{})
			if !ok {
				continue
			}

			handleNewMessage(record)
		}
	}
}

func handleNewMessage(record map[string]interface{}) {
	senderID, _ := record["sender_id"].(string)
	receiverID, _ := record["receiver_id"].(string)
	// Supabase returns numbers as float64 in generic interface{}, need to be careful if IDs are ints
	// But in db.go I saw user_id as int64. In Supabase JSON it might come as float64.
	// However, if the field is defined as UUID or hugeint in Supabase, checking string is safer.
	// Let's assume content is string.
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

	log.Printf("📩 New message for %s from %s", receiverID, senderID)

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
	// Use Service Role key if available to bypass RLS, otherwise anon key might work if RLS allows public read (unlikely)
	// IMPORTANT: RLS policy usually restricts reading others' subscriptions.
	// Ideally we need SERVICE_ROLE_KEY.
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
