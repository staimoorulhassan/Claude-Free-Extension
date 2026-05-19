import type { AppSettings, Conversation } from './types';
import { DEFAULT_SETTINGS } from './types';

const STALE_POLLINATIONS_MODELS = new Set(['openai', 'gemini-fast', 'mistral', 'gemini']);

export async function getSettings(): Promise<AppSettings> {
  const result = await chrome.storage.sync.get(['settings', 'migrations']);
  const saved = result['settings'] as Partial<AppSettings> | undefined;
  const migrations = (result['migrations'] ?? {}) as Record<string, boolean>;

  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    provider: { ...DEFAULT_SETTINGS.provider, ...(saved?.provider ?? {}) },
  };

  let needsSave = false;
  const newMigrations = { ...migrations };

  // Upgrade stale Pollinations model names
  if (
    settings.provider.provider === 'pollinations' &&
    STALE_POLLINATIONS_MODELS.has(settings.provider.defaultModel ?? '')
  ) {
    settings.provider.defaultModel = 'openai-large';
    needsSave = true;
  }

  // Issue 2: one-time migration — enable computer use (was false by old default)
  if (!migrations.computerUseEnabled) {
    settings.computerUseEnabled = true;
    newMigrations.computerUseEnabled = true;
    needsSave = true;
  }

  if (needsSave) {
    chrome.storage.sync.set({ settings, migrations: newMigrations }).catch(() => {});
  }

  return settings;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await chrome.storage.sync.set({ settings });
}

export async function getConversations(): Promise<Conversation[]> {
  const result = await chrome.storage.local.get('conversations');
  return (result['conversations'] as Conversation[]) ?? [];
}

export async function saveConversations(conversations: Conversation[]): Promise<void> {
  await chrome.storage.local.set({ conversations });
}

export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function generateTitle(content: string): string {
  const text = content.slice(0, 60).trim();
  return text.length < content.length ? `${text}…` : text;
}
