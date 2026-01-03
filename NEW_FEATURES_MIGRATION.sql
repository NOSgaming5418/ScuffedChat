-- New Features Migration
-- Adds support for: message replies, @ mentions, and improved group management

-- 1. Add replied_to_message_id column to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS replied_to_message_id BIGINT REFERENCES messages(id) ON DELETE SET NULL;

-- 2. Add mentions column to store mentioned user IDs (array of UUIDs)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS mentions UUID[];

-- 3. Add index for replied_to lookups
CREATE INDEX IF NOT EXISTS idx_messages_replied_to ON messages(replied_to_message_id);

-- 4. Add index for mentions lookups
CREATE INDEX IF NOT EXISTS idx_messages_mentions ON messages USING GIN(mentions);

-- 5. Add last_seen column to profiles for online status tracking
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT NOW();

-- 6. Create index on last_seen for efficient online status queries
CREATE INDEX IF NOT EXISTS idx_profiles_last_seen ON profiles(last_seen);

-- Grant permissions for new columns
GRANT SELECT, INSERT, UPDATE ON messages TO authenticated;
GRANT SELECT, UPDATE ON profiles TO authenticated;

-- Enable realtime for messages table (if not already enabled)
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- Enable realtime for profiles table for live online status updates
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'profiles') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
    END IF;
END $$;

-- Create RLS policy to allow users to update their own last_seen
DROP POLICY IF EXISTS "Users can update their own last_seen" ON profiles;
CREATE POLICY "Users can update their own last_seen" ON profiles
    FOR UPDATE USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

COMMENT ON COLUMN messages.replied_to_message_id IS 'Reference to the message being replied to';
COMMENT ON COLUMN messages.mentions IS 'Array of user IDs mentioned in this message with @';
COMMENT ON COLUMN profiles.last_seen IS 'Timestamp of last user activity for online status';
