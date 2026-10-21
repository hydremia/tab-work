import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { db } from '../data/db';
import { resetIdentityCache } from '../data/identity';

// findBy* / waitFor: the unit page and the project pages are heavy; under a loaded full-suite run (every file in its
// own worker) a first render can take more than the 1 s default on a slower machine. A test that is wrong still
// fails, only later.
configure({ asyncUtilTimeout: 5000 });

beforeEach(async () => {
  resetIdentityCache();
  await db.delete();
  await db.open();
});

afterEach(() => {
  cleanup();
});
