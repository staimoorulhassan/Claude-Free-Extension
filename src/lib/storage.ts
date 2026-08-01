import type { AppSettings, Conversation } from './types';
import { DEFAULT_SETTINGS } from './types';

// ── Per-provider vault (local only — never synced to Google servers) ───────────
// Stores each provider's API key and last-used model separately so switching
// providers never loses a previously-entered key.

export interface ProviderSave {
  apiKey: string;
  model?: string;
}

export type ProviderVault = Record<string, ProviderSave>;

export async function getProviderVault(): Promise<ProviderVault> {
  const data = await chrome.storage.local.get('providerVault');
  return (data['providerVault'] as ProviderVault) ?? {};
}

export async function saveProviderVault(vault: ProviderVault): Promise<void> {
  await chrome.storage.local.set({ providerVault: vault });
}

const STALE_POLLINATIONS_MODELS = new Set(['openai', 'gemini-fast', 'mistral', 'gemini']);

export async function getSettings(): Promise<AppSettings> {
  // Settings live in chrome.storage.local: sync caps each item at 8 KB
  // (QUOTA_BYTES_PER_ITEM), which a long custom systemPrompt blows past and
  // triggers "kQuotaBytesPerItem quota exceeded". local has no per-item cap and
  // we already request unlimitedStorage. Migrate any legacy sync copy once.
  const local = await chrome.storage.local.get(['settings', 'migrations']);
  let saved = local['settings'] as Partial<AppSettings> | undefined;
  let migrations = (local['migrations'] ?? {}) as Record<string, boolean>;

  if (!saved) {
    const legacy = await chrome.storage.sync.get(['settings', 'migrations']);
    if (legacy['settings']) {
      saved = legacy['settings'] as Partial<AppSettings>;
      migrations = (legacy['migrations'] ?? migrations) as Record<string, boolean>;
      // Clear the oversized sync copy so it stops throwing on write.
      chrome.storage.sync.remove(['settings', 'migrations']).catch(() => {});
    }
  }

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

  // Drop the legacy 28 KB corrupted default prompt if it got persisted before.
  if (settings.systemPrompt && settings.systemPrompt.includes('FREE-Claude-by-ST')) {
    settings.systemPrompt = '';
    needsSave = true;
  }

  if (needsSave) {
    chrome.storage.local.set({ settings, migrations: newMigrations }).catch(() => {});
  }

  return settings;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await chrome.storage.local.set({ settings });
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
