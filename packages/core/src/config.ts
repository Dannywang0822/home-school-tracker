import { MAIL_FROM } from '@hst/shared';

export interface AppConfig {
  invitePepper: string;
  mailFrom: string;
  /** When false, WeChat code exchange is refused with NOT_IMPLEMENTED. */
  wechatConfigured: boolean;
}

export function configFromEnv(env: Record<string, string | undefined> = readProcessEnv()): AppConfig {
  return {
    invitePepper: env.INVITE_CODE_PEPPER ?? '',
    mailFrom: MAIL_FROM,
    wechatConfigured: Boolean(env.WECHAT_APPID && env.WECHAT_APPSECRET),
  };
}

function readProcessEnv(): Record<string, string | undefined> {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return runtime.process?.env ?? {};
}
