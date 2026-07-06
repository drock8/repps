import type { VercelRequest, VercelResponse } from "@vercel/node";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CRON_SECRET = process.env.CRON_SECRET;

webpush.setVapidDetails("mailto:superflyasia@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!CRON_SECRET) {
    return res.status(500).json({ error: "CRON_SECRET not configured" });
  }
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: pending, error } = await supabase.rpc("get_pending_reminders");

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!pending || pending.length === 0) {
    return res.status(200).json({ sent: 0 });
  }

  const { data: settingRow } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "team_daily_target")
    .single();
  const target = settingRow ? Number(settingRow.value) : 5;

  let sent = 0;
  let failed = 0;

  for (const sub of pending) {
    const remaining = target - Number(sub.today_count);
    const body =
      sub.today_count === 0
        ? `Time to start! Hit your ${target} daily reps.`
        : `${remaining} more rep${remaining === 1 ? "" : "s"} to hit your daily minimum. Let's go!`;

    const subscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };

    try {
      await webpush.sendNotification(
        subscription,
        JSON.stringify({
          title: "REPPs",
          body,
          tag: "daily-reminder",
          url: "/home",
        })
      );
      sent++;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", sub.endpoint);
      }
      failed++;
    }
  }

  return res.status(200).json({ sent, failed, total: pending.length });
}
