import { MAIL_FROM } from '@hst/shared';

export interface AppConfig {
  invitePepper: string;
  mailFrom: string;
  /** When false, WeChat code exchange is refused with NOT_IMPLEMENTED. */
  wechatConfigured: boolean;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    invitePepper: env.INVITE_CODE_PEPPER ?? '',
    mailFrom: MAIL_FROM,
    wechatConfigured: Boolean(env.WECHAT_APPID && env.WECHAT_APPSECRET),
  };
}
