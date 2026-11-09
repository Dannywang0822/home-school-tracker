import { FUNCTIONS } from '@hst/shared';
import { currentLocale } from './i18n';

const TOKEN_KEY = 'hst.token';

export interface ApiFailure {
  ok: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
  requestId: string;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  requestId: string;
}

export function getToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) ?? '';
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

async function post<T>(path: string, body: unknown, auth = false): Promise<ApiSuccess<T> | ApiFailure> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth && getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return (await response.json()) as ApiSuccess<T> | ApiFailure;
}

export function devLogin(email: string, password: string) {
  return post<{ token: string }>('/api/dev/login', { email, password });
}

export function sendEmailCode(email: string) {
  return post<{ sent: boolean }>('/api/dev/email-code/send', { email });
}

export function verifyEmailCode(email: string, code: string) {
  return post<{ token: string }>('/api/dev/email-code/verify', { email, code });
}

export function callFunction<T>(name: string, action: string, data: unknown = {}) {
  return post<T>(
    `/api/${name}`,
    { action, data, requestId: crypto.randomUUID(), locale: currentLocale() },
    true,
  );
}

export interface I18nText {
  zh: string;
  en?: string;
}

export interface Me {
  user: {
    id: string;
    displayName: I18nText;
    roles: string[];
    locale: 'zh' | 'en';
    status: string;
    mustChangePassword: boolean;
  };
  children: Array<{
    studentId: string;
    displayName: I18nText;
    programme: string;
    className: I18nText;
    relation?: string;
  }>;
  pendingConsents: string[];
  school: {
    name: I18nText;
    timezone: string;
    currentYear: { id: string; name: string } | null;
    currentTerm: { id: string; name: I18nText; index: number } | null;
  };
}

export function loadMe() {
  return callFunction<Me>(FUNCTIONS.apiCore, 'me.get');
}

export function updateLocale(locale: 'zh' | 'en') {
  return callFunction<{ user: Me['user'] }>(FUNCTIONS.apiCore, 'me.update', { locale });
}

export function markPasswordChanged() {
  return callFunction<{ ok: boolean }>(FUNCTIONS.apiCore, 'auth.passwordChanged');
}

export function textOf(value: I18nText | string | null | undefined, locale: string): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (locale === 'en') return value.en || value.zh;
  return value.zh;
}
