import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_COLLECTIONS, ALL_FUNCTIONS, COLLECTIONS, CRON_FUNCTIONS, GATEWAY_FUNCTIONS } from '@hst/shared';
import {
  bundledDatabaseRules,
  bundledFunctionRules,
  bundledStorageRules,
  createCronMain,
  createFunctionMain,
  evaluateDatabaseRead,
  evaluateDatabaseWrite,
  evaluateInvoke,
  evaluateStorage,
} from '@hst/core';
import gateway from '../../infra/gateway.json' with { type: 'json' };

const parent = { uid: 'uid_p1', loginType: 'EMAIL' };
const closed = ALL_COLLECTIONS.filter((name) => name !== COLLECTIONS.notifications);

describe('client security rules', () => {
  it('PX-01 an empty query is denied on every closed collection', () => {
    for (const collection of closed) {
      const decision = evaluateDatabaseRead({ collection, auth: parent, mode: 'query', query: {} });
      expect(decision, collection).toEqual({ decision: 'deny', code: 'DATABASE_PERMISSION_DENIED' });
    }
  });

  it('PX-02 a direct document read is denied', () => {
    const decision = evaluateDatabaseRead({
      collection: COLLECTIONS.taskProgress,
      auth: parent,
      mode: 'get',
      doc: { _id: 'tsk_x_stu_s2', studentId: 'stu_s2', leakMarker: 'cny_s2_progress' },
    });
    expect(decision.decision).toBe('deny');
  });

  it('PX-03 and PX-04 notification watches must be limited to the caller', () => {
    const other = evaluateDatabaseRead({
      collection: COLLECTIONS.notifications,
      auth: parent,
      mode: 'query',
      query: { recipientAuthUid: 'uid_p2' },
    });
    const open = evaluateDatabaseRead({
      collection: COLLECTIONS.notifications,
      auth: parent,
      mode: 'query',
      query: {},
    });
    const own = evaluateDatabaseRead({
      collection: COLLECTIONS.notifications,
      auth: parent,
      mode: 'query',
      query: { recipientAuthUid: 'uid_p1' },
    });
    expect(other.decision).toBe('deny');
    expect(open.decision).toBe('deny');
    expect(own.decision).toBe('allow');
  });

  it('PX-09 storage reads are denied, including vault paths', () => {
    for (const path of ['hst_vault/sch_demo/submission/x/fil_s2', 'hst_tmp/20261109/abc', 'tmp/abc']) {
      expect(evaluateStorage({ op: 'read', path, auth: parent }).decision).toBe('deny');
    }
  });

  it('ST-02 unauthenticated and anonymous calls cannot invoke business functions', () => {
    expect(evaluateInvoke({ functionName: 'hst_api_core', auth: null }).decision).toBe('deny');
    expect(evaluateInvoke({ functionName: 'hst_api_academic', auth: { uid: 'uid_p1', loginType: 'ANONYMOUS' } }).decision).toBe('deny');
    expect(evaluateInvoke({ functionName: 'hst_api_core', auth: parent }).decision).toBe('allow');
    expect(evaluateInvoke({ functionName: 'hst_auth_public', auth: null }).decision).toBe('allow');
  });

  it('ST-03 and ST-05 storage writes and cron invokes stay closed', () => {
    expect(evaluateStorage({ op: 'write', path: 'hst_vault/sch/task/a/b', auth: parent }).decision).toBe('deny');
    expect(evaluateStorage({ op: 'write', path: 'tmp/abc', auth: parent }).decision).toBe('deny');
    expect(evaluateStorage({ op: 'write', path: 'hst_tmp/20261109/abc', auth: parent }).decision).toBe('allow');
    expect(evaluateStorage({ op: 'write', path: 'hst_tmp/20261109/abc', auth: { uid: 'uid_p1', loginType: 'ANONYMOUS' } }).decision).toBe('deny');
    for (const name of CRON_FUNCTIONS) {
      expect(evaluateInvoke({ functionName: name, auth: parent }).decision).toBe('deny');
    }
  });

  it('writes are denied and the rule files cover every prefixed collection and function', () => {
    const rules = bundledDatabaseRules();
    expect(Object.keys(rules).sort()).toEqual([...ALL_COLLECTIONS].sort());
    for (const collection of ALL_COLLECTIONS) {
      expect(rules[collection]?.write).toBe(false);
      expect(collection.startsWith('hst_')).toBe(true);
      expect(evaluateDatabaseWrite({ collection, auth: parent }).decision).toBe('deny');
    }
    const functions = bundledFunctionRules();
    expect(Object.keys(functions).sort()).toEqual([...ALL_FUNCTIONS].sort());
    expect(bundledStorageRules().read).toBe(false);
    expect(gateway.allow).toEqual(GATEWAY_FUNCTIONS.map((name) => `functions:/${name}`));
  });

  it('cloud entry rejects anonymous calls and does not serve fixture data', async () => {
    const main = createFunctionMain('hst_api_core');
    const anonymous = await main({ action: 'me.get', data: {} }, { userInfo: { uid: 'uid_p1', loginType: 'ANONYMOUS' } });
    expect(anonymous).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    const missing = await main({ action: 'me.get', data: {} }, {});
    expect(missing).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    const signedIn = await main({ action: 'me.get', data: {} }, { userInfo: { uid: 'uid_p1', loginType: 'EMAIL' } });
    expect(signedIn).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(JSON.stringify(signedIn)).not.toContain('演示');
    const cron = createCronMain('hst_cron_publish');
    const blocked = await cron({}, { userInfo: { uid: 'uid_p1', loginType: 'EMAIL' } });
    expect(blocked).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
  });
});

describe('repository does not contain credentials', () => {
  it('scans source for private keys and filled secret values', () => {
    const root = new URL('../../', import.meta.url);
    const offenders: string[] = [];
    const skip = new Set(['node_modules', '.git', 'dist', 'coverage']);
    const patterns = [
      /BEGIN [A-Z ]*PRIVATE KEY/,
      /AKID[0-9A-Za-z]{16}/,
      /SECRET(?:KEY|ID)[ \t]*[:=][ \t]*[A-Za-z0-9/+]{8,}/i,
    ];
    function walk(dir: string): void {
      for (const entry of readdirSync(dir)) {
        if (skip.has(entry)) continue;
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(ts|js|mjs|json|md|yml|yaml|example|csv|vue|html|css)$/.test(entry) && entry !== '.env.example') continue;
        const text = readFileSync(path, 'utf8');
        if (patterns.some((pattern) => pattern.test(text))) offenders.push(path);
      }
    }
    walk(root.pathname);
    expect(offenders).toEqual([]);
    const envExample = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
    expect(envExample).toContain('TENCENTCLOUD_SECRETID=');
  });
});
