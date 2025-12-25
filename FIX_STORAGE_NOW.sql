-- STORAGE FIX - USE DASHBOARD UI INSTEAD!
-- SQL Editor has limited permissions for storage management
-- Follow the steps below to fix via the Supabase Dashboard UI

/*
================================================================================
🚨 IMPORTANT: Use the Dashboard UI, not SQL Editor! 🚨
================================================================================

STEP 1: DELETE the existing avatars bucket
   → Go to: https://supabase.com/dashboard/project/ulwlwrtedihujhpbuzvu/storage/buckets
   → Find "avatars" bucket
   → Click the 3 dots (...) → Delete bucket
   → Confirm deletion

STEP 2: CREATE a new avatars bucket with correct settings
   → Click "New bucket"
   → Name: avatars
   → ✅ Check "Public bucket" (THIS IS CRITICAL!)
   → ✅ File size limit: 5 MB
   → ✅ Allowed MIME types: image/jpeg, image/png, image/gif, image/webp
   → Click "Create bucket"

STEP 3: Add storage policies (if needed)
   → Click on the "avatars" bucket
   → Go to "Policies" tab
   → Click "New policy"
   → Template: "Allow public read access"
   → Save

STEP 4: Test the upload
   → Hard refresh browser (Ctrl+Shift+R)
   → Try uploading an avatar
   → Should work now!

================================================================================

If you MUST use SQL, here's a minimal version that might work:
*/

-- Verify bucket exists
SELECT * FROM storage.buckets WHERE id = 'avatars';

-- If bucket doesn't exist or is not public, UPDATE it
UPDATE storage.buckets 
SET public = true,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
WHERE id = 'avatars';
