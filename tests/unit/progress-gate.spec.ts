import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canMarkDone, canStart, canSubmit } from '@hst/core';

const studentView = readFileSync(new URL('../../apps/web/src/views/tasks/StudentTaskDetail.vue', import.meta.url), 'utf8');
const template = studentView.slice(0, studentView.indexOf('<script'));
const taskActions = readFileSync(new URL('../../packages/core/src/actions/tasks.ts', import.meta.url), 'utf8');
const demoEngine = readFileSync(new URL('../../apps/web/src/demo/engine.ts', import.meta.url), 'utf8');

describe('progress gates', () => {
  it('hides start, submit and mark-done once a task is graded', () => {
    const graded = { status: 'graded', requiresSubmission: true };
    expect(canStart(graded)).toBe(false);
    expect(canSubmit(graded)).toBe(false);
    expect(canMarkDone({ status: 'graded', requiresSubmission: false })).toBe(false);
    expect(template).toContain('v-if="canStart(gate)"');
    expect(template).toContain('canSubmit(gate)');
    expect(template).toContain('v-if="canMarkDone(gate)"');
    expect(studentView).toContain("from '@hst/core'");
    expect(taskActions).toContain('canStart(');
    expect(taskActions).toContain('canSubmit(');
    expect(taskActions).toContain('canMarkDone(');
  });

  it('keeps an attachment entry on the student submit path', () => {
    expect(template).toContain('type="file"');
    expect(template).toContain('data-attachment');
    expect(studentView).toContain("'file.commit'");
    expect(demoEngine).toContain("path === '/api/dev/upload'");
  });
});
