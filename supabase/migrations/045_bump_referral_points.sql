-- 045_bump_referral_points.sql — Increase referral rewards to 50/100
-- 50 pts on first rep, 100 total if MDR hit day one (bonus = 50 more)

update settings set value = '50', updated_at = now() where key = 'referral_base_points';
update settings set value = '100', updated_at = now() where key = 'referral_bonus_points';
