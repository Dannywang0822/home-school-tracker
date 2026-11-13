import { FUNCTIONS } from '@hst/shared';
import { z } from 'zod';
import { AppError } from '../app-error.js';
import { registerAction } from '../auth/registry.js';
import { asNumber, nid } from '../util.js';

registerAction({
  name: 'ops.claimOutbox',
  fn: FUNCTIONS.ops,
  roles: ['ops_mailer'],
  input: z
    .object({
      limit: z.number().int().min(1).max(20).optional(),
      leaseSec: z.number().int().min(30).max(600).optional(),
      workerId: z.string().min(1).max(80),
    })
    .strip(),
  scope: async () => true,
  async handler(ctx, input) {
    const limit = input.limit ?? 20;
    const leaseSec = input.leaseSec ?? 600;
    const now = ctx.clock.now();
    const pending = await ctx.repo.listPendingOutbox(now);
    const items = [];
    for (const row of pending) {
      if (items.length >= limit) break;
      const version = asNumber(row.version);
      if (version == null) continue;
      const claimToken = nid('clm_', 16);
      const claimed = await ctx.repo.tryClaimOutbox(row._id, version, {
        status: 'claimed',
        claimedBy: input.workerId,
        claimedAt: now,
        leaseUntil: now + leaseSec * 1000,
        claimToken,
      });
      if (!claimed.ok) continue;
      items.push({
        outboxId: claimed.doc._id,
        claimToken,
        from: claimed.doc.from,
        to: claimed.doc.to,
        subject: claimed.doc.subject,
        text: claimed.doc.text,
        html: claimed.doc.html,
        kind: claimed.doc.kind,
        createdAt: claimed.doc.createdAt,
      });
    }
    return { items };
  },
});

registerAction({
  name: 'ops.ackOutbox',
  fn: FUNCTIONS.ops,
  roles: ['ops_mailer'],
  input: z
    .object({
      outboxId: z.string().min(1).max(80),
      claimToken: z.string().min(1).max(80),
      result: z.enum(['sent', 'failed']),
      providerMessageId: z.string().max(120).optional(),
      error: z.string().max(200).optional(),
      retryable: z.boolean().optional(),
    })
    .strip(),
  scope: async (ctx, input) => Boolean(await ctx.repo.getOutbox(input.outboxId)),
  async handler(ctx, input) {
    const row = await ctx.repo.getOutbox(input.outboxId);
    if (!row) throw new AppError('NOT_FOUND', '资源不存在');
    if (row.claimToken !== input.claimToken) throw new AppError('CONFLICT', '租约不匹配');
    const leaseUntil = asNumber(row.leaseUntil) ?? 0;
    if (leaseUntil < ctx.clock.now()) throw new AppError('CONFLICT', '租约已过期');
    const version = asNumber(row.version);
    if (input.result === 'sent') {
      const updated = await ctx.repo.tryClaimOutbox(row._id, version ?? 0, {
        status: 'sent',
        sentAt: ctx.clock.now(),
        providerMessageId: input.providerMessageId,
      });
      if (!updated.ok) throw new AppError('CONFLICT', '数据已更新');
      return { status: 'sent' };
    }
    const attempts = (asNumber(row.attempts) ?? 0) + 1;
    const retry = input.retryable === true && attempts < 5;
    const backoffMs = Math.min(60 * 60 * 1000, 60_000 * 2 ** attempts);
    const updated = await ctx.repo.tryClaimOutbox(row._id, version ?? 0, {
      status: retry ? 'pending' : 'failed',
      attempts,
      lastError: (input.error ?? '').slice(0, 200),
      scheduledAt: retry ? ctx.clock.now() + backoffMs : row.scheduledAt,
      claimToken: '',
      claimedBy: '',
    });
    if (!updated.ok) throw new AppError('CONFLICT', '数据已更新');
    return { status: retry ? 'pending' : 'failed' };
  },
});

registerAction({
  name: 'ops.stats',
  fn: FUNCTIONS.ops,
  roles: ['ops_mailer'],
  input: z.object({}).strip(),
  scope: async () => true,
  async handler(ctx) {
    const now = ctx.clock.now();
    const rows = await ctx.repo.listOutbox();
    const live = rows.filter((row) => row.deletedAt == null);
    const pending = live.filter((row) => row.status === 'pending');
    const oldest = pending.reduce((min, row) => Math.min(min, asNumber(row.createdAt) ?? now), now);
    return {
      pending: pending.length,
      claimed: live.filter((row) => row.status === 'claimed').length,
      failed24h: live.filter((row) => row.status === 'failed' && now - (asNumber(row.updatedAt) ?? asNumber(row.createdAt) ?? 0) < 86_400_000).length,
      oldestPendingAgeSec: pending.length === 0 ? 0 : Math.max(0, Math.floor((now - oldest) / 1000)),
    };
  },
});
