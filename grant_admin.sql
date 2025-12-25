-- Grant admin access to your account (by username or email)
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)

-- Method 1: Grant admin by username
UPDATE profiles 
SET is_admin = true 
WHERE username = 'Nos';

-- Method 2: Grant admin by email (must join with auth.users)
UPDATE profiles 
SET is_admin = true 
WHERE id IN (
    SELECT id FROM auth.users 
    WHERE email = 'fazeboiz3125@gmail.com'
);

-- Verify admin status
SELECT p.id, p.username, p.is_admin, p.created_at, au.email
FROM profiles p
LEFT JOIN auth.users au ON p.id = au.id
WHERE p.is_admin = true;
