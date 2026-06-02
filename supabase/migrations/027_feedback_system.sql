-- Feedback system: features, bugs, comments with voting

CREATE TABLE IF NOT EXISTS public.feedback (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('feature', 'bug', 'comment')),
  title text,
  description text NOT NULL,
  screenshot_url text,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_name text NOT NULL DEFAULT 'Anonymous',
  source text NOT NULL DEFAULT 'user' CHECK (source IN ('admin', 'user')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'considering', 'planned', 'building', 'done', 'dismissed', 'investigating', 'fixed', 'wont_fix')),
  priority_order integer,
  is_testimonial boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.feedback_votes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  feedback_id uuid NOT NULL REFERENCES public.feedback(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (feedback_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_type ON public.feedback(type);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON public.feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_source ON public.feedback(source);
CREATE INDEX IF NOT EXISTS idx_feedback_priority ON public.feedback(priority_order) WHERE priority_order IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_feedback_votes_feedback ON public.feedback_votes(feedback_id);

-- Feedback storage bucket for screenshots
INSERT INTO storage.buckets (id, name, public) VALUES ('feedback-screenshots', 'feedback-screenshots', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read feedback screenshots" ON storage.objects FOR SELECT
  USING (bucket_id = 'feedback-screenshots');

CREATE POLICY "Authenticated upload feedback screenshots" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (bucket_id = 'feedback-screenshots');

-- RLS on feedback
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read feedback" ON public.feedback FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert feedback" ON public.feedback FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can update feedback" ON public.feedback FOR UPDATE
  USING (
    auth.uid()::text IN (
      SELECT unnest(string_to_array(value, ','))
      FROM public.settings
      WHERE key = 'admin_user_ids'
    )
    OR auth.uid() = user_id
  );

CREATE POLICY "Admins can delete feedback" ON public.feedback FOR DELETE
  USING (
    auth.uid()::text IN (
      SELECT unnest(string_to_array(value, ','))
      FROM public.settings
      WHERE key = 'admin_user_ids'
    )
  );

-- RLS on feedback_votes
ALTER TABLE public.feedback_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read votes" ON public.feedback_votes FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can vote" ON public.feedback_votes FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove own vote" ON public.feedback_votes FOR DELETE
  USING (auth.uid() = user_id);

-- Vote count function
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
  vote_count bigint,
  user_voted boolean
) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    f.id, f.type, f.title, f.description, f.screenshot_url,
    f.user_id, f.user_name, f.source, f.status, f.priority_order,
    f.is_testimonial, f.created_at, f.updated_at,
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

-- Toggle vote RPC
CREATE OR REPLACE FUNCTION public.toggle_feedback_vote(p_feedback_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.feedback_votes
    WHERE feedback_id = p_feedback_id AND user_id = auth.uid()
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM public.feedback_votes
    WHERE feedback_id = p_feedback_id AND user_id = auth.uid();
    RETURN false;
  ELSE
    INSERT INTO public.feedback_votes (feedback_id, user_id)
    VALUES (p_feedback_id, auth.uid());
    RETURN true;
  END IF;
END;
$$;

-- Update priority order RPC (admin only)
CREATE OR REPLACE FUNCTION public.update_feedback_priority(p_items jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_item jsonb;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    UPDATE public.feedback
    SET priority_order = (v_item->>'priority_order')::integer,
        status = COALESCE(v_item->>'status', status),
        updated_at = now()
    WHERE id = (v_item->>'id')::uuid;
  END LOOP;
END;
$$;
