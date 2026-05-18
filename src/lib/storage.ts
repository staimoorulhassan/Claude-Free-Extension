import type { AppSettings, Conversation } from './types';
import { DEFAULT_SETTINGS } from './types';

export async function getSettings(): Promise<AppSettings> {
  const result = await chrome.storage.sync.get('settings');
  const saved = result['settings'] as Partial<AppSettings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    provider: { ...DEFAULT_SETTINGS.provider, ...(saved?.provider ?? {}) },
  };
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
