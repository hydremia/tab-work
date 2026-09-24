import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { db } from '../data/db';
import { resetIdentityCache } from '../data/identity';

beforeEach(async () => {
  resetIdentityCache();
  await db.delete();
  await db.open();
});

afterEach(() => {
  cleanup();
});
