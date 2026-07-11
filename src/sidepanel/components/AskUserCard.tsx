import { useState } from 'react';
import { useStore } from '../store';

// T019: distinct from ApprovalCard — this is the agent proactively asking a question
// or waiting on the user (CAPTCHA, 2FA, an irreversible action), not the user vetting
// a planned action before it runs.
export function AskUserCard() {
  const pendingAskUser = useStore(s => s.pendingAskUser);
  const respondToAskUser = useStore(s => s.respondToAskUser);
  const [response, setResponse] = useState('');

  if (!pendingAskUser) return null;

  const handleSubmit = () => {
    const text = response.trim();
    setResponse('');
    respondToAskUser(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit();
  };

  return (
    <div className="approval-card ask-user-card">
      <div className="approval-header">
        <span className="approval-title">
          {pendingAskUser.requiresManualAction ? '✋ Waiting for you' : '❓ Agent has a question'}
        </span>
      </div>

      <p className="ask-user-prompt">{pendingAskUser.prompt}</p>

      {pendingAskUser.requiresManualAction ? (
        <div className="approval-buttons">
          <button className="approval-btn approval-btn--approve" onClick={() => respondToAskUser('done')}>
            ✓ I've done it — continue
          </button>
        </div>
      ) : (
        <>
          <textarea
            className="approval-correction"
            placeholder="Type your answer, then submit"
            value={response}
            onChange={e => setResponse(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            autoFocus
          />
          <div className="approval-buttons">
            <button className="approval-btn approval-btn--approve" onClick={handleSubmit}>
              ✓ Submit
            </button>
          </div>
          <div className="approval-hint">Ctrl+Enter to submit</div>
        </>
      )}
    </div>
  );
}
