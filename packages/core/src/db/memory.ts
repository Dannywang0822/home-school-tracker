import { AppError } from '../app-error.js';
import type { CompareResult, Doc, DocStore } from './types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryStore implements DocStore {
  private readonly tables = new Map<string, Map<string, Doc>>();

  private table(collection: string): Map<string, Doc> {
    let table = this.tables.get(collection);
    if (!table) {
      table = new Map();
      this.tables.set(collection, table);
    }
    return table;
  }

  async get(collection: string, id: string): Promise<Doc | null> {
    const doc = this.table(collection).get(id);
    return doc ? clone(doc) : null;
  }

  async insert(collection: string, doc: Doc): Promise<void> {
    const table = this.table(collection);
    if (table.has(doc._id)) {
      throw new AppError('ALREADY_EXISTS', '记录已存在');
    }
    table.set(doc._id, clone(doc));
  }

  async compareAndSet(
    collection: string,
    id: string,
    expectedVersion: number | undefined,
    patch: Partial<Doc>,
  ): Promise<CompareResult> {
    const table = this.table(collection);
    const current = table.get(id);
    if (!current) return { ok: false, reason: 'missing' };
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      return { ok: false, reason: 'conflict' };
    }
    const next: Doc = { ...clone(current), ...clone(patch), _id: current._id };
    if (typeof current.version === 'number') {
      next.version = current.version + 1;
    }
    table.set(id, next);
    return { ok: true, doc: clone(next) };
  }

  async query(collection: string, pred: (doc: Doc) => boolean): Promise<Doc[]> {
    const rows: Doc[] = [];
    for (const doc of this.table(collection).values()) {
      if (pred(doc)) rows.push(clone(doc));
    }
    return rows;
  }

  async count(collection: string, pred?: (doc: Doc) => boolean): Promise<number> {
    if (!pred) return this.table(collection).size;
    let n = 0;
    for (const doc of this.table(collection).values()) {
      if (pred(doc)) n += 1;
    }
    return n;
  }
}
