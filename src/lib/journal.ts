import type { ExecutionJournal } from './types';

/**
 * Execution journal persistence (spec 001-claude-free-extension, US3 / FR-009-012).
 *
 * Storage is injected (defaults to chrome.storage.local) so the serialize/resume/
 * orphan-detection logic can be unit-tested without a real chrome runtime — see
 * research.md §1: this is the one piece of the endurance story that's genuinely
 * unit-testable, unlike the offscreen heartbeat or service-worker lifecycle itself.
 */
export interface JournalStorage {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

function chromeStorageAdapter(): JournalStorage {
  return {
    get: (keys) => new Promise(resolve => chrome.storage.local.get(keys, resolve)),
    set: (items) => new Promise(resolve => chrome.storage.local.set(items, () => resolve())),
    remove: (key) => new Promise(resolve => chrome.storage.local.remove(key, () => resolve())),
  };
}

function journalKey(taskId: string): string {
  return `journal:${taskId}`;
}

export function newJournal(taskId: string): ExecutionJournal {
  const now = Date.now();
  return {
    taskId,
    roundCount: 0,
    conversationHistory: [],
    activeTabId: null,
    activeGroupId: null,
    openedTabIds: [],
    pendingAction: null,
    status: 'in_progress',
    createdAt: now,
    updatedAt: now,
  };
}

/** Writes the journal atomically (single chrome.storage.local.set call — the API is
 * already atomic per-key) after every completed tool round. */
export async function writeJournal(journal: ExecutionJournal, storage: JournalStorage = chromeStorageAdapter()): Promise<void> {
  const updated: ExecutionJournal = { ...journal, updatedAt: Date.now() };
  await storage.set({ [journalKey(journal.taskId)]: updated });
}

export async function readJournal(taskId: string, storage: JournalStorage = chromeStorageAdapter()): Promise<ExecutionJournal | null> {
  const key = journalKey(taskId);
  const result = await storage.get(key);
  return (result[key] as ExecutionJournal | undefined) ?? null;
}

/** Marks a task's journal completed (terminal). No-op when no journal exists for
 * the task — the caller's taskId may reference a task that never journaled — and
 * a terminal status is never overwritten: completed/aborted/orphaned are final,
 * so a late AGENT_STOPPED can't flip an aborted task back to completed. */
export async function completeJournal(taskId: string, storage: JournalStorage = chromeStorageAdapter()): Promise<void> {
  const journal = await readJournal(taskId, storage);
  if (journal && !isTerminal(journal.status)) await writeJournal({ ...journal, status: 'completed', pendingAction: null }, storage);
}

/** Marks a task's journal aborted (terminal) — the durable twin of completeJournal,
 * used by TAB_GROUP_TERMINATE. Same no-op and terminal-guard rules. */
export async function abortJournal(taskId: string, storage: JournalStorage = chromeStorageAdapter()): Promise<void> {
  const journal = await readJournal(taskId, storage);
  if (journal && !isTerminal(journal.status)) await writeJournal({ ...journal, status: 'aborted', pendingAction: null }, storage);
}

function isTerminal(status: ExecutionJournal['status']): boolean {
  return status === 'completed' || status === 'aborted' || status === 'orphaned';
}

export async function deleteJournal(taskId: string, storage: JournalStorage = chromeStorageAdapter()): Promise<void> {
  await storage.remove(journalKey(taskId));
}

/** Adds a tab to the task's persisted opened-tab set — the durable mirror of
 * background.ts's in-session Set, so TAB_GROUP_TERMINATE can still close the
 * task's tabs after a service-worker restart wiped the in-memory Set. No-op when
 * no journal exists, when the tab is already present, or when the journal is
 * already terminal (terminal statuses are final — a late mirror must never
 * resurrect one). */
export async function addTaskTab(taskId: string, tabId: number, storage: JournalStorage = chromeStorageAdapter()): Promise<void> {
  const journal = await readJournal(taskId, storage);
  if (!journal || isTerminal(journal.status)) return;
  const openedTabIds = journal.openedTabIds ?? [];
  if (openedTabIds.includes(tabId)) return;
  await writeJournal({ ...journal, openedTabIds: [...openedTabIds, tabId] }, storage);
}

/** Removes a tab from the task's persisted opened-tab set (fires from
 * chrome.tabs.onRemoved, which sees every tab close — a tab not in the set is a
 * no-op, so tabs the task didn't open never cause a write). No-op on terminal
 * journals for the same reason as addTaskTab: the mirror must never overwrite
 * the terminal status with a stale in_progress read. */
export async function removeTaskTab(taskId: string, tabId: number, storage: JournalStorage = chromeStorageAdapter()): Promise<void> {
  const journal = await readJournal(taskId, storage);
  if (!journal || isTerminal(journal.status)) return;
  const openedTabIds = (journal.openedTabIds ?? []).filter(id => id !== tabId);
  if (openedTabIds.length === (journal.openedTabIds ?? []).length) return;
  await writeJournal({ ...journal, openedTabIds }, storage);
}

/** The task's persisted opened-tab set — what a service-worker restart needs to
 * recover tab ownership (terminate-after-restart, orphan verification). */
export async function getTaskTabs(taskId: string, storage: JournalStorage = chromeStorageAdapter()): Promise<number[]> {
  const journal = await readJournal(taskId, storage);
  return journal?.openedTabIds ?? [];
}

/** All journals currently marked in_progress — what a service-worker restart needs
 * to check on init (research.md §5). Fetches everything (null keys) then filters by
 * the `journal:` prefix, since chrome.storage.local has no key-prefix query. */
export async function findInProgressJournals(storage: JournalStorage = chromeStorageAdapter()): Promise<ExecutionJournal[]> {
  const all = await storage.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith('journal:'))
    .map(([, value]) => value as ExecutionJournal)
    .filter(j => j.status === 'in_progress');
}

export type ResumeVerifier = (journal: ExecutionJournal) => Promise<boolean>;

/**
 * Resume-on-init flow (research.md §5): verify the journaled opened tabs still
 * exist before resuming; mark orphaned (terminal) rather than silently resuming
 * against a working set that's gone, or silently dropping the task. Verification
 * targets the persisted opened-tab set — activeTabId is hard-nulled by the store's
 * round snapshot, so it was never a real verification target.
 */
export async function resolveJournalOnStartup(
  journal: ExecutionJournal,
  verifyTabExists: ResumeVerifier,
  storage: JournalStorage = chromeStorageAdapter(),
): Promise<{ journal: ExecutionJournal; resumed: boolean }> {
  if (journal.status !== 'in_progress') return { journal, resumed: false };

  const tabExists = (journal.openedTabIds ?? []).length === 0 || (await verifyTabExists(journal));
  if (!tabExists) {
    const orphaned: ExecutionJournal = { ...journal, status: 'orphaned', pendingAction: null, updatedAt: Date.now() };
    await writeJournal(orphaned, storage);
    return { journal: orphaned, resumed: false };
  }
  return { journal, resumed: true };
}
