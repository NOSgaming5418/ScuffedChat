package handlers

import (
	"encoding/json"
	"net/http"
	"os"

	"github.com/supabase-community/supabase-go"
)

type AdminStatsResponse struct {
	TotalUsers      int `json:"total_users"`
	TotalMessages   int `json:"total_messages"`
	ActiveChats     int `json:"active_chats"`
	PendingRequests int `json:"pending_requests"`
}

type UserManagementResponse struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	Email     string `json:"email"`
	IsAdmin   bool   `json:"is_admin"`
	CreatedAt string `json:"created_at"`
}

// GetAdminStats returns dashboard statistics
func GetAdminStats(w http.ResponseWriter, r *http.Request) {
	// Verify admin authentication
	userID := r.Context().Value("user_id")
	if userID == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, err := supabase.NewClient(os.Getenv("SUPABASE_URL"), os.Getenv("SUPABASE_SERVICE_ROLE_KEY"), nil)
	if err != nil {
		http.Error(w, "Server configuration error", http.StatusInternalServerError)
		return
	}

	// Verify admin status
	var profile struct {
		IsAdmin bool `json:"is_admin"`
	}
	err = client.DB.From("profiles").Select("is_admin", "1", false).Eq("id", userID.(string)).Single().Execute(&profile)
	if err != nil || !profile.IsAdmin {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}

	stats := AdminStatsResponse{}

	// Get total users
	var usersCount []map[string]interface{}
	client.DB.From("profiles").Select("*", "exact", true).Execute(&usersCount)
	stats.TotalUsers = len(usersCount)

	// Get total messages
	var messagesCount []map[string]interface{}
	client.DB.From("messages").Select("*", "exact", true).Execute(&messagesCount)
	stats.TotalMessages = len(messagesCount)

	// Get pending friend requests
	var requestsCount []map[string]interface{}
	client.DB.From("friends").Select("*", "exact", true).Eq("status", "pending").Execute(&requestsCount)
	stats.PendingRequests = len(requestsCount)

	// Calculate active chats (unique sender-receiver pairs)
	var messages []struct {
		SenderID   string `json:"sender_id"`
		ReceiverID string `json:"receiver_id"`
	}
	client.DB.From("messages").Select("sender_id,receiver_id", "", false).Execute(&messages)

	uniquePairs := make(map[string]bool)
	for _, msg := range messages {
		// Create a unique key for each conversation pair
		key := msg.SenderID + "-" + msg.ReceiverID
		reverseKey := msg.ReceiverID + "-" + msg.SenderID
		if !uniquePairs[reverseKey] {
			uniquePairs[key] = true
		}
	}
	stats.ActiveChats = len(uniquePairs)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

// GetAllUsersWithEmails returns all users with their email addresses (admin only)
func GetAllUsersWithEmails(w http.ResponseWriter, r *http.Request) {
	// Verify admin authentication
	userID := r.Context().Value("user_id")
	if userID == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, err := supabase.NewClient(os.Getenv("SUPABASE_URL"), os.Getenv("SUPABASE_SERVICE_ROLE_KEY"), nil)
	if err != nil {
		http.Error(w, "Server configuration error", http.StatusInternalServerError)
		return
	}

	// Verify admin status
	var profile struct {
		IsAdmin bool `json:"is_admin"`
	}
	err = client.DB.From("profiles").Select("is_admin", "1", false).Eq("id", userID.(string)).Single().Execute(&profile)
	if err != nil || !profile.IsAdmin {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}

	// Get all profiles
	var profiles []struct {
		ID        string `json:"id"`
		Username  string `json:"username"`
		IsAdmin   bool   `json:"is_admin"`
		CreatedAt string `json:"created_at"`
	}
	err = client.DB.From("profiles").Select("*", "", false).Order("created_at", &map[string]string{"ascending": "false"}).Execute(&profiles)
	if err != nil {
		http.Error(w, "Failed to fetch profiles", http.StatusInternalServerError)
		return
	}

	// Get emails from auth.users using admin API
	users := make([]UserManagementResponse, 0)
	for _, p := range profiles {
		user := UserManagementResponse{
			ID:        p.ID,
			Username:  p.Username,
			IsAdmin:   p.IsAdmin,
			CreatedAt: p.CreatedAt,
			Email:     "N/A", // Default
		}

		// Try to get email from auth API
		authUser, err := client.Auth.Admin.GetUserByID(p.ID)
		if err == nil && authUser != nil {
			user.Email = authUser.Email
		}

		users = append(users, user)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}

// DeleteUserAccount permanently deletes a user account (admin only)
func DeleteUserAccount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete && r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Verify admin authentication
	userID := r.Context().Value("user_id")
	if userID == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, err := supabase.NewClient(os.Getenv("SUPABASE_URL"), os.Getenv("SUPABASE_SERVICE_ROLE_KEY"), nil)
	if err != nil {
		http.Error(w, "Server configuration error", http.StatusInternalServerError)
		return
	}

	// Verify admin status
	var profile struct {
		IsAdmin bool `json:"is_admin"`
	}
	err = client.DB.From("profiles").Select("is_admin", "1", false).Eq("id", userID.(string)).Single().Execute(&profile)
	if err != nil || !profile.IsAdmin {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}

	// Get target user ID from request
	var req struct {
		UserID string `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.UserID == "" {
		http.Error(w, "user_id is required", http.StatusBadRequest)
		return
	}

	// Prevent admin from deleting themselves
	if req.UserID == userID.(string) {
		http.Error(w, "Cannot delete your own account", http.StatusBadRequest)
		return
	}

	// Delete the user from auth (this will cascade to profiles via FK)
	err = client.Auth.Admin.DeleteUser(req.UserID)
	if err != nil {
		http.Error(w, "Failed to delete user: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "User deleted successfully"})
}
