import { describe, expect, it } from 'vitest';
import {
  helperCategory,
  helperLabel,
  mcpHelper,
  parseMcpToolName,
} from './helpers';

describe('helper identity', () => {
  it('parses Claude MCP tool names', () => {
    expect(parseMcpToolName('mcp__blender__execute_blender_code')).toEqual({
      server: 'blender',
      tool: 'execute_blender_code',
    });
    expect(parseMcpToolName('mcp__claude_ai_Higgsfield__jobs_wait')).toEqual({
      server: 'claude_ai_Higgsfield',
      tool: 'jobs_wait',
    });
    expect(parseMcpToolName('Bash')).toBeNull();
  });
  it('labels servers without their transport noise', () => {
    expect(helperLabel('meshy-mcp-server')).toBe('Meshy');
    expect(helperLabel('claude_ai_Claude_Docs')).toBe('Claude Docs');
    expect(helperLabel('claude-in-chrome')).toBe('Chrome');
    expect(helperLabel('devrelay-gateway')).toBe('DevRelay');
  });
  it('gives different kinds of tool different categories', () => {
    const cases: [string, string][] = [
      ['blender', '3d'],
      ['meshy-mcp-server', '3d'],
      ['claude_ai_Higgsfield', 'media'],
      ['claude_ai_Figma', 'design'],
      ['claude-in-chrome', 'browser'],
      ['tiger', 'database'],
      ['phpstorm', 'ide'],
      ['claude_ai_Claude_Docs', 'docs'],
      ['devrelay-gateway', 'web'],
      ['claude_ai_Google_Calendar', 'comms'],
      ['vercel', 'cloud'],
      ['something-new', 'tool'],
    ];
    for (const [server, category] of cases)
      expect([server, helperCategory(server)]).toEqual([server, category]);
  });
  it('names the app behind a gateway server', () => {
    expect(mcpHelper('codex_apps', 'github.fetch_file')).toEqual({
      id: 'mcp:github',
      label: 'GitHub',
      category: 'code-host',
      tool: 'fetch_file',
    });
    expect(mcpHelper('blender', 'execute_blender_code').id).toBe('mcp:blender');
  });
});
