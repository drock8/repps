-- Add admin reply column to feedback
ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS admin_reply text;
ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS replied_at timestamptz;

-- Drop old function signature before recreating with new return type
DROP FUNCTION IF EXISTS public.get_feedback_with_votes(text);

CREATE OR REPLACE FUNCTION public.get_feedback_with_votes(p_type text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  type text,
  title text,
  description text,
  screenshot_url text,
  user_id uuid,
  user_name text,
  source text,
  status text,
  priority_order integer,
  is_testimonial boolean,
  created_at timestamptz,
  updated_at timestamptz,
  admin_reply text,
  replied_at timestamptz,
  vote_count bigint,
  user_voted boolean
) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    f.id, f.type, f.title, f.description, f.screenshot_url,
    f.user_id, f.user_name, f.source, f.status, f.priority_order,
    f.is_testimonial, f.created_at, f.updated_at,
    f.admin_reply, f.replied_at,
    COALESCE(v.cnt, 0) AS vote_count,
    EXISTS (
      SELECT 1 FROM public.feedback_votes fv
      WHERE fv.feedback_id = f.id AND fv.user_id = auth.uid()
    ) AS user_voted
  FROM public.feedback f
  LEFT JOIN (
    SELECT feedback_id, COUNT(*) AS cnt
    FROM public.feedback_votes
    GROUP BY feedback_id
  ) v ON v.feedback_id = f.id
  WHERE (p_type IS NULL OR f.type = p_type)
  ORDER BY f.created_at DESC;
$$;
