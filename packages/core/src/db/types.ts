export interface Doc {
  _id: string;
  [key: string]: unknown;
}

export type CompareResult =
  | { ok: true; doc: Doc }
  | { ok: false; reason: 'missing' | 'conflict' };

export interface DocStore {
  get(collection: string, id: string): Promise<Doc | null>;
  insert(collection: string, doc: Doc): Promise<void>;
  /**
   * Optimistic update. When expectedVersion is set, the write lands only if the
   * stored version still matches. The stored version then increments by 1.
   */
  compareAndSet(
    collection: string,
    id: string,
    expectedVersion: number | undefined,
    patch: Partial<Doc>,
  ): Promise<CompareResult>;
  query(collection: string, pred: (doc: Doc) => boolean): Promise<Doc[]>;
  count(collection: string, pred?: (doc: Doc) => boolean): Promise<number>;
}
