-- ScuffedChat Complete Database Schema (Consolidated)
-- Compatible with Supabase AND Standard PostgreSQL (Self-Hosted)

-- ========================================
-- 0. COMPATIBILITY LAYER (For Vanilla Postgres)
-- ========================================

-- Create schemas if they don't exist (Standard Postgres doesn't have 'auth' or 'storage' by default)
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

-- Create roles if they don't exist (Supabase specific roles)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      CREATE ROLE service_role NOLOGIN; -- Bypass RLS
  END IF;
END
$$;

-- Grant permissions to new roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon, authenticated, service_role;

-- Create auth.users table if it doesn't exist (Simplified mock for foreign keys)
CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE,
    encrypted_password VARCHAR(255),
    email_confirmed_at TIMESTAMPTZ,
    invited_at TIMESTAMPTZ,
    confirmation_token VARCHAR(255),
    recovery_token VARCHAR(255),
    email_change_token_new VARCHAR(255),
    email_change VARCHAR(255),
    last_sign_in_at TIMESTAMPTZ,
    raw_app_meta_data JSONB,
    raw_user_meta_data JSONB,
    is_super_admin BOOLEAN,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

-- Mock auth.uid() function if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'uid' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'auth')) THEN
        CREATE FUNCTION auth.uid() RETURNS uuid AS 'SELECT NULL::uuid;' LANGUAGE sql;
    END IF;
END $$;

-- Create storage tables if they don't exist
CREATE TABLE IF NOT EXISTS storage.buckets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    public BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS storage.objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id TEXT REFERENCES storage.buckets(id),
    name TEXT,
    owner UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB,
    path_tokens TEXT[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED
);

-- Mock storage.foldername function
CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[] LANGUAGE sql AS $$
SELECT string_to_array(name, '/');
$$;

-- Ensure supabase_realtime publication exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

-- ========================================
-- 1. CREATE TABLES
-- ========================================

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username VARCHAR(30) UNIQUE NOT NULL,
    email VARCHAR(255),
    avatar VARCHAR(500) DEFAULT '',
    is_admin BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add email column if it doesn't exist (migrations safe)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='profiles' AND column_name='email') THEN
        ALTER TABLE profiles ADD COLUMN email VARCHAR(255);
    END IF;
END $$;

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    receiver_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    group_id BIGINT REFERENCES group_chats(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    type VARCHAR(10) DEFAULT 'text' CHECK (type IN ('text', 'image')),
    edited BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create group_chats table
CREATE TABLE IF NOT EXISTS group_chats (
    id BIGSERIAL PRIMARY KEY,
    creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    avatar VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create group_members table
CREATE TABLE IF NOT EXISTS group_members (
    id BIGSERIAL PRIMARY KEY,
    group_id BIGINT NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(group_id, member_id)
);

-- Create friends table
CREATE TABLE IF NOT EXISTS friends (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    friend_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status VARCHAR(10) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'blocked')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, friend_id)
);

-- Create push_subscriptions table
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(user_id, endpoint)
);

-- ========================================
-- 2. CREATE INDEXES
-- ========================================

CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends(friend_id);
CREATE INDEX IF NOT EXISTS idx_friends_composite ON friends(user_id, friend_id, status);
CREATE INDEX IF NOT EXISTS idx_group_chats_creator ON group_chats(creator_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_member ON group_members(member_id);
CREATE INDEX IF NOT EXISTS idx_group_members_composite ON group_members(group_id, member_id);

-- ========================================
-- 3. ENABLE ROW LEVEL SECURITY
-- ========================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

-- ========================================
-- 4. PROFILES RLS POLICIES
-- ========================================

DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;
CREATE POLICY "Users can view all profiles" ON profiles
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
CREATE POLICY "Users can insert their own profile" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- ========================================
-- 5. MESSAGES RLS POLICIES
-- ========================================

DROP POLICY IF EXISTS "Users can view their own messages" ON messages;
CREATE POLICY "Users can view their own messages" ON messages
    FOR SELECT USING (
        auth.uid() = sender_id 
        OR auth.uid() = receiver_id
        OR (
            group_id IS NOT NULL AND auth.uid() IN (
                SELECT member_id FROM group_members WHERE group_id = messages.group_id
            )
        )
    );

DROP POLICY IF EXISTS "Users can send messages" ON messages;
CREATE POLICY "Users can send messages" ON messages
    FOR INSERT WITH CHECK (
        auth.uid() = sender_id
        AND (
            receiver_id IS NOT NULL 
            OR (
                group_id IS NOT NULL AND auth.uid() IN (
                    SELECT member_id FROM group_members WHERE group_id = messages.group_id
                )
            )
        )
    );

DROP POLICY IF EXISTS "Users can update messages they received (mark as read)" ON messages;
CREATE POLICY "Users can update messages they received (mark as read)" ON messages
    FOR UPDATE USING (auth.uid() = receiver_id);

DROP POLICY IF EXISTS "Users can update messages they sent (edit content)" ON messages;
CREATE POLICY "Users can update messages they sent (edit content)" ON messages
    FOR UPDATE USING (auth.uid() = sender_id);

DROP POLICY IF EXISTS "Users can delete messages they sent" ON messages;
CREATE POLICY "Users can delete messages they sent" ON messages
    FOR DELETE USING (auth.uid() = sender_id);

-- ========================================
-- 6. FRIENDS RLS POLICIES
-- ========================================

DROP POLICY IF EXISTS "Users can view their friendships" ON friends;
CREATE POLICY "Users can view their friendships" ON friends
    FOR SELECT USING (auth.uid() = user_id OR auth.uid() = friend_id);

DROP POLICY IF EXISTS "Users can send friend requests" ON friends;
CREATE POLICY "Users can send friend requests" ON friends
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update friend requests sent to them" ON friends;
CREATE POLICY "Users can update friend requests sent to them" ON friends
    FOR UPDATE USING (auth.uid() = friend_id);

DROP POLICY IF EXISTS "Users can delete their friendships" ON friends;
CREATE POLICY "Users can delete their friendships" ON friends
    FOR DELETE USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- ========================================
-- 7. GROUP CHATS RLS POLICIES
-- ========================================

DROP POLICY IF EXISTS "Users can view groups they are members of" ON group_chats;
CREATE POLICY "Users can view groups they are members of" ON group_chats
    FOR SELECT USING (
        auth.uid() IN (
            SELECT member_id FROM group_members WHERE group_id = group_chats.id
        )
    );

DROP POLICY IF EXISTS "Users can create groups" ON group_chats;
CREATE POLICY "Users can create groups" ON group_chats
    FOR INSERT WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Group creators can update their groups" ON group_chats;
CREATE POLICY "Group creators can update their groups" ON group_chats
    FOR UPDATE USING (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Group creators can delete their groups" ON group_chats;
CREATE POLICY "Group creators can delete their groups" ON group_chats
    FOR DELETE USING (auth.uid() = creator_id);

-- ========================================
-- 8. GROUP MEMBERS RLS POLICIES
-- ========================================

DROP POLICY IF EXISTS "Users can view members of groups they are in" ON group_members;
CREATE POLICY "Users can view members of groups they are in" ON group_members
    FOR SELECT USING (
        auth.uid() IN (
            SELECT member_id FROM group_members WHERE group_id = group_members.group_id
        )
    );

DROP POLICY IF EXISTS "Group creators can add members" ON group_members;
CREATE POLICY "Group creators can add members" ON group_members
    FOR INSERT WITH CHECK (
        auth.uid() IN (
            SELECT creator_id FROM group_chats WHERE id = group_id
        )
    );

DROP POLICY IF EXISTS "Group creators can remove members" ON group_members;
CREATE POLICY "Group creators can remove members" ON group_members
    FOR DELETE USING (
        auth.uid() IN (
            SELECT creator_id FROM group_chats WHERE id = group_members.group_id
        ) OR auth.uid() = member_id
    );

-- ========================================
-- 9. PUSH NOTIFICATIONS RLS POLICIES
-- ========================================

DROP POLICY IF EXISTS "Users can view their own subscriptions" ON push_subscriptions;
CREATE POLICY "Users can view their own subscriptions" ON push_subscriptions
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own subscriptions" ON push_subscriptions;
CREATE POLICY "Users can insert their own subscriptions" ON push_subscriptions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own subscriptions" ON push_subscriptions;
CREATE POLICY "Users can delete their own subscriptions" ON push_subscriptions
    FOR DELETE USING (auth.uid() = user_id);

-- Allow service role (backend) to read all subscriptions
DROP POLICY IF EXISTS "Service role can read all subscriptions" ON push_subscriptions;
CREATE POLICY "Service role can read all subscriptions" ON push_subscriptions
    FOR SELECT USING (true);

-- ========================================
-- 10. ENABLE REALTIME
-- ========================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'messages') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE messages;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'friends') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE friends;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'group_chats') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE group_chats;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'group_members') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE group_members;
    END IF;
END $$;

-- ========================================
-- 11. STORAGE BUCKET FOR AVATARS
-- ========================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- ========================================
-- 12. STORAGE RLS POLICIES FOR AVATARS
-- ========================================

-- Drop existing policies if they exist (to ensure updates)
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;

-- Create new policies
CREATE POLICY "Avatar images are publicly accessible"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'avatars' 
    AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update their own avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'avatars' 
    AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete their own avatar"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'avatars' 
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- ========================================
-- 13. UTILITY FUNCTIONS
-- ========================================

-- Automatic cleanup function for expired messages
CREATE OR REPLACE FUNCTION delete_expired_messages()
RETURNS void AS $$
BEGIN
    DELETE FROM messages 
    WHERE expires_at IS NOT NULL 
    AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- DONE
-- ========================================
