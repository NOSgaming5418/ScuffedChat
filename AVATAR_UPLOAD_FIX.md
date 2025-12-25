# Avatar Upload Fix Guide

## Issues Fixed ✅

1. **Duplicate storage path** (`avatars/avatars/filename.jpg` → `filename.jpg`)
2. **406 Not Acceptable errors** - Added proper Accept headers to Supabase client
3. **Storage policies** - Simplified to allow authenticated users to upload

## Files Updated

- `static/js/app.js` - Fixed file path (removed duplicate `avatars/` prefix)
- `static/js/supabase-config.js` - Added Accept headers to prevent 406 errors
- `create_avatar_storage.sql` - Updated storage policies for better access control

## How to Test the Fix

1. **Refresh your browser** (clear cache: Ctrl+Shift+R or Cmd+Shift+R)
2. Log in to ScuffedSnap
3. Try uploading an avatar image
4. The upload should now work correctly!

## If Still Not Working

### Step 1: Verify Storage Bucket Exists

Go to Supabase Dashboard:
https://supabase.com/dashboard/project/ulwlwrtedihujhpbuzvu/storage

Check if the `avatars` bucket exists and is set to **Public**.

### Step 2: Run Storage Setup SQL

If the bucket doesn't exist, run `create_avatar_storage.sql` in the SQL Editor:
https://supabase.com/dashboard/project/ulwlwrtedihujhpbuzvu/sql

```sql
-- Create bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;
```

### Step 3: Check Storage Policies

Go to: Dashboard → Storage → avatars → Policies

Make sure these policies exist:
- ✅ "Avatar images are publicly accessible" (SELECT)
- ✅ "Users can upload their own avatar" (INSERT)
- ✅ "Users can update their own avatar" (UPDATE)
- ✅ "Users can delete their own avatar" (DELETE)

If not, run the full `create_avatar_storage.sql` script.

### Step 4: Check Browser Console

Open DevTools (F12) and look for errors. You should see:
- ✅ "Supabase client initialized successfully"
- ❌ No 406 errors
- ❌ No 400 errors from storage

## Technical Details

### What Was Wrong

**Before:**
```javascript
const filePath = `avatars/${fileName}`;  // Wrong - creates avatars/avatars/file.jpg
await supabaseClient.storage.from('avatars').upload(filePath, file);
```

**After:**
```javascript
const filePath = fileName;  // Correct - creates file.jpg in avatars bucket
await supabaseClient.storage.from('avatars').upload(filePath, file);
```

### Storage Structure

```
Storage (Supabase)
└── avatars (bucket)
    ├── user-id-timestamp.jpg
    ├── user-id-timestamp.png
    └── ...
```

## Common Errors Explained

- **406 Not Acceptable**: Missing or incorrect Accept headers (FIXED)
- **400 Bad Request**: Wrong file path or bucket doesn't exist (FIXED)
- **403 Forbidden**: RLS policy blocking upload (check policies)
- **404 Not Found**: Bucket doesn't exist (run create_avatar_storage.sql)

## Test Upload Checklist

- [ ] Browser cache cleared
- [ ] Logged in to ScuffedSnap
- [ ] No console errors
- [ ] Image file selected (JPG, PNG, GIF)
- [ ] Click "Save Changes"
- [ ] Avatar updates successfully
- [ ] New avatar visible in profile

---

**Still having issues?** Check the Supabase logs:
Dashboard → Logs → API Logs
