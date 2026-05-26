// Steel session manager - handles lifecycle and state
// Integrates with Chrome extension storage

import { SteelClient, type SteelSession } from './steel-client';
import type { SteelConfig } from './types';

const SESSION_STORAGE_KEY = 'steel_session';

interface StoredSession {
  sessionId: string;
  createdAt: number;
  liveUrl?: string;
}

export class SteelSessionManager {
  private client: SteelClient;
  private config: SteelConfig;
  private currentSession: SteelSession | null = null;

  constructor(config: SteelConfig) {
    this.config = config;
    this.client = new SteelClient({ apiKey: config.apiKey ?? '' });
  }

  async createOrReuse(): Promise<SteelSession> {
    // Try to reuse existing session if still valid
    if (this.config.sessionId) {
      try {
        const existing = await this.client.getSession(this.config.sessionId);
        if (existing.status === 'active') {
          this.currentSession = existing;
          return existing;
        }
      } catch {
        // Session not valid, create new
      }
    }

    // Create new session
    const session = await this.client.createSession({
      solveCaptcha: this.config.solveCaptcha,
      proxy: this.config.proxy,
      region: this.config.region,
    });

    this.currentSession = session;
    this.saveSession(session);
    return session;
  }

  async close(): Promise<void> {
    if (this.currentSession) {
      try {
        await this.client.closeSession(this.currentSession.id);
      } catch {
        // Ignore errors on close
      }
      this.currentSession = null;
      await this.clearStoredSession();
    }
  }

  getSession(): SteelSession | null {
    return this.currentSession;
  }

  getLiveUrl(): string | undefined {
    return this.currentSession?.liveUrl;
  }

  private saveSession(session: SteelSession): void {
    const stored: StoredSession = {
      sessionId: session.id,
      createdAt: Date.now(),
      liveUrl: session.liveUrl,
    };
    try {
      chrome.storage.local.set({ [SESSION_STORAGE_KEY]: stored });
    } catch {
      // Ignore storage errors
    }
  }

  private async clearStoredSession(): Promise<void> {
    try {
      await chrome.storage.local.remove(SESSION_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

export function createSteelManager(config: SteelConfig): SteelSessionManager {
  return new SteelSessionManager(config);
}