import { useState } from 'react';
import { useStore } from '../store';
import { recordingToText } from '@/lib/recordings';

export function RecordingsPanel() {
  const recordings = useStore(s => s.recordings);
  const deleteRecording = useStore(s => s.deleteRecording);
  const setAttachedRecording = useStore(s => s.setAttachedRecording);
  const setShowRecordings = useStore(s => s.setShowRecordings);
  const attachedRecordingId = useStore(s => s.attachedRecordingId);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (recordings.length === 0) {
    return (
      <div className="recordings-empty">
        <p>No recordings yet.</p>
        <p>Click the <strong>⏺ Record</strong> button in the header, perform actions in the browser, then stop recording to save a demonstration.</p>
      </div>
    );
  }

  return (
    <div className="recordings-panel">
      {recordings.map(rec => {
        const isAttached = rec.id === attachedRecordingId;
        const isExpanded = expanded === rec.id;
        return (
          <div key={rec.id} className={`recording-item ${isAttached ? 'recording-item--attached' : ''}`}>
            <div className="recording-item-header">
              <div className="recording-item-info">
                <span className="recording-item-name">{rec.name}</span>
                <span className="recording-item-meta">{rec.steps.length} steps · {new Date(rec.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="recording-item-actions">
                <button
                  className={`recording-attach-btn ${isAttached ? 'recording-attach-btn--active' : ''}`}
                  onClick={() => {
                    setAttachedRecording(isAttached ? null : rec.id);
                    setShowRecordings(false);
                  }}
                  title={isAttached ? 'Detach from next message' : 'Attach to next message'}
                >
                  {isAttached ? '✓ Attached' : '↗ Use'}
                </button>
                <button
                  className="recording-expand-btn"
                  onClick={() => setExpanded(isExpanded ? null : rec.id)}
                  title="View steps"
                >
                  {isExpanded ? '▲' : '▼'}
                </button>
                <button
                  className="recording-delete-btn"
                  onClick={() => { if (window.confirm(`Delete "${rec.name}"?`)) deleteRecording(rec.id); }}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            </div>
            {isExpanded && (
              <pre className="recording-steps-preview">{recordingToText(rec)}</pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
