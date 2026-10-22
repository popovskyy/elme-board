import path from 'node:path';
import { FileStore } from './file';
import { PgStore } from './pg';
import type { Store } from './types';

let store: Store | null = null;

export function getStore(): Store {
  if (!store) {
    store = process.env.DATABASE_URL
      ? new PgStore(process.env.DATABASE_URL)
      : new FileStore(path.resolve(process.env.BOARD_FILE || './data/board.json'));
  }
  return store;
}

export * from './types';
