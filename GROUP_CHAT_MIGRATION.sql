-- ========================================
-- GROUP CHAT MIGRATION
-- Add support for group chats to ScuffedChat
-- ========================================

-- 1. Create group_chats table
CREATE TABLE IF NOT EXISTS group_chats (
    id BIGSERIAL PRIMARY KEY,
    creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    avatar VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create group_members table
CREATE TABLE IF NOT EXISTS group_members (
    id BIGSERIAL PRIMARY KEY,
    group_id BIGINT NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(group_id, member_id)
);

-- 3. Update messages table to support group chats
-- Add group_id column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='messages' AND column_name='group_id') THEN
        ALTER TABLE messages ADD COLUMN group_id BIGINT REFERENCES group_chats(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Make receiver_id nullable since group messages won't have a specific receiver
-- (This change is optional - you might want to keep it required and use NULL for groups)
ALTER TABLE messages ALTER COLUMN receiver_id DROP NOT NULL;

-- 4. Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_group_chats_creator ON group_chats(creator_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_member ON group_members(member_id);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_composite ON group_members(group_id, member_id);

-- 5. Enable RLS for new tables
ALTER TABLE group_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

-- 6. Create RLS policies for group_chats
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

-- 7. Create RLS policies for group_members
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

-- 8. Update messages RLS policy to include group messages
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

-- 9. Enable realtime for new tables
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'group_chats') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE group_chats;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'group_members') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE group_members;
    END IF;
END $$;

-- ========================================
-- DONE - Group chat migration complete
-- ========================================
