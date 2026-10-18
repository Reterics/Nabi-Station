import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import type { AgentNpc } from '@nabi/protocol';

const run = promisify(execFile);

export interface FocusResult {
  ok: boolean;
  message: string;
}

/**
 * Finds the window hosting a process and brings it to the front (Windows only).
 *
 * 1. Console: attach to the session's console and ask for its window. A classic
 *    console returns its own window; Windows Terminal returns a hidden pseudo-console
 *    window owned by the terminal window, so the root owner is used.
 * 2. Otherwise walk up the parent processes to the first one with a main window
 *    (VS Code, JetBrains and other hosts of integrated terminals).
 * 3. Without a pid (Codex in VS Code), match an editor window title on the folder name.
 *
 * The window title is never read back: terminals show the conversation's topic.
 *
 * Windows only lets the foreground process hand out focus, so the script briefly
 * attaches to the foreground thread's input queue. Tabs inside a terminal window
 * cannot be selected from outside; the window is the finest target.
 *
 * Arguments arrive in environment variables, never in the script text.
 */
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NabiWindow {
  [DllImport("kernel32.dll")] static extern bool FreeConsole();
  [DllImport("kernel32.dll")] static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  public static IntPtr ConsoleWindowOf(uint pid) {
    FreeConsole();
    if (!AttachConsole(pid)) return IntPtr.Zero;
    IntPtr h = GetConsoleWindow();
    FreeConsole();
    if (h == IntPtr.Zero) return h;
    IntPtr owner = GetAncestor(h, 3); // GA_ROOTOWNER
    if (owner != IntPtr.Zero && IsWindowVisible(owner)) return owner;
    return IsWindowVisible(h) ? h : IntPtr.Zero;
  }
  public static bool Activate(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9); // SW_RESTORE
    uint ignored;
    uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
    uint self = GetCurrentThreadId();
    bool attached = foreground != self && AttachThreadInput(self, foreground, true);
    BringWindowToTop(h);
    bool ok = SetForegroundWindow(h);
    if (attached) AttachThreadInput(self, foreground, false);
    return ok;
  }
}
'@
$target = [IntPtr]::Zero
$via = ''
$owner = ''
if ($env:NABI_PID) {
  $target = [NabiWindow]::ConsoleWindowOf([uint32]$env:NABI_PID)
  $via = 'console'
  if ($target -eq [IntPtr]::Zero) {
    $id = (Get-CimInstance Win32_Process -Filter "ProcessId=$([uint32]$env:NABI_PID)").ParentProcessId
    for ($i = 0; $i -lt 12 -and $id; $i++) {
      $process = Get-Process -Id $id -ErrorAction SilentlyContinue
      if ($process -and $process.MainWindowHandle -ne [IntPtr]::Zero -and $process.ProcessName -ne 'explorer') {
        $target = $process.MainWindowHandle; $via = 'parent'; $owner = $process.ProcessName; break
      }
      $id = (Get-CimInstance Win32_Process -Filter "ProcessId=$id").ParentProcessId
    }
  }
}
if ($target -eq [IntPtr]::Zero -and $env:NABI_TITLE) {
  $editor = Get-Process -Name 'Code', 'Code - Insiders', 'Cursor', 'Windsurf' -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -like "*$($env:NABI_TITLE)*" } |
    Select-Object -First 1
  if ($editor) { $target = $editor.MainWindowHandle; $via = 'title'; $owner = $editor.ProcessName }
}
if ($target -eq [IntPtr]::Zero) { @{ found = $false } | ConvertTo-Json -Compress; exit }
$activated = if ($env:NABI_DRY_RUN) { $false } else { [NabiWindow]::Activate($target) }
@{ found = $true; activated = $activated; via = $via; owner = $owner } | ConvertTo-Json -Compress
`;

const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');

interface ScriptResult {
  found: boolean;
  activated?: boolean;
  via?: 'console' | 'parent' | 'title';
  owner?: string;
}

export async function focusAgentWindow(
  agent: Pick<AgentNpc, 'pid' | 'cwd' | 'name'>,
  { dryRun = false } = {},
): Promise<FocusResult> {
  if (process.platform !== 'win32')
    return {
      ok: false,
      message:
        'Bringing sessions to the front is only supported on Windows so far.',
    };
  const folder = agent.cwd ? basename(agent.cwd) : '';
  if (!agent.pid && !folder)
    return {
      ok: false,
      message: 'This session has no process or folder to look for.',
    };
  let result: ScriptResult;
  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      {
        windowsHide: true,
        timeout: 15_000,
        env: {
          ...process.env,
          NABI_PID: agent.pid ? String(agent.pid) : '',
          // Folder names only ever reach a -like pattern; strip its wildcard characters.
          NABI_TITLE: folder.replace(/[*?[\]`]/g, ''),
          NABI_DRY_RUN: dryRun ? '1' : '',
        },
      },
    );
    result = JSON.parse(stdout.trim());
  } catch (error) {
    return {
      ok: false,
      message: `Could not look for the window: ${(error as Error).message}`,
    };
  }
  if (!result.found)
    return {
      ok: false,
      message: agent.pid
        ? 'No window was found for this session (it may run without a visible terminal).'
        : `No editor window with "${folder}" in its title is open.`,
    };
  // Window titles are not reported: terminals show the conversation's topic there.
  const where =
    result.via === 'console'
      ? 'the terminal window'
      : `the ${result.owner || 'host'} window`;
  if (dryRun)
    return { ok: true, message: `Would bring ${where} to the front.` };
  return result.activated
    ? { ok: true, message: `Brought ${where} to the front.` }
    : {
        ok: false,
        message: `Windows refused to switch focus; ${where} should be flashing in the taskbar.`,
      };
}
