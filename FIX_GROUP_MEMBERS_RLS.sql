-- Fix Group Members RLS Policy
-- This allows users to see ALL members of groups they belong to, not just themselves

DROP POLICY IF EXISTS "Users can view members of groups they are in" ON group_members;
CREATE POLICY "Users can view members of groups they are in" ON group_members
    FOR SELECT USING (
        auth.uid() IN (
            SELECT member_id FROM group_members WHERE group_id = group_members.group_id
        )
    );
