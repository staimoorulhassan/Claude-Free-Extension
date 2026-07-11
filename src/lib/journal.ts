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

export async function deleteJournal(taskId: string, storage: JournalStorage = chromeStorageAdapter()): Promise<void> {
  await storage.remove(journalKey(taskId));
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
 * Resume-on-init flow (research.md §5): verify the journaled tab/group still exist
 * before resuming; mark orphaned (terminal) rather than silently resuming against
 * a tab that's gone, or silently dropping the task.
 *
 * Reconciles any pendingAction before returning: a restart mid-action means we can't
 * know whether the browser action completed or not. Safe strategy: clear it and let
 * the next LLM round re-perceive the actual page state rather than replay an action
 * that might have already happened (idempotent reconciliation — multiple restarts
 * won't duplicate or lose the action).
 */
export async function resolveJournalOnStartup(
  journal: ExecutionJournal,
  verifyTabExists: ResumeVerifier,
  storage: JournalStorage = chromeStorageAdapter(),
): Promise<{ journal: ExecutionJournal; resumed: boolean }> {
  if (journal.status !== 'in_progress') return { journal, resumed: false };

  const tabExists = journal.activeTabId === null || (await verifyTabExists(journal));
  if (!tabExists) {
    const orphaned: ExecutionJournal = { ...journal, status: 'orphaned', pendingAction: null, updatedAt: Date.now() };
    await writeJournal(orphaned, storage);
    return { journal: orphaned, resumed: false };
  }

  // Reconcile pendingAction: if it's non-null, the restart happened mid-action. We
  // don't know if it completed or not, so clear it and let the next round's perception
  // (read_page_state) tell the model what state the page is actually in. This prevents
  // duplicate execution if the action did finish before the restart, and allows the
  // model to retry if it didn't — idempotent across multiple restarts.
  if (journal.pendingAction !== null) {
    const reconciled: ExecutionJournal = { ...journal, pendingAction: null, updatedAt: Date.now() };
    await writeJournal(reconciled, storage);
    return { journal: reconciled, resumed: true };
  }

  return { journal, resumed: true };
}
