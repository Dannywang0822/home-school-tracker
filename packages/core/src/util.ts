const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** SHA-256 without Node's crypto module, so the same code runs in the browser demo. */
export function sha256Bytes(data: Uint8Array): string {
  const bitLength = data.length * 8;
  const withMarker = data.length + 1;
  const mod = withMarker % 64;
  const zeros = mod <= 56 ? 56 - mod : 120 - mod;
  const padded = new Uint8Array(data.length + 1 + zeros + 8);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) w[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(w[index - 15] ?? 0, 7) ^ rotr(w[index - 15] ?? 0, 18) ^ ((w[index - 15] ?? 0) >>> 3);
      const s1 = rotr(w[index - 2] ?? 0, 17) ^ rotr(w[index - 2] ?? 0, 19) ^ ((w[index - 2] ?? 0) >>> 10);
      w[index] = (((w[index - 16] ?? 0) + s0 + (w[index - 7] ?? 0) + s1) >>> 0);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + (SHA256_K[index] ?? 0) + (w[index] ?? 0)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => word.toString(16).padStart(8, '0')).join('');
}

export function sha256(value: string): string {
  return sha256Bytes(new TextEncoder().encode(value));
}

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hashInviteCode(code: string, pepper: string): string {
  return sha256(`${code}${pepper}`);
}

/** Local demo login only. Production passwords stay in CloudBase, not in this database. */
export function hashDevPassword(password: string): string {
  return sha256(`hst-dev-only:${password}`);
}

export function randomSecret(length = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[(bytes[i] ?? 0) % alphabet.length];
  return out;
}

export function randomTempPassword(): string {
  return `Tmp-${randomSecret(4)}-${randomSecret(4)}-9`;
}

export function nid(prefix: string, size = 12): string {
  return `${prefix}${toHex(randomBytes(size)).slice(0, size)}`;
}

export function newRequestId(): string {
  return crypto.randomUUID();
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
