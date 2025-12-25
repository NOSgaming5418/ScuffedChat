-- QUICK ADMIN SETUP - Run this in Supabase SQL Editor
-- Dashboard: https://supabase.com/dashboard/project/ulwlwrtedihujhpbuzvu/sql

-- Grant admin access to fazeboiz3125@gmail.com
UPDATE profiles 
SET is_admin = true 
WHERE id IN (
    SELECT id FROM auth.users 
    WHERE email = 'fazeboiz3125@gmail.com'
);

-- Also grant by username as backup
UPDATE profiles 
SET is_admin = true 
WHERE username = 'Nos';

-- Verify the admin was granted successfully
SELECT 
    p.id, 
    p.username, 
    p.is_admin, 
    au.email,
    p.created_at
FROM profiles p
LEFT JOIN auth.users au ON p.id = au.id
WHERE p.is_admin = true;

-- Expected result: You should see your account with is_admin = true
