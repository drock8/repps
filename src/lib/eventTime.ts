export function formatTimeStatus(event: { starts_at: string; ends_at: string; status: string }): { text: string; isLive: boolean; isCompleted: boolean } {
  const now = Date.now();
  const start = new Date(event.starts_at).getTime();
  const end = new Date(event.ends_at).getTime();

  if (event.status === "completed" || event.status === "archived") {
    return { text: "Completed", isLive: false, isCompleted: true };
  }

  if (now < start) {
    const diff = start - now;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return { text: `Starts in ${days}d ${hours}h`, isLive: false, isCompleted: false };
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return { text: `Starts in ${hours}h ${mins}m`, isLive: false, isCompleted: false };
  }

  if (now <= end) {
    const diff = end - now;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return { text: `LIVE · ${days}d ${hours}h remaining`, isLive: true, isCompleted: false };
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return { text: `LIVE · ${hours}h ${mins}m remaining`, isLive: true, isCompleted: false };
  }

  return { text: "Completed", isLive: false, isCompleted: true };
}
