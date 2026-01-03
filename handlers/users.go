package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// GetOnlineUsers returns which of the requested user IDs are currently online
func GetOnlineUsers(w http.ResponseWriter, r *http.Request) {
	// Get comma-separated list of user IDs from query param
	idsParam := r.URL.Query().Get("ids")
	if idsParam == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"online_users": []string{},
		})
		return
	}

	// Split into individual IDs
	requestedIDs := strings.Split(idsParam, ",")

	// Check which ones are online using the hub
	onlineIDs := []int64{}
	for _, idStr := range requestedIDs {
		// Try to parse as int64
		var id int64
		if _, err := fmt.Sscanf(strings.TrimSpace(idStr), "%d", &id); err == nil {
			if IsUserOnline(id) {
				onlineIDs = append(onlineIDs, id)
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"online_users": onlineIDs,
	})
}
