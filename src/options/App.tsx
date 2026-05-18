import { useEffect, useState } from 'react';
import { getSettings, saveSettings } from '@/lib/storage';
import { PROVIDERS } from '@/lib/openai-compat';
import type { AppSettings } from '@/lib/types';
import { DEFAULT_SETTINGS } from '@/lib/types';

const PROVIDER_KEYS = Object.keys(PROVIDERS);

export function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  const update = (patch: Partial<AppSettings>) => {
    setSettings(s => ({ ...s, ...patch, provider: { ...s.provider, ...(patch.provider ?? {}) } }));
  };

  const handleSave = async () => {
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 24px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 14, color: '#1a1a1a' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24, color: '#c96442' }}>Claude Free — Settings</h1>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9b9790', marginBottom: 12 }}>Provider</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Provider">
            <select value={settings.provider.provider} onChange={e => update({ provider: { ...settings.provider, provider: e.target.value } })}>
              {PROVIDER_KEYS.map(p => <option key={p} value={p}>{p}</option>)}
              <option value="custom">custom</option>
            </select>
          </Field>
          <Field label="API Key">
            <input type="password" value={settings.provider.apiKey} onChange={e => update({ provider: { ...settings.provider, apiKey: e.target.value } })} placeholder="Leave blank for key-free providers (Pollinations)" />
          </Field>
          <Field label="Base URL (optional)">
            <input type="url" value={settings.provider.baseURL ?? ''} onChange={e => update({ provider: { ...settings.provider, baseURL: e.target.value || undefined } })} placeholder={PROVIDERS[settings.provider.provider]?.baseURL ?? 'https://...'} />
          </Field>
          <Field label="Default model">
            <input type="text" value={settings.provider.defaultModel ?? ''} onChange={e => update({ provider: { ...settings.provider, defaultModel: e.target.value || undefined } })} placeholder={PROVIDERS[settings.provider.provider]?.defaultModel ?? 'model name'} />
          </Field>
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9b9790', marginBottom: 12 }}>Conversation</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="System prompt">
            <textarea
              value={settings.systemPrompt}
              onChange={e => update({ systemPrompt: e.target.value })}
              placeholder="Optional instructions prepended to every conversation…"
              rows={4}
            />
          </Field>
          <Field label={`Max tokens: ${settings.maxTokens}`}>
            <input type="range" min={256} max={32000} step={256} value={settings.maxTokens} onChange={e => update({ maxTokens: Number(e.target.value) })} style={{ accentColor: '#c96442' }} />
          </Field>
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9b9790', marginBottom: 12 }}>Features</h2>
        <ToggleRow label="Computer use (browser control)" checked={settings.computerUseEnabled} onChange={v => update({ computerUseEnabled: v })} />
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9b9790', marginBottom: 12 }}>Appearance</h2>
        <Field label="Theme">
          <select value={settings.theme} onChange={e => update({ theme: e.target.value as AppSettings['theme'] })}>
            <option value="auto">Auto (system)</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Field>
      </section>

      <button
        onClick={handleSave}
        style={{ background: '#c96442', color: '#fff', border: 'none', padding: '9px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
      >
        {saved ? '✓ Saved' : 'Save settings'}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 13, color: '#6b6860' }}>{label}</label>
      <div style={{ display: 'contents' }}>
        {children}
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 13, color: '#6b6860' }}>{label}</span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#c96442' }} />
    </div>
  );
}
