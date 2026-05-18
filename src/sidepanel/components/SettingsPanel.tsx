import { useStore } from '../store';
import { PROVIDERS } from '@/lib/openai-compat';

const PROVIDER_KEYS = Object.keys(PROVIDERS);

export function SettingsPanel() {
  const settings = useStore(s => s.settings);
  const updateSettings = useStore(s => s.updateSettings);

  const set = (patch: Parameters<typeof updateSettings>[0]) => updateSettings(patch);

  return (
    <div className="settings">
      <div className="settings-section">
        <div className="settings-label">Provider</div>
        <div className="settings-group">
          <div className="field">
            <label>Provider</label>
            <select
              value={settings.provider.provider}
              onChange={e => set({ provider: { ...settings.provider, provider: e.target.value } })}
            >
              {PROVIDER_KEYS.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
              <option value="custom">custom</option>
            </select>
          </div>
          <div className="field">
            <label>API Key</label>
            <input
              type="password"
              value={settings.provider.apiKey}
              onChange={e => set({ provider: { ...settings.provider, apiKey: e.target.value } })}
              placeholder="Leave blank for key-free providers (Pollinations)"
            />
          </div>
          <div className="field">
            <label>Base URL (optional override)</label>
            <input
              type="url"
              value={settings.provider.baseURL ?? ''}
              onChange={e => set({ provider: { ...settings.provider, baseURL: e.target.value || undefined } })}
              placeholder={PROVIDERS[settings.provider.provider]?.baseURL ?? 'https://...'}
            />
          </div>
          <div className="field">
            <label>Default model</label>
            <input
              type="text"
              value={settings.provider.defaultModel ?? ''}
              onChange={e => set({ provider: { ...settings.provider, defaultModel: e.target.value || undefined } })}
              placeholder={PROVIDERS[settings.provider.provider]?.defaultModel ?? 'model name'}
            />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">Conversation</div>
        <div className="settings-group">
          <div className="field">
            <label>System prompt</label>
            <textarea
              value={settings.systemPrompt}
              onChange={e => set({ systemPrompt: e.target.value })}
              placeholder="Optional instructions prepended to every conversation…"
            />
          </div>
          <div className="field">
            <label>Max tokens: {settings.maxTokens}</label>
            <input
              type="range"
              min={256}
              max={32000}
              step={256}
              value={settings.maxTokens}
              onChange={e => set({ maxTokens: Number(e.target.value) })}
            />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">Features</div>
        <div className="settings-group">
          <div className="toggle-row">
            <label>Computer use (browser control)</label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.computerUseEnabled}
                onChange={e => set({ computerUseEnabled: e.target.checked })}
              />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">Appearance</div>
        <div className="settings-group">
          <div className="field">
            <label>Theme</label>
            <select value={settings.theme} onChange={e => set({ theme: e.target.value as 'auto' | 'light' | 'dark' })}>
              <option value="auto">Auto (system)</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
