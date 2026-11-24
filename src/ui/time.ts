// Small time formatting helpers for extension pages.

/** "just now", "5 min ago", "3 h ago", or a date for anything older than a day. */
export function timeAgo(time: number, now = Date.now()): string {
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(time).toLocaleDateString();
}
