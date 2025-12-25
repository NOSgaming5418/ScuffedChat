# Admin Setup Guide - ScuffedSnap

## Making Your Account an Admin

To grant admin access to your account (`fazeboiz3125@gmail.com` or username `Nos`), follow these steps:

### Step 1: Access Supabase SQL Editor

1. Go to your Supabase Dashboard: https://supabase.com/dashboard/project/ulwlwrtedihujhpbuzvu
2. Click on **SQL Editor** in the left sidebar
3. Click **New Query**

### Step 2: Run the Admin Grant SQL

Copy and paste the following SQL command and click **Run**:

```sql
-- Grant admin access by email
UPDATE profiles 
SET is_admin = true 
WHERE id IN (
    SELECT id FROM auth.users 
    WHERE email = 'fazeboiz3125@gmail.com'
);

-- OR Grant admin access by username (if you prefer)
UPDATE profiles 
SET is_admin = true 
WHERE username = 'Nos';

-- Verify it worked
SELECT p.id, p.username, p.is_admin, p.created_at, au.email
FROM profiles p
LEFT JOIN auth.users au ON p.id = au.id
WHERE p.is_admin = true;
```

### Step 3: Access the Admin Dashboard

1. Make sure you're logged in to ScuffedSnap
2. Navigate to: http://localhost:8080/admin
3. The admin dashboard should load with statistics and user management

## Admin Dashboard Features

### Current Features ✅

1. **Dashboard Statistics**
   - Total Users
   - Total Messages
   - Active Chats
   - Pending Friend Requests

2. **User Management**
   - View all users and their registration dates
   - See admin badge for admin users
   - Delete user accounts (with confirmation)
   - Search users by username

3. **Access Control**
   - Automatic redirect if not logged in
   - Access denied if user is not an admin
   - Cannot delete your own admin account

### Limitations ⚠️

- **Email addresses** are not directly accessible from the client for security reasons
- To view user emails, use: Supabase Dashboard → Authentication → Users
- To reset passwords, use the Supabase Dashboard

## How to Use the Admin Dashboard

### Viewing Statistics
The dashboard automatically loads and displays:
- Total registered users
- Total messages sent
- Number of active conversations
- Pending friend requests

### Managing Users

**To Delete a User:**
1. Find the user in the user list
2. Click the **Delete Account** button
3. Confirm the deletion (you'll need to confirm twice)
4. Type the exact username to confirm
5. The user and all their data will be permanently deleted

**Search Users:**
- Use the search box at the top of the user list
- Type any part of the username to filter

### Security Notes

- Only users with `is_admin = true` can access the admin dashboard
- Deleting a user will cascade delete:
  - Their profile
  - All their messages
  - All their friend connections
  - All their data
- You cannot delete your own admin account from the dashboard

## Troubleshooting

### "Access denied. Admin privileges required."

This means your account is not set as admin. Follow Step 1-2 above to grant admin access.

### "Failed to load users"

Check your Supabase connection in the browser console. Make sure:
- SUPABASE_URL is correct in `.env`
- SUPABASE_ANON_KEY is correct in `.env`
- The server is running (`go run main.go`)

### Cannot See Email Addresses

This is by design for security. Use the Supabase Dashboard to view emails:
1. Go to: https://supabase.com/dashboard/project/ulwlwrtedihujhpbuzvu/auth/users
2. You'll see all users with their emails

### Need to Reset a User's Password

1. Go to Supabase Dashboard → Authentication → Users
2. Find the user
3. Click the three dots (⋮) next to the user
4. Select "Send password recovery email" or "Set new password"

## Database Schema

The admin system uses the `is_admin` column in the `profiles` table:

```sql
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    username VARCHAR(30) UNIQUE NOT NULL,
    avatar VARCHAR(500) DEFAULT '',
    is_admin BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Quick SQL Commands

### Grant admin to a user
```sql
UPDATE profiles SET is_admin = true WHERE username = 'USERNAME';
```

### Remove admin from a user
```sql
UPDATE profiles SET is_admin = false WHERE username = 'USERNAME';
```

### List all admins
```sql
SELECT p.username, au.email, p.created_at 
FROM profiles p 
LEFT JOIN auth.users au ON p.id = au.id 
WHERE p.is_admin = true;
```

### Count total users
```sql
SELECT COUNT(*) as total_users FROM profiles;
```

### Count total messages
```sql
SELECT COUNT(*) as total_messages FROM messages;
```

## Future Enhancements

Potential features that could be added:
- [ ] Ban/suspend users temporarily
- [ ] View user activity logs
- [ ] Export user data
- [ ] Bulk user actions
- [ ] Message moderation
- [ ] Analytics and charts
- [ ] Email user management from admin panel
- [ ] Backend API endpoints for better security

---

**Need Help?** Check the Supabase documentation or contact support.
