import { createHash, randomBytes, randomUUID } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashInviteCode(code: string, pepper: string): string {
  return sha256(`${code}${pepper}`);
}

export function nid(prefix: string, size = 12): string {
  return `${prefix}${randomBytes(size).toString('hex').slice(0, size)}`;
}

export function newRequestId(): string {
  return randomUUID();
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortValue(value[key]);
  }
  return out;
}

export function weekBoundsShanghai(now: number): { start: number; end: number } {
  const shanghai = new Date(now + 8 * 60 * 60 * 1000);
  const day = shanghai.getUTCDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  const startUtc = Date.UTC(
    shanghai.getUTCFullYear(),
    shanghai.getUTCMonth(),
    shanghai.getUTCDate() - daysFromMonday,
    0,
    0,
    0,
    0,
  );
  const start = startUtc - 8 * 60 * 60 * 1000;
  return { start, end: start + 7 * 24 * 60 * 60 * 1000 };
}

/** Quiet hours are clock times in Asia/Shanghai. Returns the next instant the window ends, if inside it. */
export function quietUntil(now: number, start: string, end: string): number | null {
  const [sh, sm] = start.split(':').map((part) => Number(part));
  const [eh, em] = end.split(':').map((part) => Number(part));
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  const shanghai = new Date(now + 8 * 60 * 60 * 1000);
  const minutes = shanghai.getUTCHours() * 60 + shanghai.getUTCMinutes();
  const startMin = (sh ?? 0) * 60 + (sm ?? 0);
  const endMin = (eh ?? 0) * 60 + (em ?? 0);
  const overnight = startMin > endMin;
  const inside = overnight ? minutes >= startMin || minutes < endMin : minutes >= startMin && minutes < endMin;
  if (!inside) return null;
  const endDayOffset = overnight && minutes >= startMin ? 1 : 0;
  const endUtc = Date.UTC(
    shanghai.getUTCFullYear(),
    shanghai.getUTCMonth(),
    shanghai.getUTCDate() + endDayOffset,
    eh,
    em,
    0,
    0,
  );
  return endUtc - 8 * 60 * 60 * 1000;
}

const SAFE_VAR_KEYS = new Set(['title', 'subject', 'dueAt', 'link', 'studentName', 'taskTitle']);

export function safeTemplateVars(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (SAFE_VAR_KEYS.has(key) && typeof value === 'string') {
      out[key] = value.slice(0, 200);
    }
  }
  return out;
}
