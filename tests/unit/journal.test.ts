import { describe, it, expect, vi } from 'vitest';
import {
  newJournal, writeJournal, readJournal, deleteJournal,
  findInProgressJournals, resolveJournalOnStartup, type JournalStorage,
} from '@/lib/journal';

function createMockStorage(): JournalStorage {
  const store = new Map<string, unknown>();
  return {
    get: async (keys) => {
      if (keys === null) return Object.fromEntries(store.entries());
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (store.has(k)) out[k] = store.get(k);
      return out;
    },
    set: async (items) => {
      for (const [k, v] of Object.entries(items)) store.set(k, v);
    },
    remove: async (key) => {
      store.delete(key);
    },
  };
}

describe('journal', () => {
  it('newJournal starts in_progress with round 0', () => {
    const j = newJournal('task-1');
    expect(j.status).toBe('in_progress');
    expect(j.roundCount).toBe(0);
    expect(j.pendingAction).toBeNull();
  });

  it('write then read round-trips the journal', async () => {
    const storage = createMockStorage();
    const j = { ...newJournal('task-1'), roundCount: 3 };
    await writeJournal(j, storage);
    const read = await readJournal('task-1', storage);
    expect(read?.roundCount).toBe(3);
    expect(read?.taskId).toBe('task-1');
  });

  it('writeJournal bumps updatedAt', async () => {
    const storage = createMockStorage();
    const j = newJournal('task-1');
    const before = j.updatedAt;
    await new Promise(r => setTimeout(r, 5));
    await writeJournal(j, storage);
    const read = await readJournal('task-1', storage);
    expect(read!.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('readJournal returns null for an unknown taskId', async () => {
    const storage = createMockStorage();
    expect(await readJournal('nope', storage)).toBeNull();
  });

  it('deleteJournal removes it', async () => {
    const storage = createMockStorage();
    await writeJournal(newJournal('task-1'), storage);
    await deleteJournal('task-1', storage);
    expect(await readJournal('task-1', storage)).toBeNull();
  });

  it('findInProgressJournals only returns in_progress ones, ignores non-journal keys', async () => {
    const storage = createMockStorage();
    await writeJournal(newJournal('task-1'), storage);
    await writeJournal({ ...newJournal('task-2'), status: 'completed' }, storage);
    await storage.set({ providerVault: { foo: 'bar' } });

    const found = await findInProgressJournals(storage);
    expect(found).toHaveLength(1);
    expect(found[0].taskId).toBe('task-1');
  });

  it('resolveJournalOnStartup resumes when the tab still exists', async () => {
    const storage = createMockStorage();
    const j = { ...newJournal('task-1'), activeTabId: 42 };
    const { journal, resumed } = await resolveJournalOnStartup(j, async () => true, storage);
    expect(resumed).toBe(true);
    expect(journal.status).toBe('in_progress');
  });

  it('resolveJournalOnStartup marks orphaned and persists it when the tab is gone', async () => {
    const storage = createMockStorage();
    const j = { ...newJournal('task-1'), activeTabId: 42 };
    const { journal, resumed } = await resolveJournalOnStartup(j, async () => false, storage);
    expect(resumed).toBe(false);
    expect(journal.status).toBe('orphaned');

    const persisted = await readJournal('task-1', storage);
    expect(persisted?.status).toBe('orphaned');
  });

  it('resolveJournalOnStartup resumes without checking when there is no active tab', async () => {
    const storage = createMockStorage();
    const verify = vi.fn().mockResolvedValue(false);
    const j = newJournal('task-1'); // activeTabId: null
    const { resumed } = await resolveJournalOnStartup(j, verify, storage);
    expect(resumed).toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it('resolveJournalOnStartup is a no-op for a journal that is not in_progress', async () => {
    const storage = createMockStorage();
    const j = { ...newJournal('task-1'), status: 'completed' as const };
    const { journal, resumed } = await resolveJournalOnStartup(j, async () => true, storage);
    expect(resumed).toBe(false);
    expect(journal.status).toBe('completed');
  });
});
