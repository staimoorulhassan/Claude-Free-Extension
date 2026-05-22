import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { Message } from './Message';

const QUICK_PROMPTS = [
  'Summarize the current webpage for me',
  'Help me write a professional email',
  'Explain how the selected code works',
];

function EmptyState() {
  const sendMessage = useStore(s => s.sendMessage);

  return (
    <div className="chat-empty">
      <div className="chat-empty-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <div className="chat-empty-title">How can I help?</div>
      <div className="chat-empty-sub">Ask anything or pick a suggestion</div>
      <div className="chat-empty-chips">
        {QUICK_PROMPTS.map(p => (
          <button
            key={p}
            className="chat-empty-chip"
            onClick={() => sendMessage([{ type: 'text', text: p }])}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Chat() {
  const conversations = useStore(s => s.conversations);
  const activeId = useStore(s => s.activeConversationId);
  const isStreaming = useStore(s => s.isStreaming);
  const bottomRef = useRef<HTMLDivElement>(null);

  const conversation = conversations.find(c => c.id === activeId);
  const messages = conversation?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isStreaming]);

  return (
    <div className="chat">
      {messages.length === 0 ? (
        <EmptyState />
      ) : (
        messages.map((msg, i) => (
          <Message
            key={msg.id}
            message={msg}
            isStreaming={isStreaming && i === messages.length - 1}
          />
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
