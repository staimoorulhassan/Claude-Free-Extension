export interface RecordedStep {
  action: 'navigate' | 'click' | 'type' | 'key';
  url?: string;
  x?: number;
  y?: number;
  elementTag?: string;
  elementText?: string;
  elementHref?: string;
  text?: string;
  inputName?: string;
}

export interface Recording {
  id: string;
  name: string;
  createdAt: number;
  steps: RecordedStep[];
}

export async function getRecordings(): Promise<Recording[]> {
  const data = await chrome.storage.local.get('recordings');
  return (data['recordings'] as Recording[]) ?? [];
}

export async function saveRecordings(recordings: Recording[]): Promise<void> {
  await chrome.storage.local.set({ recordings });
}

/** Convert a recording into a human-readable block the AI can follow. */
export function recordingToText(rec: Recording): string {
  const lines: string[] = [`[Demonstration: "${rec.name}"]`];
  let stepNum = 1;
  for (const s of rec.steps) {
    switch (s.action) {
      case 'navigate':
        lines.push(`${stepNum++}. Navigate to ${s.url}`);
        break;
      case 'click': {
        const where = s.elementText
          ? `"${s.elementText}" ${s.elementHref ? `(link → ${s.elementHref})` : `<${s.elementTag}>`}`
          : `position (${s.x}, ${s.y})`;
        lines.push(`${stepNum++}. Click ${where}`);
        break;
      }
      case 'type': {
        const field = s.inputName ? ` into "${s.inputName}" field` : '';
        lines.push(`${stepNum++}. Type "${s.text}"${field}`);
        break;
      }
      case 'key':
        lines.push(`${stepNum++}. Press ${s.text}`);
        break;
    }
  }
  return lines.join('\n');
}
