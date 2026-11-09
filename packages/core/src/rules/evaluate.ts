import { CRON_FUNCTIONS, GATEWAY_FUNCTIONS, type FunctionName } from '@hst/shared';
import databaseRules from '../../../../infra/rules/database.json' with { type: 'json' };
import functionRules from '../../../../infra/rules/functions.json' with { type: 'json' };
import storageRules from '../../../../infra/rules/storage.json' with { type: 'json' };

export interface RuleAuth {
  uid?: string | null;
  loginType?: string | null;
}

type RuleClause =
  | { kind: 'auth_present' }
  | { kind: 'not_anonymous' }
  | { kind: 'doc_eq_uid'; field: string }
  | { kind: 'path_prefix'; prefix: string };

export interface DatabaseRuleFile {
  [collection: string]: { read: boolean | string; write: boolean | string };
}

export interface FunctionRuleFile {
  [name: string]: { invoke: boolean | string };
}

export interface StorageRuleFile {
  read: boolean | string;
  write: boolean | string;
}

export function bundledDatabaseRules(): DatabaseRuleFile {
  return databaseRules as DatabaseRuleFile;
}

export function bundledFunctionRules(): FunctionRuleFile {
  return functionRules as FunctionRuleFile;
}

export function bundledStorageRules(): StorageRuleFile {
  return storageRules as StorageRuleFile;
}

/**
 * Fail closed. Only the clauses we actually ship are understood.
 * Anything else is treated as deny so a typo cannot open a collection.
 */
export function parseRuleExpression(expression: string): RuleClause[] | null {
  const parts = expression.split('&&').map((part) => part.trim()).filter(Boolean);
  const clauses: RuleClause[] = [];
  for (const part of parts) {
    if (part === 'auth != null') {
      clauses.push({ kind: 'auth_present' });
      continue;
    }
    if (part === "auth.loginType != 'ANONYMOUS'" || part === 'auth.loginType != "ANONYMOUS"') {
      clauses.push({ kind: 'not_anonymous' });
      continue;
    }
    const docMatch = /^doc\.([A-Za-z0-9_]+) == auth\.uid$/.exec(part);
    if (docMatch?.[1]) {
      clauses.push({ kind: 'doc_eq_uid', field: docMatch[1] });
      continue;
    }
    const pathMatch = /^\/\^([A-Za-z0-9_]+)\\\/\/\.test\(resource\.path\)$/.exec(part);
    if (pathMatch?.[1]) {
      clauses.push({ kind: 'path_prefix', prefix: `${pathMatch[1]}/` });
      continue;
    }
    return null;
  }
  return clauses;
}

function authOk(clauses: RuleClause[], auth: RuleAuth | null): boolean {
  for (const clause of clauses) {
    if (clause.kind === 'auth_present' && (auth == null || !auth.uid)) return false;
    if (clause.kind === 'not_anonymous' && (auth == null || auth.loginType === 'ANONYMOUS' || auth.loginType == null)) {
      return false;
    }
  }
  return true;
}

export type AccessDecision =
  | { decision: 'allow' }
  | { decision: 'deny'; code: 'DATABASE_PERMISSION_DENIED' | 'STORAGE_PERMISSION_DENIED' | 'FUNCTION_PERMISSION_DENIED' };

export function evaluateDatabaseRead(options: {
  collection: string;
  rules?: DatabaseRuleFile;
  auth: RuleAuth | null;
  mode: 'query' | 'get';
  query?: Record<string, unknown>;
  doc?: Record<string, unknown> | null;
}): AccessDecision {
  const rules = options.rules ?? bundledDatabaseRules();
  const rule = rules[options.collection];
  if (!rule) return { decision: 'deny', code: 'DATABASE_PERMISSION_DENIED' };
  return evaluateDocumentRule(rule.read, options, 'DATABASE_PERMISSION_DENIED');
}

