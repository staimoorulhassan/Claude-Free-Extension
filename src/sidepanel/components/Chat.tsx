import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { Message } from './Message';

function EmptyState() {
  return (
    <div className="chat-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <p>Start a conversation</p>
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
