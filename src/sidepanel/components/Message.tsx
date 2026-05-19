import { useState, useCallback } from 'react';
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import 'highlight.js/styles/atom-one-dark.min.css';
import 'katex/dist/katex.min.css';
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

// Issue 13: blinking cursor during stream
function StreamingCursor() {
  return <span className="streaming-cursor" aria-hidden />;
}

// Issue 18: HTML/SVG preview wrapper around a pre block
function PreviewableCode({ lang, code, children }: { lang: string; code: string; children: React.ReactNode }) {
  const [showPreview, setShowPreview] = useState(false);
  return (
    <div className="code-preview-block">
      <div className="code-preview-header">
        <span className="code-lang-tag">{lang}</span>
        <button className="code-preview-btn" onClick={() => setShowPreview(p => !p)}>
          {showPreview ? '‹ Code' : '▶ Preview'}
        </button>
      </div>
      {showPreview
        ? <iframe srcDoc={code} sandbox="allow-scripts" className="code-preview-iframe" title="HTML preview" />
        : <>{children}</>
      }
    </div>
  );
}

function flattenChildText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(flattenChildText).join('');
  if (React.isValidElement(node)) {
    return flattenChildText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

// Issue 14+18: markdown component overrides
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeHighlight, rehypeKatex] as Parameters<typeof ReactMarkdown>[0]['rehypePlugins'];

const markdownComponents = {
  pre({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) {
    const kids = React.Children.toArray(children);
    const codeEl = kids.find((c): c is React.ReactElement => React.isValidElement(c) && c.type === 'code');
    const className = (codeEl?.props as { className?: string })?.className ?? '';
    const lang = /language-(\w+)/.exec(className)?.[1] ?? '';
    if (lang === 'html' || lang === 'svg' || lang === 'htm') {
      const code = flattenChildText((codeEl?.props as { children?: React.ReactNode })?.children);
      return (
        <PreviewableCode lang={lang} code={code}>
          <pre {...(props as React.HTMLAttributes<HTMLPreElement>)}>{children}</pre>
        </PreviewableCode>
      );
    }
    return <pre {...(props as React.HTMLAttributes<HTMLPreElement>)}>{children}</pre>;
  },
} as Parameters<typeof ReactMarkdown>[0]['components'];

function BlockRenderer({ block, isStreaming }: { block: ContentBlock; isStreaming?: boolean }) {
  if (block.type === 'text') {
    return (
      <div className="prose">
        {isStreaming ? (
          // Plain text while streaming — avoids markdown-parse flicker on incomplete content
          <span className="streaming-text">
            {block.text}
            <StreamingCursor />
          </span>
        ) : (
          <ReactMarkdown
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            components={markdownComponents}
          >
            {block.text}
          </ReactMarkdown>
        )}
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
    const text = message.content
      .filter(b => b.type === 'text')
      .map(b => ('text' in b ? b.text : ''))
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [message.content]);

  const isUser = message.role === 'user';
  const isEmpty = message.content.length === 0;
  const lastIdx = message.content.length - 1;

  return (
    <div className={`msg msg--${message.role}`}>
      <div className="msg-bubble">
        {isEmpty && isStreaming ? (
          <div className="typing-dots">
            <span /><span /><span />
          </div>
        ) : (
          message.content.map((block, i) => (
            <BlockRenderer key={i} block={block} isStreaming={isStreaming && i === lastIdx} />
          ))
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
