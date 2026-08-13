import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ExecutionJournal } from './types';
import type { JournalStorage } from './journal';
import {
  newJournal, writeJournal, readJournal, completeJournal, abortJournal,
  addTaskTab, removeTaskTab, getTaskTabs, resolveJournalOnStartup,
} from './journal';

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

describe('abortJournal (B: terminal-state lifecycle)', () => {
  let storage: ReturnType<typeof makeMemoryStorage>;

  beforeEach(() => {
    storage = makeMemoryStorage();
  });

  it('marks an in_progress journal aborted and clears pendingAction', async () => {
    await writeJournal(inProgressJournal('task-1'), storage);

    await abortJournal('task-1', storage);

    const after = await readJournal('task-1', storage);
    expect(after?.status).toBe('aborted');
    expect(after?.pendingAction).toBeNull();
    expect(after?.roundCount).toBe(3);
  });

  it('is a no-op when no journal exists for the task', async () => {
    await expect(abortJournal('ghost-task', storage)).resolves.toBeUndefined();
    expect(await readJournal('ghost-task', storage)).toBeNull();
  });
});

describe('terminal-state guard (B: terminal statuses are final)', () => {
  let storage: ReturnType<typeof makeMemoryStorage>;

  beforeEach(() => {
    storage = makeMemoryStorage();
  });

  it('completeJournal refuses to overwrite an aborted journal', async () => {
    await writeJournal(inProgressJournal('task-1'), storage);
    await abortJournal('task-1', storage);

    await completeJournal('task-1', storage);

    expect((await readJournal('task-1', storage))?.status).toBe('aborted');
  });

  it('abortJournal refuses to overwrite a completed journal', async () => {
    await writeJournal(inProgressJournal('task-1'), storage);
    await completeJournal('task-1', storage);

    await abortJournal('task-1', storage);

    expect((await readJournal('task-1', storage))?.status).toBe('completed');
  });

  it('both refuse to overwrite an orphaned journal', async () => {
    await writeJournal({ ...inProgressJournal('task-1'), status: 'orphaned' }, storage);

    await completeJournal('task-1', storage);
    await abortJournal('task-1', storage);

    expect((await readJournal('task-1', storage))?.status).toBe('orphaned');
  });
});

describe('tab assignment persistence (A: journal-owned opened tabs)', () => {
  let storage: ReturnType<typeof makeMemoryStorage>;

  beforeEach(() => {
    storage = makeMemoryStorage();
  });

  it('adds tabs to the journal and persists them across reads', async () => {
    await writeJournal(inProgressJournal('task-1'), storage);

    await addTaskTab('task-1', 101, storage);
    await addTaskTab('task-1', 102, storage);

    expect(await getTaskTabs('task-1', storage)).toEqual([101, 102]);
  });

  it('is idempotent for a tab already in the set', async () => {
    await writeJournal(inProgressJournal('task-1'), storage);

    await addTaskTab('task-1', 101, storage);
    await addTaskTab('task-1', 101, storage);

    expect(await getTaskTabs('task-1', storage)).toEqual([101]);
  });

  it('is a no-op when no journal exists for the task', async () => {
    await addTaskTab('ghost-task', 101, storage);

    expect(await getTaskTabs('ghost-task', storage)).toEqual([]);
    expect(await readJournal('ghost-task', storage)).toBeNull();
  });

  it('removes a tab from the set', async () => {
    await writeJournal(inProgressJournal('task-1'), storage);
    await addTaskTab('task-1', 101, storage);
    await addTaskTab('task-1', 102, storage);

    await removeTaskTab('task-1', 101, storage);

    expect(await getTaskTabs('task-1', storage)).toEqual([102]);
  });

  it('remove is a no-op when the tab is not in the set', async () => {
    await writeJournal(inProgressJournal('task-1'), storage);
    await addTaskTab('task-1', 101, storage);

    await removeTaskTab('task-1', 999, storage);

    expect(await getTaskTabs('task-1', storage)).toEqual([101]);
  });

  // Terminal journals are final: a mirror landing after abort/complete must
  // never resurrect the journal or mutate its tab set.
  it('addTaskTab is a no-op on a terminal journal', async () => {
    await writeJournal({ ...inProgressJournal('task-1'), status: 'aborted' }, storage);

    await addTaskTab('task-1', 101, storage);

    const after = await readJournal('task-1', storage);
    expect(after?.status).toBe('aborted');
    expect(after?.openedTabIds ?? []).toEqual([]);
  });

  it('removeTaskTab is a no-op on a terminal journal', async () => {
    await writeJournal({ ...inProgressJournal('task-1'), status: 'aborted', openedTabIds: [101] }, storage);

    await removeTaskTab('task-1', 101, storage);

    const after = await readJournal('task-1', storage);
    expect(after?.status).toBe('aborted');
    expect(after?.openedTabIds).toEqual([101]);
  });
});

describe('resolveJournalOnStartup with persisted tab assignments (A)', () => {
  let storage: ReturnType<typeof makeMemoryStorage>;

  beforeEach(() => {
    storage = makeMemoryStorage();
  });

  it('resumes without verifying when no tabs were persisted (nothing to check)', async () => {
    const journal = inProgressJournal('task-1');
    journal.openedTabIds = [];
    const verify = vi.fn(async () => { throw new Error('verify must not be called'); });

    const { resumed } = await resolveJournalOnStartup(journal, verify, storage);

    expect(resumed).toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it('orphans the task when every persisted tab is gone', async () => {
    const journal = { ...inProgressJournal('task-1'), openedTabIds: [101, 102] };
    const verify = vi.fn(async () => false);

    const { journal: resolved, resumed } = await resolveJournalOnStartup(journal, verify, storage);

    expect(resumed).toBe(false);
    expect(resolved.status).toBe('orphaned');
    expect(verify).toHaveBeenCalledTimes(1);
    // Orphaned is terminal — a second resolve is a no-op and never re-verifies.
    const again = await resolveJournalOnStartup(resolved, verify, storage);
    expect(again.resumed).toBe(false);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('resumes when at least one persisted tab still exists', async () => {
    const journal = { ...inProgressJournal('task-1'), openedTabIds: [101, 102] };
    const verify = vi.fn(async () => true);

    const { journal: resolved, resumed } = await resolveJournalOnStartup(journal, verify, storage);

    expect(resumed).toBe(true);
    expect(resolved.status).toBe('in_progress');
  });
});
