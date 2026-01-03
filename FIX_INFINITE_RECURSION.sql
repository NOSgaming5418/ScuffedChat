-- ============================================
-- FIX: Infinite Recursion in Group RLS Policies
-- ============================================
-- 
-- Problem: The RLS policies for group_members and group_chats reference
-- each other creating infinite recursion:
--   - group_members SELECT → checks if user is in group_members
--   - group_chats SELECT → checks if user is in group_members
--   - This causes a loop when Supabase evaluates the policies
--
-- Solution: Use SECURITY DEFINER functions that bypass RLS to check membership
-- ============================================

-- Step 1: Create a helper function to check group membership (bypasses RLS)
CREATE OR REPLACE FUNCTION is_group_member(check_group_id BIGINT, check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM group_members 
        WHERE group_id = check_group_id 
        AND member_id = check_user_id
    );
$$;

-- Step 2: Create a helper function to check if user is group creator (bypasses RLS)
CREATE OR REPLACE FUNCTION is_group_creator(check_group_id BIGINT, check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM group_chats 
        WHERE id = check_group_id 
        AND creator_id = check_user_id
    );
$$;

-- Step 3: Create a helper function to get group_id from group_chats (bypasses RLS)
CREATE OR REPLACE FUNCTION get_group_creator(check_group_id BIGINT)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT creator_id FROM group_chats WHERE id = check_group_id;
$$;

-- ============================================
-- Step 4: Drop ALL existing group_members policies
-- ============================================

DROP POLICY IF EXISTS "Users can view members of groups they are in" ON group_members;
DROP POLICY IF EXISTS "Group creators can add members" ON group_members;
DROP POLICY IF EXISTS "Group creators can remove members" ON group_members;
DROP POLICY IF EXISTS "Members can leave groups" ON group_members;
DROP POLICY IF EXISTS "Users can add themselves to groups" ON group_members;

-- ============================================
-- Step 5: Create NEW group_members policies (using helper functions)
-- ============================================

-- SELECT: Users can view members of groups they belong to
CREATE POLICY "group_members_select_policy" ON group_members
    FOR SELECT USING (
        is_group_member(group_id, auth.uid())
        OR is_group_creator(group_id, auth.uid())
    );

-- INSERT: Users can add themselves OR creators can add others
CREATE POLICY "group_members_insert_policy" ON group_members
    FOR INSERT WITH CHECK (
        auth.uid() = member_id
        OR get_group_creator(group_id) = auth.uid()
    );

-- DELETE: Users can remove themselves OR creators can remove others
CREATE POLICY "group_members_delete_policy" ON group_members
    FOR DELETE USING (
        auth.uid() = member_id
        OR get_group_creator(group_id) = auth.uid()
    );

-- ============================================
-- Step 6: Drop ALL existing group_chats policies
-- ============================================

DROP POLICY IF EXISTS "Users can view groups they are in" ON group_chats;
DROP POLICY IF EXISTS "Users can view groups they are members of" ON group_chats;
DROP POLICY IF EXISTS "Group creators can view their groups" ON group_chats;
DROP POLICY IF EXISTS "Authenticated users can create groups" ON group_chats;
DROP POLICY IF EXISTS "Users can create groups" ON group_chats;
DROP POLICY IF EXISTS "Group creators can update groups" ON group_chats;
DROP POLICY IF EXISTS "Group creators can update their groups" ON group_chats;
DROP POLICY IF EXISTS "Group creators can delete groups" ON group_chats;
DROP POLICY IF EXISTS "Group creators can delete their groups" ON group_chats;

-- ============================================
-- Step 7: Create NEW group_chats policies (using helper functions)
-- ============================================

-- SELECT: Users can view groups they are members of OR created
CREATE POLICY "group_chats_select_policy" ON group_chats
    FOR SELECT USING (
        auth.uid() = creator_id
        OR is_group_member(id, auth.uid())
    );

-- INSERT: Authenticated users can create groups (must be the creator)
CREATE POLICY "group_chats_insert_policy" ON group_chats
    FOR INSERT WITH CHECK (auth.uid() = creator_id);

-- UPDATE: Only creators can update their groups
CREATE POLICY "group_chats_update_policy" ON group_chats
    FOR UPDATE USING (auth.uid() = creator_id);

-- DELETE: Only creators can delete their groups
CREATE POLICY "group_chats_delete_policy" ON group_chats
    FOR DELETE USING (auth.uid() = creator_id);

-- ============================================
-- Step 8: Fix push_subscriptions policies for UPSERT
-- ============================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own subscriptions" ON push_subscriptions;
DROP POLICY IF EXISTS "Users can insert their own subscriptions" ON push_subscriptions;
DROP POLICY IF EXISTS "Users can update their own subscriptions" ON push_subscriptions;
DROP POLICY IF EXISTS "Users can delete their own subscriptions" ON push_subscriptions;
DROP POLICY IF EXISTS "Service role can read all subscriptions" ON push_subscriptions;

-- Recreate policies with UPDATE support for upsert
CREATE POLICY "push_subscriptions_select_policy" ON push_subscriptions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "push_subscriptions_insert_policy" ON push_subscriptions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- This is critical for UPSERT operations!
CREATE POLICY "push_subscriptions_update_policy" ON push_subscriptions
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "push_subscriptions_delete_policy" ON push_subscriptions
    FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- Step 9: Fix messages policy for group messages
-- ============================================

DROP POLICY IF EXISTS "Users can view their own messages" ON messages;
CREATE POLICY "messages_select_policy" ON messages
    FOR SELECT USING (
        auth.uid() = sender_id 
        OR auth.uid() = receiver_id
        OR (group_id IS NOT NULL AND is_group_member(group_id, auth.uid()))
    );

DROP POLICY IF EXISTS "Users can send messages" ON messages;
CREATE POLICY "messages_insert_policy" ON messages
    FOR INSERT WITH CHECK (
        auth.uid() = sender_id
        AND (
            receiver_id IS NOT NULL 
            OR (group_id IS NOT NULL AND is_group_member(group_id, auth.uid()))
        )
    );

-- ============================================
-- Step 10: Grant execute permission on helper functions
-- ============================================

GRANT EXECUTE ON FUNCTION is_group_member(BIGINT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_group_creator(BIGINT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_group_creator(BIGINT) TO authenticated;

-- ============================================
-- DONE! Run this SQL in your Supabase SQL Editor
-- ============================================
