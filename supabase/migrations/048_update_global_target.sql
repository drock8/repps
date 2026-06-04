-- Update global target to 2000 burpees by June 6, 2026
INSERT INTO settings (key, value, updated_at) VALUES
  ('global_target', '2000', now()),
  ('target_date', '2026-06-06', now()),
  ('target_label', '2,000 burpees by June 6, 2026', now())
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = now();
