import { useStore } from '../store';

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4h6v2"/>
    </svg>
  );
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function HistoryPanel() {
  const conversations = useStore(s => s.conversations);
  const activeId = useStore(s => s.activeConversationId);
  const setActive = useStore(s => s.setActiveConversation);
  const deleteConv = useStore(s => s.deleteConversation);
  const newConversation = useStore(s => s.newConversation);

  if (conversations.length === 0) {
    return (
      <div className="history history-empty">
        <p>No conversations yet.</p>
        <button className="history-empty-btn" onClick={newConversation}>Start one</button>
      </div>
    );
  }

  return (
    <div className="history">
      {conversations.map(conv => (
        <div
          key={conv.id}
          className={`history-item${conv.id === activeId ? ' active' : ''}`}
          onClick={() => setActive(conv.id)}
        >
          <span className="history-title">{conv.title}</span>
          <span className="history-date">{formatDate(conv.updatedAt)}</span>
          <button
            className="history-del"
            onClick={e => { e.stopPropagation(); deleteConv(conv.id); }}
            title="Delete"
          >
            <TrashIcon />
          </button>
        </div>
      ))}
    </div>
  );
}
