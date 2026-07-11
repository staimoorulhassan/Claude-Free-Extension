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
 * Reconciles pendingAction: a browser action interrupted mid-execution cannot be
 * reliably replayed (no idempotency guarantee — e.g. a click may have fired but the
 * response wasn't journaled yet), so we clear it and let the LLM retry from the last
 * completed round's conversation state if needed. This is idempotent: restarting again
 * won't re-execute or lose the action, since it's already been settled to null.
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

  // Reconcile pendingAction before resuming: clear it so a restart can't duplicate the
  // interrupted browser action. The LLM will retry from the last completed round if needed.
  const settled: ExecutionJournal = { ...journal, pendingAction: null, updatedAt: Date.now() };
  await writeJournal(settled, storage);
  return { journal: settled, resumed: true };
}
