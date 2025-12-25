-- Add email column to profiles table to enable username login
-- Run this in your Supabase SQL Editor

-- Add email column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

-- Optional: Backfill existing profiles with email from auth.users
-- This will populate email for existing users
UPDATE profiles 
SET email = auth.users.email 
FROM auth.users 
WHERE profiles.id = auth.users.id 
AND profiles.email IS NULL;

-- Make email required for future inserts (optional, but recommended)
-- ALTER TABLE profiles ALTER COLUMN email SET NOT NULL;
