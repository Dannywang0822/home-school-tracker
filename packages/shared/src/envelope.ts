import { z } from 'zod';
import type { ErrorCode } from './errors.js';

export const apiRequestSchema = z.object({
  action: z.string().min(1).max(80),
  data: z.unknown().optional(),
  requestId: z.string().uuid().optional(),
  locale: z.enum(['zh', 'en']).optional(),
});

export type ApiRequest = z.infer<typeof apiRequestSchema>;

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  requestId: string;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId: string;
}

export type ApiResult<T = unknown> = ApiSuccess<T> | ApiFailure;

export interface I18nText {
  zh: string;
  en?: string;
}
