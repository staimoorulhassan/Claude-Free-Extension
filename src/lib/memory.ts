/**
 * Cross-session memory persistence for learned context.
 * 
 * Stores key-value pairs in chrome.storage.local under the "memory:" prefix,
 * allowing the agent to remember site structures, user preferences, and
 * learned patterns across sessions.
 */

import type { MemoryEntry } from './types';
import { generateId } from './storage';

const MEMORY_PREFIX = 'memory:';

function storageGet(keys: string[]): Promise<Record<string, unknown>> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return Promise.resolve({});
  }
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return Promise.resolve();
  }
  return new Promise(resolve => chrome.storage.local.set(items, resolve));
}

function storageRemove(keys: string[]): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return Promise.resolve();
  }
  return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

/**
 * Save or update a memory entry.
 * If a memory with the same key exists, update it; otherwise create new.
 */
export async function saveMemory(
  key: string,
  value: string,
  category: MemoryEntry['category'] = 'learned',
  maxEntries: number = 100,
): Promise<MemoryEntry> {
  const entries = await getAllMemories();
  
  // Check if key already exists
  const existing = entries.find(e => e.key === key);
  if (existing) {
    const updated: MemoryEntry = {
      ...existing,
      value,
      category,
      updatedAt: Date.now(),
      accessCount: existing.accessCount + 1,
    };
    await storageSet({ [MEMORY_PREFIX + existing.id]: updated });
    return updated;
  }
  
  // Enforce max entries - remove oldest by access count
  if (entries.length >= maxEntries) {
    const sorted = [...entries].sort((a, b) => a.accessCount - b.accessCount);
    const toRemove = sorted.slice(0, Math.max(1, entries.length - maxEntries + 1));
    await storageRemove(toRemove.map(e => MEMORY_PREFIX + e.id));
  }
  
  const entry: MemoryEntry = {
    id: generateId(),
    key,
    value,
    category,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    accessCount: 1,
  };
  
  await storageSet({ [MEMORY_PREFIX + entry.id]: entry });
  return entry;
}

/**
 * Get a memory entry by key.
 * Returns null if not found.
 */
export async function getMemory(key: string): Promise<MemoryEntry | null> {
  const entries = await getAllMemories();
  const entry = entries.find(e => e.key === key);
  if (entry) {
    // Increment access count
    entry.accessCount++;
    await storageSet({ [MEMORY_PREFIX + entry.id]: entry });
  }
  return entry ?? null;
}

/**
 * Get all memory entries, optionally filtered by category.
 */
export async function getAllMemories(category?: MemoryEntry['category']): Promise<MemoryEntry[]> {
  const all = await storageGet([]);
  const entries: MemoryEntry[] = [];
  
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(MEMORY_PREFIX) && value && typeof value === 'object') {
      const entry = value as MemoryEntry;
      if (!category || entry.category === category) {
        entries.push(entry);
      }
    }
  }
  
  return entries.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Search memories by key or value content.
 */
export async function searchMemories(query: string): Promise<MemoryEntry[]> {
  const entries = await getAllMemories();
  const lowerQuery = query.toLowerCase();
  
  return entries.filter(e => 
    e.key.toLowerCase().includes(lowerQuery) ||
    e.value.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Delete a memory entry by key.
 */
export async function deleteMemory(key: string): Promise<boolean> {
  const entries = await getAllMemories();
  const entry = entries.find(e => e.key === key);
  if (!entry) return false;
  
  await storageRemove([MEMORY_PREFIX + entry.id]);
  return true;
}

/**
 * Clear all memories, optionally only for a specific category.
 */
export async function clearMemories(category?: MemoryEntry['category']): Promise<number> {
  const entries = await getAllMemories(category);
  if (entries.length === 0) return 0;
  
  await storageRemove(entries.map(e => MEMORY_PREFIX + e.id));
  return entries.length;
}

/**
 * Build a memory context string for injection into the system prompt.
 * Returns the top N most relevant memories as formatted text.
 */
export async function buildMemoryContext(maxEntries: number = 20): Promise<string> {
  const entries = await getAllMemories();
  if (entries.length === 0) return '';
  
  // Take top entries by access count (most used = most relevant)
  const top = entries
    .sort((a, b) => b.accessCount - a.accessCount)
    .slice(0, maxEntries);
  
  const lines = ['[PERSISTENT MEMORY - learned from previous sessions]'];
  for (const e of top) {
    lines.push(`- [${e.category}] ${e.key}: ${e.value.slice(0, 200)}`);
  }
  
  return lines.join('\n');
}
