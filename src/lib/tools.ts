import type { AnthropicTool, ToolUseBlock, ContentBlock } from './types';
import { executeComputerAction } from './computer-use';
import type { ComputerAction } from './computer-use';
import { COMPUTER_TOOL } from './computer-use';

export function getEnabledTools(computerUseEnabled: boolean): AnthropicTool[] {
  const tools: AnthropicTool[] = [];
  if (computerUseEnabled) tools.push(COMPUTER_TOOL);
  return tools;
}

export async function executeTool(block: ToolUseBlock): Promise<ContentBlock[]> {
  switch (block.name) {
    case 'computer': {
      const results = await executeComputerAction(block.input as ComputerAction);
      return results.map(r => {
        if (r.type === 'image' && r.source) {
          return { type: 'image', source: r.source } as ContentBlock;
        }
        return { type: 'text', text: r.text ?? '' } as ContentBlock;
      });
    }
    default:
      return [{ type: 'text', text: `Tool "${block.name}" is not implemented.` }];
  }
}
