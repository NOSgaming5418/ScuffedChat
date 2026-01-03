package handlers

import (
	"encoding/json"
	"net/http"
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
// Note: Admin functions are handled client-side via Supabase JS client
// This endpoint is a placeholder for future server-side admin features
func GetAdminStats(w http.ResponseWriter, r *http.Request) {
	// Admin authentication is handled by Supabase client-side
	// This endpoint returns a placeholder response
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Admin stats should be fetched client-side via Supabase",
	})
}

// GetAllUsersWithEmails returns all users with their email addresses (admin only)
// Note: This is handled client-side via Supabase JS client with service role
func GetAllUsersWithEmails(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "User management should be handled client-side via Supabase",
	})
}

// DeleteUserAccount permanently deletes a user account (admin only)
// Note: This is handled client-side via Supabase JS client with service role
func DeleteUserAccount(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "User deletion should be handled client-side via Supabase",
	})
}
