// End-to-end: real adapter + real provider (tabi) + real COMPUTER_TOOL schema,
// simulating exactly what the agent loop does on round 1 and round 2.
// Run with: npx tsx --tsconfig tsconfig.json scripts/e2e-loop-probe.mts
import { createOpenAICompatibleFetch } from '../src/lib/openai-compat';
import { COMPUTER_TOOL } from '../src/lib/computer-use';
import type { AnthropicTool } from '../src/lib/types';

const API_KEY = 'sk-DLNDEPDlKr5chC6ijIYcyQysCgJFmBOvCFhKDIQlYLZPgRoS';

const customFetch = createOpenAICompatibleFetch({
  provider: 'tabi',
  apiKey: API_KEY,
  baseURL: 'https://tabitoken.com/v1',
  defaultModel: 'claude-opus-4-8',
});

async function round(messages: unknown[], tools: AnthropicTool[], label: string) {
  const resp = await customFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'sk-ant-compat', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      messages,
      tools,
      tool_choice: { type: 'auto' },
      stream: true,
    }),
  });
  const text = await resp.text();
  // Reconstruct stop_reason + tool_use blocks from the Anthropic-format SSE
  let stopReason = 'end_turn';
  const toolUses: { name: string; input: unknown }[] = [];
  let curTool: { name: string; input: string } | null = null;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const raw = t.slice(5).trim();
    if (raw === '[DONE]') continue;
    let ev: any;
    try { ev = JSON.parse(raw); } catch { continue; }
    if (ev.type === 'message_delta') stopReason = ev.delta?.stop_reason ?? stopReason;
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
      curTool = { name: ev.content_block.name, input: '' };
    }
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta' && curTool) {
      curTool.input += ev.delta.partial_json ?? '';
    }
    if (ev.type === 'content_block_stop' && curTool) {
      try { toolUses.push({ name: curTool.name, input: JSON.parse(curTool.input || '{}') }); } catch { toolUses.push({ name: curTool.name, input: {} }); }
      curTool = null;
    }
  }
  console.log(`--- ${label} ---`);
  console.log('stop_reason:', stopReason);
  console.log('tool_uses:', JSON.stringify(toolUses).slice(0, 300));
  return { stopReason, toolUses };
}

async function main() {
  const tools: AnthropicTool[] = [COMPUTER_TOOL];

  // Round 1: user asks a browser task
  const task = 'Go to https://example.com, read the page, and tell me what is on it';
  const r1 = await round(
    [{ role: 'user', content: [{ type: 'text', text: task }] }],
    tools,
    'ROUND 1 (multi-step task)',
  );

  if (r1.stopReason !== 'tool_use' || r1.toolUses.length === 0) {
    console.log('RESULT: round 1 did not produce a tool call — nothing to continue from');
    return;
  }

  // Round 2: assistant tool_use + tool_result, exactly as the loop appends them
  const tu = r1.toolUses[0];
  const r2 = await round(
    [
      { role: 'user', content: [{ type: 'text', text: 'Open https://example.com in the browser' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_probe_1', name: tu.name, input: tu.input }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_probe_1', content: [{ type: 'text', text: 'Navigated to example.com - page loaded OK' }] }] },
    ],
    tools,
    'ROUND 2 (after first tool call)',
  );

  console.log('RESULT:', r2.stopReason === 'tool_use' ? 'LOOP CONTINUES ✓' : 'LOOP STOPS ✗ (stop_reason=' + r2.stopReason + ')');
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });