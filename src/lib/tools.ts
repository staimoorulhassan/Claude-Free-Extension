import type { AnthropicTool, ToolUseBlock, ContentBlock } from './types';
import { executeComputerAction } from './computer-use';
import type { ComputerAction } from './computer-use';
import { COMPUTER_TOOL } from './computer-use';
import { createSteelComputer } from './steel-computer';
import type { SteelSession } from './steel-client';

export function getEnabledTools(computerUseEnabled: boolean): AnthropicTool[] {
  const tools: AnthropicTool[] = [];
  if (computerUseEnabled) tools.push(COMPUTER_TOOL);
  return tools;
}

export async function executeTool(
  block: ToolUseBlock,
  steelSession?: SteelSession | null
): Promise<ContentBlock[]> {
  switch (block.name) {
    case 'computer': {
      if (steelSession) {
        const steelComputer = createSteelComputer(steelSession);
        const results = await steelComputer.execute(block.input as unknown as ComputerAction);
        return results.map(r => {
          if (r.type === 'image' && r.source) {
            return { type: 'image', source: r.source } as ContentBlock;
          }
          return { type: 'text', text: r.text ?? '' } as ContentBlock;
        });
      }
      const results = await executeComputerAction(block.input as unknown as ComputerAction);
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
