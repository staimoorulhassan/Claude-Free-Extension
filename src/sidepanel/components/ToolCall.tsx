import { useState } from 'react';
import type { ToolUseBlock, ToolResultBlock, ImageBlock } from '@/lib/types';

// ── Icons ─────────────────────────────────────────────────────────────────────

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  );
}

function MouseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="5" y="2" width="14" height="20" rx="7" ry="7"/>
      <line x1="12" y1="2" x2="12" y2="10"/>
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="2" y="6" width="20" height="12" rx="2"/>
      <line x1="6" y1="10" x2="6.01" y2="10"/>
      <line x1="10" y1="10" x2="10.01" y2="10"/>
      <line x1="14" y1="10" x2="14.01" y2="10"/>
      <line x1="18" y1="10" x2="18.01" y2="10"/>
      <line x1="8" y1="14" x2="16" y2="14"/>
    </svg>
  );
}

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  );
}

function ScrollIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <line x1="12" y1="5" x2="12" y2="19"/>
      <polyline points="19 12 12 19 5 12"/>
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      style={{ width: 12, height: 12, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
}

// ── Action metadata ────────────────────────────────────────────────────────────

function getActionIcon(action: string) {
  switch (action) {
    case 'screenshot':   return <CameraIcon />;
    case 'navigate':     return <GlobeIcon />;
    case 'read_page':    return <DocIcon />;
    case 'scroll':       return <ScrollIcon />;
    case 'wait':         return <ClockIcon />;
    case 'type': case 'key': return <KeyboardIcon />;
    default:             return <MouseIcon />;
  }
}

function describeAction(input: Record<string, unknown>): string {
  const action = (input.action as string) ?? 'unknown';
  const coord = (input.coordinate as number[]) ?? [];
  switch (action) {
    case 'screenshot':    return 'Taking screenshot';
    case 'navigate':      return `Navigate → ${(input.url as string ?? '').slice(0, 50)}`;
    case 'read_page':     return `Read page (${input.filter ?? 'interactive'})`;
    case 'left_click':    return `Click (${coord.join(', ')})`;
    case 'right_click':   return `Right-click (${coord.join(', ')})`;
    case 'double_click':  return `Double-click (${coord.join(', ')})`;
    case 'middle_click':  return `Middle-click (${coord.join(', ')})`;
    case 'click_element': return `Click element ${input.ref_id ?? ''}`;
    case 'type':          return `Type "${((input.text as string) ?? '').slice(0, 35)}${((input.text as string) ?? '').length > 35 ? '…' : ''}"`;
    case 'key':           return `Key: ${input.text ?? ''}`;
    case 'scroll':        return `Scroll ${input.direction ?? ''} ×${input.num_clicks ?? 3}`;
    case 'wait':          return `Wait ${input.duration ?? 1}s`;
    case 'left_click_drag': return `Drag → (${coord.join(',')})`;
    default:              return action;
  }
}

function getResultIcon(text: string) {
  if (text.startsWith('Navigated')) return <GlobeIcon />;
  if (text.startsWith('Viewport:') || text.startsWith('Error: Accessibility')) return <DocIcon />;
  if (text.startsWith('Left-clicked') || text.startsWith('Clicked') || text.startsWith('Double') || text.startsWith('Right')) return <MouseIcon />;
  if (text.startsWith('Typed') || text.startsWith('Pressed')) return <KeyboardIcon />;
  if (text.startsWith('Scrolled')) return <ScrollIcon />;
  if (text.startsWith('Waited')) return <ClockIcon />;
  return <WrenchIcon />;
}

// ── ToolUseDisplay ────────────────────────────────────────────────────────────

export function ToolUseDisplay({ block }: { block: ToolUseBlock }) {
  const [open, setOpen] = useState(false);
  const isComputer = block.name === 'computer';
  const input = block.input as Record<string, unknown>;
  const action = isComputer ? (input.action as string) ?? '' : '';

  return (
    <div className="tool-block">
      <div className="tool-header" onClick={() => setOpen(o => !o)}>
        <span className="tool-icon">{isComputer ? getActionIcon(action) : <WrenchIcon />}</span>
        <span className="tool-name">{isComputer ? describeAction(input) : block.name}</span>
        <span className="tool-status tool-status--pending">running…</span>
        <ChevronIcon open={open} />
      </div>
      {open && (
        <div className="tool-body">
          <pre>{JSON.stringify(block.input, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

// ── ToolResultDisplay ─────────────────────────────────────────────────────────

export function ToolResultDisplay({ block }: { block: ToolResultBlock }) {
  const [textOpen, setTextOpen] = useState(false);
  const content = block.content;

  const images = Array.isArray(content)
    ? content.filter((b): b is ImageBlock => b.type === 'image')
    : [];
  const textContent = Array.isArray(content)
    ? content.filter(b => b.type === 'text').map(b => ('text' in b ? b.text : '')).join('\n')
    : typeof content === 'string' ? content : '';

  const isScreenshot = images.length > 0 && !textContent;
  const firstLine = textContent.split('\n')[0] ?? '';
  const label = isScreenshot ? 'Screenshot' : firstLine.slice(0, 55) + (firstLine.length > 55 ? '…' : '');
  const hasMoreText = textContent.length > firstLine.length || firstLine.length > 55;

  return (
    <div className="tool-block">
      <div
        className="tool-header"
        onClick={() => hasMoreText ? setTextOpen(o => !o) : undefined}
        style={{ cursor: hasMoreText ? 'pointer' : 'default' }}
      >
        <span className="tool-icon">{isScreenshot ? <CameraIcon /> : getResultIcon(textContent)}</span>
        <span className="tool-name">{label || 'Result'}</span>
        <span className={`tool-status ${block.is_error ? 'tool-status--error' : 'tool-status--ok'}`}>
          {block.is_error ? '✕ error' : '✓ done'}
        </span>
        {hasMoreText && <ChevronIcon open={textOpen} />}
      </div>

      {/* Screenshots always shown inline */}
      {images.length > 0 && (
        <div className="tool-screenshot">
          {images.map((b, i) => {
            const src = b.source.type === 'base64'
              ? `data:${b.source.media_type};base64,${b.source.data}`
              : '';
            return src ? <img key={i} src={src} alt="screenshot" className="tool-result-image" /> : null;
          })}
        </div>
      )}

      {/* Expandable full text */}
      {textOpen && textContent && (
        <div className="tool-body">
          <pre>{textContent}</pre>
        </div>
      )}
    </div>
  );
}
