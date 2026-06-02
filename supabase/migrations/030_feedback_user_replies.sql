-- Add user_replies jsonb array for threaded conversation on feedback
ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS user_replies jsonb DEFAULT '[]'::jsonb;
