// Steel browser client - stealth browser with CAPTCHA solving
// Implements Steel Sessions API integration

export interface SteelSession {
  id: string;
  status: 'active' | 'ended' | 'error';
  liveUrl?: string;
  debugUrl?: string;
  createdAt: string;
  projectId: string;
}

export interface SteelCaptcha {
  id: string;
  taskId: string;
  url: string;
  pageId: string;
  type: 'recaptcha' | 'turnstile' | 'image' | 'aws-waf';
  solved: boolean;
  error?: string;
}

export interface SteelClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export class SteelClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(options: SteelClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.steel.dev/v1';
  }

  private async request<T>(endpoint: string, init?: RequestInit): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${endpoint}`, {
      ...init,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    if (!resp.ok) {
      const error = await resp.text();
      throw new Error(`Steel API error ${resp.status}: ${error}`);
    }

    return resp.json();
  }

  async createSession(config?: {
    solveCaptcha?: boolean;
    proxy?: { host: string; port: number; username?: string; password?: string };
    region?: string;
  }): Promise<SteelSession> {
    return this.request<SteelSession>('/sessions', {
      method: 'POST',
      body: JSON.stringify({
        solveCaptcha: config?.solveCaptcha ?? true,
        ...config,
      }),
    });
  }

  async getSession(sessionId: string): Promise<SteelSession> {
    return this.request<SteelSession>(`/sessions/${sessionId}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.request(`/sessions/${sessionId}`, { method: 'DELETE' });
  }

  async getCaptchas(sessionId: string): Promise<SteelCaptcha[]> {
    return this.request<SteelCaptcha[]>(`/sessions/${sessionId}/captchas`);
  }

  async solveCaptchas(sessionId: string, options?: {
    taskId?: string;
    url?: string;
    pageId?: string;
  }): Promise<void> {
    await this.request(`/sessions/${sessionId}/captchas/solve`, {
      method: 'POST',
      body: JSON.stringify(options ?? {}),
    });
  }

  getLiveUrl(session: SteelSession): string | undefined {
    return session.liveUrl;
  }
}

let clientInstance: SteelClient | null = null;

export function getSteelClient(apiKey: string): SteelClient {
  if (!clientInstance || clientInstance['apiKey'] !== apiKey) {
    clientInstance = new SteelClient({ apiKey });
  }
  return clientInstance;
}