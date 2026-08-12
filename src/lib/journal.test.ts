import { describe, it, expect, beforeEach } from 'vitest';
import type { ExecutionJournal } from './types';
import type { JournalStorage } from './journal';
import { newJournal, writeJournal, readJournal, completeJournal } from './journal';

// ── In-memory JournalStorage ─────────────────────────────────────────────────
// The module's storage seam (see journal.ts's doc comment) exists precisely so
// this logic is unit-testable without a chrome runtime.

function makeMemoryStorage(): JournalStorage & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get: async (keys) => {
      if (keys === null) return Object.fromEntries(store);
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (store.has(k)) out[k] = store.get(k);
      return out;
    },
    set: async (items) => {
      for (const [k, v] of Object.entries(items)) store.set(k, v);
    },
    remove: async (key) => { store.delete(key); },
  };
}

function inProgressJournal(taskId: string): ExecutionJournal {
  return {
    ...newJournal(taskId),
    roundCount: 3,
    conversationHistory: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    activeTabId: 42,
    pendingAction: { name: 'web_search', arguments: { query: 'x' }, source: 'native' },
  };
}

describe('completeJournal', () => {
  let storage: ReturnType<typeof makeMemoryStorage>;

  beforeEach(() => {
    storage = makeMemoryStorage();
  });

  it('marks an existing in_progress journal completed and clears pendingAction', async () => {
    const before = inProgressJournal('task-1');
    await writeJournal(before, storage);

    await completeJournal('task-1', storage);

    const after = await readJournal('task-1', storage);
    expect(after?.status).toBe('completed');
    expect(after?.pendingAction).toBeNull();
    // Everything else is preserved verbatim.
    expect(after?.taskId).toBe('task-1');
    expect(after?.roundCount).toBe(3);
    expect(after?.activeTabId).toBe(42);
    expect(after?.conversationHistory).toEqual(before.conversationHistory);
    // updatedAt is refreshed by writeJournal.
    expect(after?.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it('is a no-op when no journal exists for the task', async () => {
    await expect(completeJournal('ghost-task', storage)).resolves.toBeUndefined();
    expect(await readJournal('ghost-task', storage)).toBeNull();
  });

  it('only touches the target task, leaving other journals untouched', async () => {
    await writeJournal(inProgressJournal('task-a'), storage);
    const other = inProgressJournal('task-b');
    await writeJournal(other, storage);

    await completeJournal('task-a', storage);

    expect((await readJournal('task-a', storage))?.status).toBe('completed');
    const untouched = await readJournal('task-b', storage);
    expect(untouched?.status).toBe('in_progress');
    expect(untouched?.pendingAction).toEqual(other.pendingAction);
  });
});
