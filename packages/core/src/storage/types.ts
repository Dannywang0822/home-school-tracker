export interface StoredObject {
  body: Uint8Array;
  mime?: string;
}

/** Replaceable object storage. Local tests use memory; CloudBase can implement the same methods later. */
export interface ObjectStorage {
  put(path: string, object: StoredObject): Promise<void>;
  get(path: string): Promise<StoredObject | null>;
  copy(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export class MemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, StoredObject>();

  async put(path: string, object: StoredObject): Promise<void> {
    this.objects.set(path, { body: new Uint8Array(object.body), mime: object.mime });
  }

  async get(path: string): Promise<StoredObject | null> {
    const found = this.objects.get(path);
    return found ? { body: new Uint8Array(found.body), mime: found.mime } : null;
  }

  async copy(from: string, to: string): Promise<void> {
    const found = await this.get(from);
    if (!found) throw new Error('missing object');
    await this.put(to, found);
  }

  async remove(path: string): Promise<void> {
    this.objects.delete(path);
  }
}

export const STORAGE = {
  tmpPrefix: 'hst_tmp/',
  vaultPrefix: 'hst_vault/',
} as const;

export function isSafeObjectPath(path: string): boolean {
  return path.length > 0 && path.length < 300 && !path.includes('..') && !path.includes('\\') && !path.startsWith('/');
}
