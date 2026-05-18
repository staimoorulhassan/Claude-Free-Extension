import { useState, useRef, useCallback, type KeyboardEvent, type ChangeEvent } from 'react';
import { useStore } from '../store';
import type { ContentBlock, ImageBlock } from '@/lib/types';

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={14} height={14}>
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={14} height={14}>
      <rect x={6} y={6} width={12} height={12} rx={2}/>
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    </svg>
  );
}

interface Attachment {
  name: string;
  block: ContentBlock;
}

async function fileToImageBlock(file: File): Promise<ImageBlock> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] ?? '';
      resolve({ type: 'image', source: { type: 'base64', media_type: file.type, data: base64 } });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function MessageInput() {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isStreaming = useStore(s => s.isStreaming);
  const sendMessage = useStore(s => s.sendMessage);
  const stopGeneration = useStore(s => s.stopGeneration);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, []);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    autoResize();
  };

  const send = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (isStreaming) return;

    const content: ContentBlock[] = [
      ...attachments.map(a => a.block),
      ...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []),
    ];

    setText('');
    setAttachments([]);
    if (textareaRef.current) { textareaRef.current.style.height = 'auto'; }

    await sendMessage(content);
  }, [text, attachments, isStreaming, sendMessage]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      const block = await fileToImageBlock(file);
      setAttachments(prev => [...prev, { name: 'pasted image', block }]);
    }
  }, []);

  const handleFileSelect = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    for (const file of imageFiles) {
      const block = await fileToImageBlock(file);
      setAttachments(prev => [...prev, { name: file.name, block }]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const removeAttachment = (i: number) => setAttachments(prev => prev.filter((_, idx) => idx !== i));

  const canSend = (text.trim() || attachments.length > 0) && !isStreaming;

  return (
    <div className="input-area">
      {attachments.length > 0 && (
        <div className="input-attachments">
          {attachments.map((a, i) => (
            <div key={i} className="attachment-chip">
              {a.name}
              <button onClick={() => removeAttachment(i)} title="Remove">×</button>
            </div>
          ))}
        </div>
      )}
      <div className="input-row">
        <textarea
          ref={textareaRef}
          className="input-textarea"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Message…"
          rows={1}
          disabled={isStreaming}
        />
        <div className="input-actions">
          <button className="attach-btn" onClick={() => fileInputRef.current?.click()} title="Attach image">
            <PaperclipIcon />
          </button>
          {isStreaming ? (
            <button className="send-btn stop-btn" onClick={stopGeneration} title="Stop">
              <StopIcon />
            </button>
          ) : (
            <button className="send-btn" onClick={send} disabled={!canSend} title="Send (Enter)">
              <SendIcon />
            </button>
          )}
        </div>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleFileSelect} />
    </div>
  );
}
