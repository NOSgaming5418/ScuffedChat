package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"

	"scuffedsnap/middleware"
	"scuffedsnap/models"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for development
	},
}

// Client represents a WebSocket client
type Client struct {
	ID     int64
	Conn   *websocket.Conn
	Send   chan []byte
	UserID string // Changed to string for Supabase UUID compatibility
}

// Hub maintains the set of active clients
type Hub struct {
	clients    map[string]*Client // userID (string) -> client
	register   chan *Client
	unregister chan *Client
	broadcast  chan BroadcastPayload
	mutex      sync.RWMutex
}

type BroadcastPayload struct {
	UserID  string
	Message []byte
}

var hub = &Hub{
	clients:    make(map[string]*Client),
	register:   make(chan *Client),
	unregister: make(chan *Client),
	broadcast:  make(chan BroadcastPayload, 256),
}

// RunHub starts the WebSocket hub
func RunHub() {
	for {
		select {
		case client := <-hub.register:
			hub.mutex.Lock()
			hub.clients[client.UserID] = client
			hub.mutex.Unlock()
			log.Printf("Client connected: UserID %s", client.UserID)

			// Broadcast online status to friends
			broadcastOnlineStatus(client.UserID, true)

		case client := <-hub.unregister:
			hub.mutex.Lock()
			if _, ok := hub.clients[client.UserID]; ok {
				delete(hub.clients, client.UserID)
				close(client.Send)
			}
			hub.mutex.Unlock()
			log.Printf("Client disconnected: UserID %s", client.UserID)

			// Broadcast offline status to friends
			broadcastOnlineStatus(client.UserID, false)

		case payload := <-hub.broadcast:
			hub.mutex.RLock()
			if client, ok := hub.clients[payload.UserID]; ok {
				select {
				case client.Send <- payload.Message:
				default:
					close(client.Send)
					delete(hub.clients, payload.UserID)
				}
			}
			hub.mutex.RUnlock()
		}
	}
}

// IsUserOnline checks if a user is currently connected (string version for Supabase UUIDs)
func IsUserOnline(userID interface{}) bool {
	hub.mutex.RLock()
	defer hub.mutex.RUnlock()

	var idStr string
	switch v := userID.(type) {
	case string:
		idStr = v
	case int64:
		idStr = fmt.Sprintf("%d", v)
	default:
		idStr = fmt.Sprintf("%v", v)
	}

	_, ok := hub.clients[idStr]
	return ok
}

// BroadcastMessage sends a message to a specific user
func BroadcastMessage(userID interface{}, msg models.WebSocketMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Error marshaling message: %v", err)
		return
	}

	var idStr string
	switch v := userID.(type) {
	case string:
		idStr = v
	case int64:
		idStr = fmt.Sprintf("%d", v)
	default:
		idStr = fmt.Sprintf("%v", v)
	}

	hub.broadcast <- BroadcastPayload{
		UserID:  idStr,
		Message: data,
	}
}

// broadcastOnlineStatus notifies all connected clients about online status change
func broadcastOnlineStatus(userID string, online bool) {
	msg := models.WebSocketMessage{
		Type: "online_status",
		Payload: map[string]interface{}{
			"user_id": userID,
			"online":  online,
		},
	}

	data, _ := json.Marshal(msg)

	hub.mutex.RLock()
	for _, client := range hub.clients {
		if client.UserID != userID {
			select {
			case client.Send <- data:
			default:
			}
		}
	}
	hub.mutex.RUnlock()
}

// HandleWebSocket handles WebSocket connections
// For Supabase auth, the user_id is passed via query parameter
func HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	// Try to get user from middleware (for session-based auth)
	user := middleware.GetUserFromContext(r)
	var userID string

	if user != nil {
		// Session-based auth
		userID = fmt.Sprintf("%d", user.ID)
	} else {
		// Supabase auth - get user_id from query param
		userID = r.URL.Query().Get("user_id")
		if userID == "" {
			// Allow connection without auth for now (Supabase handles auth on API calls)
			// Generate a temporary ID based on connection
			log.Println("WebSocket: No user_id provided, allowing anonymous connection")
		}
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	client := &Client{
		Conn:   conn,
		Send:   make(chan []byte, 256),
		UserID: userID,
	}

	hub.register <- client

	// Start goroutines for reading and writing
	go client.writePump()
	go client.readPump()
}

func (c *Client) readPump() {
	defer func() {
		hub.unregister <- c
		c.Conn.Close()
	}()

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		// Handle incoming messages (typing indicators, etc.)
		var wsMsg models.WebSocketMessage
		if err := json.Unmarshal(message, &wsMsg); err != nil {
			continue
		}

		switch wsMsg.Type {
		case "typing":
			// Forward typing indicator to recipient
			if payload, ok := wsMsg.Payload.(map[string]interface{}); ok {
				if recipientID, ok := payload["recipient_id"].(string); ok {
					BroadcastMessage(recipientID, models.WebSocketMessage{
						Type: "typing",
						Payload: map[string]interface{}{
							"user_id": c.UserID,
							"typing":  payload["typing"],
						},
					})
				}
			}
		}
	}
}

func (c *Client) writePump() {
	defer c.Conn.Close()

	for message := range c.Send {
		if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
			return
		}
	}
}
