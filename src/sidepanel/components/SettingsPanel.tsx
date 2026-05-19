import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';
import { PROVIDERS } from '@/lib/openai-compat';
import { fetchProviderModels } from '@/lib/models';
import type { ModelList } from '@/lib/models';
import type { ProviderConfig } from '@/lib/types';

const PROVIDER_KEYS = Object.keys(PROVIDERS);

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={12} height={12}>
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  );
}

function ModelSelector({
  config,
  onChange,
}: {
  config: ProviderConfig;
  onChange: (model: string) => void;
}) {
  const [models, setModels] = useState<ModelList | null>(null);
  const [loading, setLoading] = useState(false);
  const [custom, setCustom] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (cfg: typeof config) => {
    setLoading(true);
    const result = await fetchProviderModels(cfg);
    setModels(result);
    setLoading(false);

    // If current model isn't in the fetched list, show custom input instead
    const all = [...result.free, ...result.paid];
    const current = cfg.defaultModel ?? '';
    if (current && all.length > 0 && !all.includes(current)) {
      setCustom(true);
    }
  }, []);

  // Debounce fetch on provider / apiKey / baseURL change
  useEffect(() => {
    setModels(null);
    setCustom(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => load(config), 600);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.provider, config.apiKey, config.baseURL]);

  const hasModels = !!models && (models.free.length + models.paid.length) > 0;
  const current = config.defaultModel ?? '';
  const preset = PROVIDERS[config.provider];

  return (
    <div className="field">
      <div className="model-label-row">
        <label>Model</label>
        <span className="model-label-actions">
          {loading && <span className="model-fetching">fetching…</span>}
          {!loading && (
            <button
              className="model-refresh-btn"
              title="Refresh model list"
              onClick={() => load(config)}
            >
              <RefreshIcon />
            </button>
          )}
          {!loading && hasModels && (
            <button
              className="model-mode-btn"
              onClick={() => setCustom(c => !c)}
            >
              {custom ? 'pick from list' : 'type custom'}
            </button>
          )}
        </span>
      </div>

      {hasModels && !custom ? (
        <select
          value={current}
          onChange={e => onChange(e.target.value)}
        >
          {/* Blank option so nothing is pre-selected when value isn't in list */}
          {!current && <option value="">— choose a model —</option>}
          {models!.free.length > 0 && (
            <optgroup label="Free">
              {models!.free.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </optgroup>
          )}
          {models!.paid.length > 0 && (
            <optgroup label="Paid">
              {models!.paid.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </optgroup>
          )}
        </select>
      ) : (
        <input
          type="text"
          value={current}
          onChange={e => onChange(e.target.value)}
          placeholder={
            loading ? 'Loading…' : preset?.defaultModel ?? 'model name'
          }
        />
      )}
    </div>
  );
}

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

          <ModelSelector
            config={settings.provider}
            onChange={model => set({ provider: { ...settings.provider, defaultModel: model || undefined } })}
          />
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
            <select
              value={settings.theme}
              onChange={e => set({ theme: e.target.value as 'auto' | 'light' | 'dark' })}
            >
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
