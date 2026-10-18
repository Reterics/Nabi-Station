import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Display form of a local path: forward slashes, no `\\?\` prefix, upper-case
 * drive letter, no trailing slash. Agents report the same directory in several
 * spellings (Codex stores `\\?\D:\git\x`, Claude `D:\git\x`, Git Bash `/d/git/x`).
 */
export function displayPath(path: string): string {
  let result = path.replace(/^\\\\\?\\/, '').replaceAll('\\', '/');
  const gitBash = /^\/([a-zA-Z])(\/|$)/.exec(result);
  if (gitBash) result = `${gitBash[1]}:${result.slice(2) || '/'}`;
  result = result.replace(
    /^([a-z]):/,
    (_, drive: string) => `${drive.toUpperCase()}:`,
  );
  if (result.length > 1 && !/^[A-Z]:\/$/.test(result))
    result = result.replace(/\/+$/, '');
  return result;
}

/** Comparison key: Windows paths are case-insensitive. */
export function pathKey(path: string, platform = process.platform): string {
  const display = displayPath(path);
  return platform === 'win32' ? display.toLowerCase() : display;
}

/** True when `child` is `parent` or lies inside it. Both are path keys. */
export function isWithin(childKey: string, parentKey: string): boolean {
  return (
    childKey === parentKey ||
    childKey.startsWith(parentKey.endsWith('/') ? parentKey : `${parentKey}/`)
  );
}

export const claudeHome = () =>
  process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
export const codexHome = () =>
  process.env.CODEX_HOME ?? join(homedir(), '.codex');
/** Cursor CLI and Agents window: `projects/` and `chats/` live here. */
export const cursorConfigDir = () =>
  process.env.CURSOR_CONFIG_DIR ?? join(homedir(), '.cursor');
/**
 * Cursor IDE user data. Windows uses `%APPDATA%`; macOS and Linux follow
 * Cursor's documented layout.
 */
export function cursorUserDir(): string {
  if (process.platform === 'win32')
    return join(
      process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
      'Cursor',
      'User',
    );
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'Cursor', 'User');
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
    'Cursor',
    'User',
  );
}
export const nabiHome = () => process.env.NABI_HOME ?? join(homedir(), '.nabi');
