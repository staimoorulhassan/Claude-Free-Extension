import { useState } from 'react';
import { useStore } from '../store';
import type { ToolUseBlock } from '@/lib/types';

function describeBlock(block: ToolUseBlock): string {
  if (block.name !== 'computer') return `${block.name}(${JSON.stringify(block.input)})`;
  const inp = block.input as Record<string, unknown>;
  const action = inp.action as string;
  switch (action) {
    case 'navigate':    return `Navigate to ${inp.url}`;
    case 'screenshot':  return 'Take a screenshot';
    case 'read_page':   return `Read page (${inp.filter ?? 'interactive'})`;
    case 'left_click':  return `Click at (${(inp.coordinate as number[])?.join(', ')})`;
    case 'right_click': return `Right-click at (${(inp.coordinate as number[])?.join(', ')})`;
    case 'double_click':return `Double-click at (${(inp.coordinate as number[])?.join(', ')})`;
    case 'click_element': return `Click element ${inp.ref_id}`;
    case 'type':        return `Type: "${String(inp.text ?? '').slice(0, 60)}${String(inp.text ?? '').length > 60 ? '…' : ''}"`;
    case 'key':         return `Press key: ${inp.text}`;
    case 'scroll':      return `Scroll ${inp.direction} (${inp.num_clicks ?? 3} steps)`;
    case 'left_click_drag': return `Drag from (${(inp.start_coordinate as number[])?.join(',')}) to (${(inp.coordinate as number[])?.join(',')})`;
    case 'wait':        return `Wait ${inp.duration ?? 1}s`;
    default:            return action;
  }
}

function actionIcon(block: ToolUseBlock): string {
  const action = (block.input as Record<string, unknown>).action as string;
  const icons: Record<string, string> = {
    navigate: '🌐', screenshot: '📸', read_page: '📄',
    left_click: '👆', right_click: '👆', double_click: '👆', click_element: '👆',
    type: '⌨️', key: '⌨️', scroll: '↕️', left_click_drag: '↔️', wait: '⏳',
  };
  return icons[action] ?? '🔧';
}

export function ApprovalCard() {
  const pendingApproval = useStore(s => s.pendingApproval);
  const approvePending = useStore(s => s.approvePending);
  const rejectPending = useStore(s => s.rejectPending);
  const [correction, setCorrection] = useState('');

  if (!pendingApproval) return null;

  const handleApprove = () => {
    const text = correction.trim();
    setCorrection('');
    approvePending(text || undefined);
  };

  const handleReject = () => {
    setCorrection('');
    rejectPending();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleApprove();
    if (e.key === 'Escape') handleReject();
  };

  return (
    <div className="approval-card">
      <div className="approval-header">
        <span className="approval-title">Agent wants to perform {pendingApproval.blocks.length} action{pendingApproval.blocks.length !== 1 ? 's' : ''}</span>
      </div>

      <ul className="approval-actions">
        {pendingApproval.blocks.map((b, i) => (
          <li key={i} className="approval-action-item">
            <span className="approval-action-icon">{actionIcon(b)}</span>
            <span className="approval-action-label">{describeBlock(b)}</span>
          </li>
        ))}
      </ul>

      <textarea
        className="approval-correction"
        placeholder="Optional: type a correction or change of plan, then Approve — or leave blank to proceed as planned"
        value={correction}
        onChange={e => setCorrection(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
      />

      <div className="approval-buttons">
        <button className="approval-btn approval-btn--reject" onClick={handleReject}>
          ✕ Reject
        </button>
        <button className="approval-btn approval-btn--approve" onClick={handleApprove}>
          ✓ {correction.trim() ? 'Apply correction' : 'Approve'}
        </button>
      </div>

      <div className="approval-hint">Ctrl+Enter to approve · Esc to reject</div>
    </div>
  );
}
