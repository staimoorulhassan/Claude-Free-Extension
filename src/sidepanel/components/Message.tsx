import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message as MsgType, ContentBlock } from '@/lib/types';
import { ToolUseDisplay, ToolResultDisplay } from './ToolCall';

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={12} height={12}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  );
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function extractText(content: ContentBlock[]): string {
  return content
    .filter(b => b.type === 'text')
    .map(b => ('text' in b ? b.text : ''))
    .join('\n');
}

function BlockRenderer({ block }: { block: ContentBlock }) {
  if (block.type === 'text') {
    return (
      <div className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {block.text}
        </ReactMarkdown>
      </div>
    );
  }
  if (block.type === 'image') {
    const src =
      block.source.type === 'base64'
        ? `data:${block.source.media_type};base64,${block.source.data}`
        : block.source.url;
    return <img src={src} alt="attachment" className="msg-image" />;
  }
  if (block.type === 'tool_use') {
    return <ToolUseDisplay block={block} />;
  }
  if (block.type === 'tool_result') {
    return <ToolResultDisplay block={block} />;
  }
  if (block.type === 'thinking') {
    return (
      <details style={{ marginBottom: 4 }}>
        <summary style={{ fontSize: 12, color: 'var(--text3)', cursor: 'pointer' }}>Thinking…</summary>
        <div className="prose" style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
          {block.thinking}
        </div>
      </details>
    );
  }
  return null;
}

export function Message({ message, isStreaming }: { message: MsgType; isStreaming?: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    const text = extractText(message.content);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [message.content]);

  const isUser = message.role === 'user';
  const isEmpty = message.content.length === 0;

  return (
    <div className={`msg msg--${message.role}`}>
      <div className="msg-bubble">
        {isEmpty && isStreaming ? (
          <div className="typing-dots">
            <span /><span /><span />
          </div>
        ) : (
          message.content.map((block, i) => <BlockRenderer key={i} block={block} />)
        )}
      </div>
      {!isUser && !isEmpty && (
        <div className="msg-meta">
          <span className="msg-time">{formatTime(message.timestamp)}</span>
          <button className="msg-copy" onClick={copy} title="Copy">
            <CopyIcon />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      {isUser && (
        <div className="msg-meta">
          <span className="msg-time">{formatTime(message.timestamp)}</span>
        </div>
      )}
    </div>
  );
}
