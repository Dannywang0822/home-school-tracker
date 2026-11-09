import { ERROR_HTTP_STATUS, type ErrorCode } from '@hst/shared';

export class AppError extends Error {
  readonly httpStatus: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.httpStatus = ERROR_HTTP_STATUS[code];
  }
}
