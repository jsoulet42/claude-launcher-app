import { useState, useEffect } from 'react';

function formatRelativeTime(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  const seconds = Math.floor(delta / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m`;
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h${String(remainingMinutes).padStart(2, '0')}`;
}

/**
 * Hook that returns a formatted relative time string, refreshed on interval.
 * Returns '' if timestamp is null or 0.
 */
export function useRelativeTime(
  timestamp: number | null,
  intervalMs: number = 1000
): string {
  const [text, setText] = useState(() =>
    timestamp ? formatRelativeTime(timestamp) : ''
  );

  useEffect(() => {
    if (!timestamp) {
      setText('');
      return;
    }

    setText(formatRelativeTime(timestamp));

    const id = setInterval(() => {
      setText(formatRelativeTime(timestamp));
    }, intervalMs);

    return () => clearInterval(id);
  }, [timestamp, intervalMs]);

  return text;
}
