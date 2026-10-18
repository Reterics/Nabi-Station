import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Signal 0 checks existence without touching the process; EPERM still means it exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * CIM reports creation time with microsecond precision, so its FILETIME is up to
 * 9 ticks (100 ns each) below the exact value Claude Code records.
 */
const FILETIME_TOLERANCE = 10n;

export function sameStartTime(recorded: string, observed: string): boolean {
  try {
    const difference = BigInt(recorded) - BigInt(observed);
    return (difference < 0n ? -difference : difference) <= FILETIME_TOLERANCE;
  } catch {
    return false;
  }
}

const startTimes = new Map<number, Promise<string | null>>();

/**
 * Windows FILETIME of the process's creation, or null when unknown. Spawning
 * PowerShell takes ~0.5 s, so each pid is looked up once; the native helper
 * (plan §7) will replace this.
 */
export function processStartFiletime(pid: number): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  let pending = startTimes.get(pid);
  if (!pending) {
    pending = run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { $p.CreationDate.ToFileTimeUtc() }`,
      ],
      { windowsHide: true, timeout: 10_000 },
    ).then(
      ({ stdout }) => stdout.trim() || null,
      () => null,
    );
    startTimes.set(pid, pending);
  }
  return pending;
}

/**
 * A recorded (pid, start time) pair still names a live process. Without a
 * recorded start time, or off Windows, liveness alone has to do.
 */
export async function isSameProcess(
  pid: number,
  procStart?: string,
): Promise<boolean> {
  if (!isAlive(pid)) {
    startTimes.delete(pid);
    return false;
  }
  if (!procStart) return true;
  const observed = await processStartFiletime(pid);
  return observed === null || sameStartTime(procStart, observed);
}