export function evaluateDatabaseWrite(options: {
  collection: string;
  rules?: DatabaseRuleFile;
  auth: RuleAuth | null;
}): AccessDecision {
  const rules = options.rules ?? bundledDatabaseRules();
  const rule = rules[options.collection];
  if (!rule || rule.write !== false) {
    if (!rule || rule.write === true) return { decision: 'deny', code: 'DATABASE_PERMISSION_DENIED' };
  }
  if (rule.write === false) return { decision: 'deny', code: 'DATABASE_PERMISSION_DENIED' };
  return { decision: 'deny', code: 'DATABASE_PERMISSION_DENIED' };
}

function evaluateDocumentRule(
  access: boolean | string,
  options: {
    auth: RuleAuth | null;
    mode: 'query' | 'get';
    query?: Record<string, unknown>;
    doc?: Record<string, unknown> | null;
  },
  code: 'DATABASE_PERMISSION_DENIED',
): AccessDecision {
  if (access === false || access === true) {
    return access === true ? { decision: 'allow' } : { decision: 'deny', code };
  }
  const clauses = parseRuleExpression(access);
  if (!clauses) return { decision: 'deny', code };
  if (!authOk(clauses, options.auth)) return { decision: 'deny', code };
  for (const clause of clauses) {
    if (clause.kind !== 'doc_eq_uid') continue;
    const uid = options.auth?.uid;
    if (!uid) return { decision: 'deny', code };
    if (options.mode === 'query') {
      const queried = options.query?.[clause.field];
      if (queried !== uid) return { decision: 'deny', code };
    } else {
      const value = options.doc?.[clause.field];
      if (value !== uid) return { decision: 'deny', code };
    }
  }
  return { decision: 'allow' };
}

export function evaluateStorage(options: {
  op: 'read' | 'write';
  path: string;
  auth: RuleAuth | null;
  rules?: StorageRuleFile;
}): AccessDecision {
  const rules = options.rules ?? bundledStorageRules();
  const access = options.op === 'read' ? rules.read : rules.write;
  if (access === false || access === true) {
    return access === true
      ? { decision: 'allow' }
      : { decision: 'deny', code: 'STORAGE_PERMISSION_DENIED' };
  }
  const clauses = parseRuleExpression(access);
  if (!clauses) return { decision: 'deny', code: 'STORAGE_PERMISSION_DENIED' };
  if (!authOk(clauses, options.auth)) return { decision: 'deny', code: 'STORAGE_PERMISSION_DENIED' };
  for (const clause of clauses) {
    if (clause.kind === 'path_prefix' && !options.path.startsWith(clause.prefix)) {
      return { decision: 'deny', code: 'STORAGE_PERMISSION_DENIED' };
    }
  }
  return { decision: 'allow' };
}

export function evaluateInvoke(options: {
  functionName: string;
  auth: RuleAuth | null;
  rules?: FunctionRuleFile;
}): AccessDecision {
  const rules = options.rules ?? bundledFunctionRules();
  const rule = rules[options.functionName];
  if (!rule) return { decision: 'deny', code: 'FUNCTION_PERMISSION_DENIED' };
  const access = rule.invoke;
  if (access === false) return { decision: 'deny', code: 'FUNCTION_PERMISSION_DENIED' };
  if (access === true) return { decision: 'allow' };
  const clauses = parseRuleExpression(access);
  if (!clauses) return { decision: 'deny', code: 'FUNCTION_PERMISSION_DENIED' };
  if (!authOk(clauses, options.auth)) return { decision: 'deny', code: 'FUNCTION_PERMISSION_DENIED' };
  return { decision: 'allow' };
}

export function gatewayAllows(functionName: FunctionName): boolean {
  return (GATEWAY_FUNCTIONS as readonly string[]).includes(functionName);
}

export function isCronFunction(functionName: string): boolean {
  return (CRON_FUNCTIONS as readonly string[]).includes(functionName);
}
