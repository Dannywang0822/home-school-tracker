import type { FunctionName, Role } from '@hst/shared';
import type { ZodType } from 'zod';
import type { Caller } from './caller.js';
import type { Repo } from '../repo.js';
import type { Clock } from '../clock.js';
import type { AppConfig } from '../config.js';

export interface ActionContext {
  caller: Caller;
  repo: Repo;
  clock: Clock;
  requestId: string;
  locale: 'zh' | 'en';
  functionName: string;
  config: AppConfig;
}

export interface ActionDefinition<I, O> {
  name: string;
  fn: FunctionName;
  roles: readonly Role[];
  input: ZodType<I>;
  scope: (ctx: ActionContext, input: I) => Promise<boolean>;
  handler: (ctx: ActionContext, input: I) => Promise<O>;
  audit?: string;
  idempotent?: boolean;
  consentExempt?: boolean;
  allowDuringPasswordChange?: boolean;
  /** auth-public actions that do not require a session */
  public?: boolean;
}

const registry = new Map<string, ActionDefinition<unknown, unknown>>();

export function registerAction<I, O>(definition: ActionDefinition<I, O>): void {
  if (typeof definition.scope !== 'function') {
    throw new Error(`action ${definition.name} is missing scope`);
  }
  if (!definition.name || !definition.fn || !definition.roles || !definition.input || !definition.handler) {
    throw new Error(`action ${definition.name || '(unnamed)'} is incomplete`);
  }
  if (registry.has(definition.name)) {
    throw new Error(`action ${definition.name} is already registered`);
  }
  registry.set(definition.name, definition as ActionDefinition<unknown, unknown>);
}

export function getAction(name: string): ActionDefinition<unknown, unknown> | undefined {
  return registry.get(name);
}

export function listActions(): ActionDefinition<unknown, unknown>[] {
  return [...registry.values()];
}

export function clearActionsForTests(): void {
  registry.clear();
}
