import type { Locale } from '@hst/shared';
import type {
  ChannelAdapter,
  DeliverCtx,
  DeliverResult,
  NotificationPrefs,
  NotifyEvent,
  RenderedMessage,
  UserLite,
} from './types.js';

/** Empty adapter. Week 1 does not call the WeChat subscribe-message API. */
export class WechatSubscribeAdapter implements ChannelAdapter {
  readonly channel = 'wechat_subscribe' as const;

  isEnabledFor(_user: UserLite, _prefs: NotificationPrefs, _event: NotifyEvent): boolean {
    return false;
  }

  async render(event: NotifyEvent, user: UserLite, locale: Locale): Promise<RenderedMessage> {
    return {
      channel: 'wechat_subscribe',
      toUserId: user._id,
      locale,
      subject: '',
      text: '',
      html: '',
      templateKey: event.type,
      dedupeKey: `${event.dedupeKey}:${user._id}`,
      kind: 'immediate',
      priority: 10,
    };
  }

  async deliver(_message: RenderedMessage, _ctx: DeliverCtx): Promise<DeliverResult> {
    return { status: 'not_implemented', reason: 'wechat_subscribe' };
  }
}
