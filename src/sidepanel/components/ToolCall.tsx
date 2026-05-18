import { useState } from 'react';
import type { ToolUseBlock, ToolResultBlock } from '@/lib/types';

function WrenchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: 12, height: 12, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
}

export function ToolUseDisplay({ block }: { block: ToolUseBlock }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tool-block">
      <div className="tool-header" onClick={() => setOpen(o => !o)}>
        <WrenchIcon />
        <span className="tool-name">{block.name}</span>
        <span className="tool-status">calling…</span>
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

export function ToolResultDisplay({ block }: { block: ToolResultBlock }) {
  const [open, setOpen] = useState(false);
  const content = block.content;

  const hasImage = Array.isArray(content) && content.some(b => b.type === 'image');
  const textContent = Array.isArray(content)
    ? content.filter(b => b.type === 'text').map(b => ('text' in b ? b.text : '')).join('\n')
    : typeof content === 'string' ? content : '';

  return (
    <div className="tool-block">
      <div className="tool-header" onClick={() => setOpen(o => !o)}>
        <WrenchIcon />
        <span className="tool-name">result</span>
        <span className="tool-status" style={{ color: block.is_error ? '#b91c1c' : undefined }}>
          {block.is_error ? 'error' : 'ok'}
        </span>
        <ChevronIcon open={open} />
      </div>
      {open && (
        <div className="tool-body">
          {textContent && <pre>{textContent}</pre>}
          {hasImage && Array.isArray(content) && content.filter(b => b.type === 'image').map((b, i) => {
            if (b.type !== 'image') return null;
            const src = 'source' in b && b.source ? ('data' in b.source ? `data:${b.source.media_type};base64,${b.source.data}` : '') : '';
            return src ? <img key={i} src={src} alt="screenshot" className="tool-result-image" /> : null;
          })}
        </div>
      )}
    </div>
  );
}
