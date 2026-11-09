export function formatDue(value: unknown, locale: string): string {
  const time = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(time)) return '';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(time);
}

export function statusKey(status: string): string {
  if (status === 'not_started') return 'notStarted';
  if (status === 'in_progress') return 'inProgress';
  if (status === 'submitted') return 'submitted';
  if (status === 'graded') return 'graded';
  if (status === 'overdue') return 'overdue';
  return status;
}
