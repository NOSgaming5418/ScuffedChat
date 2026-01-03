-- Fix Database Errors Migration
-- Fixes: 500 errors from incorrect table creation order and RLS policy issues

-- Step 1: Ensure group_chats table exists
CREATE TABLE IF NOT EXISTS group_chats (
    id BIGSERIAL PRIMARY KEY,
    creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    avatar VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: Ensure group_members table exists
CREATE TABLE IF NOT EXISTS group_members (
    id BIGSERIAL PRIMARY KEY,
    group_id BIGINT NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(group_id, member_id)
);

-- Step 3: Add group_id column to messages if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='messages' AND column_name='group_id') THEN
        ALTER TABLE messages ADD COLUMN group_id BIGINT REFERENCES group_chats(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Step 4: Create indexes
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id);
CREATE INDEX IF NOT EXISTS idx_group_chats_creator ON group_chats(creator_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_member ON group_members(member_id);
CREATE INDEX IF NOT EXISTS idx_group_members_composite ON group_members(group_id, member_id);

-- Step 5: Enable RLS
ALTER TABLE group_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

-- Step 6: Fix group_members SELECT policy (critical fix!)
DROP POLICY IF EXISTS "Users can view members of groups they are in" ON group_members;
CREATE POLICY "Users can view members of groups they are in" ON group_members
    FOR SELECT USING (
        auth.uid() IN (
            SELECT member_id FROM group_members WHERE group_id = group_members.group_id
        )
    );

-- Step 7: Group creators can add members
DROP POLICY IF EXISTS "Group creators can add members" ON group_members;
CREATE POLICY "Group creators can add members" ON group_members
    FOR INSERT WITH CHECK (
        auth.uid() = member_id
        OR auth.uid() = (SELECT creator_id FROM group_chats WHERE id = group_id)
    );

-- Step 8: Members can leave, creators can remove
DROP POLICY IF EXISTS "Group creators can remove members" ON group_members;
CREATE POLICY "Group creators can remove members" ON group_members
    FOR DELETE USING (
        auth.uid() = member_id
        OR auth.uid() = (SELECT creator_id FROM group_chats WHERE id = group_id)
    );

-- Step 9: Group chat RLS policies
DROP POLICY IF EXISTS "Users can view groups they are in" ON group_chats;
CREATE POLICY "Users can view groups they are in" ON group_chats
    FOR SELECT USING (
        auth.uid() IN (
            SELECT member_id FROM group_members WHERE group_id = group_chats.id
        )
    );

DROP POLICY IF EXISTS "Authenticated users can create groups" ON group_chats;
CREATE POLICY "Authenticated users can create groups" ON group_chats
    FOR INSERT WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Group creators can update groups" ON group_chats;
CREATE POLICY "Group creators can update groups" ON group_chats
    FOR UPDATE USING (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Group creators can delete groups" ON group_chats;
CREATE POLICY "Group creators can delete groups" ON group_chats
    FOR DELETE USING (auth.uid() = creator_id);

-- Step 10: Enable realtime
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'group_chats') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE group_chats;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'group_members') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE group_members;
    END IF;
END $$;
