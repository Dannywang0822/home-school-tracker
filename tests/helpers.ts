import { randomUUID } from 'node:crypto';
import { MemoryObjectStorage, createDispatcher, frozenClock, getAction, type AuthContext, type ObjectStorage } from '@hst/core';
import { MAIL_FROM, type ApiResult } from '@hst/shared';
import { createFixture, PEPPER, type Fixture } from '@hst/fixture';

export interface Harness extends Fixture {
  dispatch: ReturnType<typeof createDispatcher>;
  storage: ObjectStorage;
}

export async function harness(): Promise<Harness> {
  const fixture = await createFixture();
  const storage = new MemoryObjectStorage();
  const dispatch = createDispatcher({
    db: fixture.db,
    clock: frozenClock(fixture.now),
    storage,
    config: { invitePepper: PEPPER, mailFrom: MAIL_FROM, wechatConfigured: false },
  });
  return { ...fixture, dispatch, storage };
}

export function session(uid: string, extra: Partial<AuthContext> = {}): AuthContext {
  return { uid, loginType: 'EMAIL', client: 'web', ...extra };
}

export async function call(
  env: Harness,
  uid: string | null,
  action: string,
  data: unknown = {},
  requestId = randomUUID(),
): Promise<ApiResult> {
  const definition = getAction(action);
  if (!definition) throw new Error(`action not registered: ${action}`);
  return env.dispatch(
    definition.fn,
    { action, data, requestId, locale: 'zh' },
    uid ? session(uid) : null,
  );
}

export function json(value: unknown): string {
  return JSON.stringify(value);
}
