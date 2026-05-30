-- ============================================================
-- Migration: Guest-First Onboarding
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- 1. Make user_id nullable on reps table
--    Anonymous (guest) reps will have user_id = NULL
--    They still count toward the global total
ALTER TABLE reps ALTER COLUMN user_id DROP NOT NULL;

-- 2. Drop the existing insert policy for reps
--    (currently requires authenticated user inserting own reps)
DROP POLICY IF EXISTS "Authenticated users can insert own reps" ON reps;

-- 3. Create new insert policies

-- Authenticated users can insert reps with their own user_id
CREATE POLICY "Authenticated users insert own reps"
  ON reps FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Anonymous (guest) users can insert reps with NULL user_id only
CREATE POLICY "Anonymous users insert guest reps"
  ON reps FOR INSERT
  TO anon
  WITH CHECK (user_id IS NULL);

-- 4. Allow authenticated users to claim anonymous reps
--    (UPDATE their user_id onto previously-NULL rows by matching rep IDs)
DROP POLICY IF EXISTS "Users can update own reps" ON reps;

CREATE POLICY "Users can claim anonymous reps"
  ON reps FOR UPDATE
  TO authenticated
  USING (user_id IS NULL)
  WITH CHECK (user_id = auth.uid());

-- 5. Verify: read policy should already exist as public read
--    This is a no-op safety check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'reps'
    AND policyname LIKE '%read%' OR policyname LIKE '%select%'
  ) THEN
    RAISE NOTICE 'WARNING: No read policy found on reps table. Add one manually.';
  END IF;
END $$;

-- ============================================================
-- MANUAL STEPS (do these in the Supabase Dashboard):
--
-- 1. Enable Email auth provider:
--    Dashboard > Authentication > Providers > Email
--    - Enable Email provider
--    - Disable "Confirm email" (for v0.1 speed)
--    - Enable "Secure email change"
--
-- 2. Verify anonymous access is enabled:
--    Dashboard > Settings > API
--    - anon key should already be configured (it is)
--
-- ============================================================
