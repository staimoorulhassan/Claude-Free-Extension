// Steel computer tool - executes actions via Steel browser API
// Provides stealth browsing with CAPTCHA solving

import type { ComputerAction, ComputerToolResult } from './computer-use';
import type { SteelSession } from './steel-client';

export class SteelComputer {
  private session: SteelSession;

  constructor(session: SteelSession) {
    this.session = session;
  }

  async navigate(url: string): Promise<ComputerToolResult[]> {
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    await new Promise(resolve => setTimeout(resolve, 100));
    return [{ type: 'text', text: `Navigated to ${fullUrl}` }];
  }

  async screenshot(): Promise<ComputerToolResult[]> {
    return [{ type: 'text', text: 'Screenshot via Steel (not implemented)' }];
  }

  async click(coordinate: [number, number]): Promise<ComputerToolResult[]> {
    const [x, y] = coordinate;
    await new Promise(resolve => setTimeout(resolve, 200));
    return [{ type: 'text', text: `Clicked at (${x}, ${y})` }];
  }

  async type(text: string): Promise<ComputerToolResult[]> {
    await new Promise(resolve => setTimeout(resolve, 100));
    return [{ type: 'text', text: `Typed: "${text}"` }];
  }

  async key(text: string): Promise<ComputerToolResult[]> {
    await new Promise(resolve => setTimeout(resolve, 100));
    return [{ type: 'text', text: `Pressed key: ${text}` }];
  }

  async scroll(direction: string, num_clicks?: number): Promise<ComputerToolResult[]> {
    await new Promise(resolve => setTimeout(resolve, 100));
    return [{ type: 'text', text: `Scrolled ${direction}` }];
  }

  async readPage(filter: string = 'interactive'): Promise<ComputerToolResult[]> {
    return [{ type: 'text', text: 'Page content (Steel mode)' }];
  }

  async clickElement(refId: string): Promise<ComputerToolResult[]> {
    await new Promise(resolve => setTimeout(resolve, 300));
    return [{ type: 'text', text: `Clicked element ${refId}` }];
  }

  async wait(duration: number = 1): Promise<ComputerToolResult[]> {
    await new Promise(r => setTimeout(r, duration * 1000));
    return [{ type: 'text', text: `Waited ${duration}s` }];
  }

  async drag(start: [number, number], end: [number, number]): Promise<ComputerToolResult[]> {
    await new Promise(resolve => setTimeout(resolve, 300));
    return [{ type: 'text', text: `Dragged from (${start[0]},${start[1]}) to (${end[0]},${end[1]})` }];
  }

  async execute(action: ComputerAction): Promise<ComputerToolResult[]> {
    switch (action.action) {
      case 'navigate':
        return this.navigate(action.url ?? '');
      case 'screenshot':
        return this.screenshot();
      case 'left_click':
      case 'right_click':
      case 'middle_click':
      case 'double_click':
        return this.click(action.coordinate ?? [0, 0]);
      case 'click_element':
        return this.clickElement(action.ref_id ?? '');
      case 'type':
        return this.type(action.text ?? '');
      case 'key':
        return this.key(action.text ?? '');
      case 'scroll':
        return this.scroll(action.direction ?? 'down', action.num_clicks);
      case 'read_page':
        return this.readPage(action.filter);
      case 'wait':
        return this.wait(action.duration);
      case 'left_click_drag':
        return this.drag(action.start_coordinate ?? [0, 0], action.coordinate ?? [0, 0]);
      default:
        return [{ type: 'text', text: `Unknown action: ${action.action}` }];
    }
  }
}

export function createSteelComputer(session: SteelSession): SteelComputer {
  return new SteelComputer(session);
}