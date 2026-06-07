/**
 * Input Actuator Driver — Keyboard & Mouse Control
 *
 * Uses @nut-tree/nut-js (lazy-loaded) for keyboard/mouse control.
 * If @nut-tree/nut-js is not installed, returns a clear error rather than crashing.
 *
 * Window management (focus/resize/minimize) is dispatched via subprocess
 * (wmctrl/xdotool on Linux, osascript on macOS, PowerShell on Windows)
 * to avoid native binding complexity.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const EXEC_TIMEOUT_MS = 8_000;

// ── nut-js lazy loader ────────────────────────────────────────────────────────

type NutKey = string;

interface NutMouse {
  setPosition: (pos: { x: number; y: number }) => Promise<void>;
  move: (pos: { x: number; y: number }) => Promise<void>;
  click: (button: number) => Promise<void>;
  doubleClick: (button: number) => Promise<void>;
  scroll: (direction: number, amount: number) => Promise<void>;
}

interface NutKeyboard {
  type: (text: string) => Promise<void>;
  pressKey: (...keys: NutKey[]) => Promise<void>;
  releaseKey: (...keys: NutKey[]) => Promise<void>;
}

interface NutScreen {
  width: () => Promise<number>;
  height: () => Promise<number>;
}

interface NutLib {
  mouse: NutMouse;
  keyboard: NutKeyboard;
  screen: NutScreen;
  Key: Record<string, NutKey>;
  Button: { LEFT: number; RIGHT: number; MIDDLE: number };
  straightTo: (pos: { x: number; y: number }) => Promise<{ x: number; y: number }>;
  centerOf?: unknown;
}

let _nut: NutLib | null = null;
let _nutLoadError: string | null = null;

async function getNut(): Promise<NutLib> {
  if (_nutLoadError) throw new Error(_nutLoadError);
  if (_nut) return _nut;
  try {
    // @ts-expect-error — @nut-tree/nut-js is an optional dependency
    const mod = await import('@nut-tree/nut-js');
    // Assign through a typed local so the return narrows to NutLib (the module
    // import is untyped, so `_nut` would otherwise stay `NutLib | null`).
    const lib: NutLib = mod;
    _nut = lib;
    return lib;
  } catch (err) {
    _nutLoadError =
      '@nut-tree/nut-js is not installed. ' +
      'Install it as an optional dependency: npm install @nut-tree/nut-js. ' +
      `Original error: ${err instanceof Error ? err.message : String(err)}`;
    throw new Error(_nutLoadError, { cause: err });
  }
}

// ── Key combo parser ──────────────────────────────────────────────────────────

/**
 * Parse a key combo string like "ctrl+c", "shift+alt+tab" into nut-js Key values.
 */
function parseKeyCombo(keyCombo: string, Key: Record<string, NutKey>): NutKey[] {
  const keyMap: Record<string, string> = {
    ctrl: 'LeftControl',
    control: 'LeftControl',
    alt: 'LeftAlt',
    shift: 'LeftShift',
    meta: 'LeftSuper',
    cmd: 'LeftSuper',
    win: 'LeftSuper',
    enter: 'Return',
    return: 'Return',
    esc: 'Escape',
    escape: 'Escape',
    tab: 'Tab',
    space: 'Space',
    backspace: 'Backspace',
    delete: 'Delete',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
  };

  return keyCombo.split('+').map((part) => {
    const lower = part.trim().toLowerCase();
    const mapped = keyMap[lower] ?? part.trim();
    return Key[mapped] ?? Key[lower] ?? mapped;
  });
}

// ── Mouse operations ──────────────────────────────────────────────────────────

export async function moveMouse(x: number, y: number): Promise<void> {
  const nut = await getNut();
  await nut.mouse.move(await nut.straightTo({ x, y }));
}

export async function clickMouse(
  x: number | undefined,
  y: number | undefined,
  button: 'left' | 'right' | 'middle' = 'left',
  doubleClick = false
): Promise<void> {
  const nut = await getNut();

  if (x !== undefined && y !== undefined) {
    await nut.mouse.move(await nut.straightTo({ x, y }));
  }

  const btnMap = { left: nut.Button.LEFT, right: nut.Button.RIGHT, middle: nut.Button.MIDDLE };
  const btn = btnMap[button] ?? nut.Button.LEFT;

  if (doubleClick) {
    await nut.mouse.doubleClick(btn);
  } else {
    await nut.mouse.click(btn);
  }
}

export async function scrollMouse(dx: number, dy: number): Promise<void> {
  const nut = await getNut();
  // Scroll vertically; nut-js scroll direction: positive = down
  if (dy !== 0) {
    await nut.mouse.scroll(dy > 0 ? 1 : -1, Math.abs(dy));
  }
  if (dx !== 0) {
    // Horizontal scroll is not universally supported; best-effort
    await nut.mouse.scroll(dx > 0 ? 2 : -2, Math.abs(dx));
  }
}

// ── Keyboard operations ───────────────────────────────────────────────────────

export async function typeText(text: string, _delayMs = 0): Promise<void> {
  const nut = await getNut();
  await nut.keyboard.type(text);
}

export async function pressKey(keyCombo: string): Promise<void> {
  const nut = await getNut();
  const keys = parseKeyCombo(keyCombo, nut.Key);
  await nut.keyboard.pressKey(...keys);
}

export async function releaseKey(keyCombo: string): Promise<void> {
  const nut = await getNut();
  const keys = parseKeyCombo(keyCombo, nut.Key);
  await nut.keyboard.releaseKey(...keys);
}

// ── Window management (subprocess-based) ─────────────────────────────────────

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function windowManageLinux(
  action: 'activate' | 'resize',
  windowId: string,
  bounds?: WindowBounds
): Promise<void> {
  if (action === 'activate') {
    await execFileAsync('wmctrl', ['-ia', windowId], { timeout: EXEC_TIMEOUT_MS });
  } else if (action === 'resize' && bounds) {
    // wmctrl resize: -e gravity,x,y,w,h
    await execFileAsync(
      'wmctrl',
      ['-ir', windowId, '-e', `0,${bounds.x},${bounds.y},${bounds.width},${bounds.height}`],
      { timeout: EXEC_TIMEOUT_MS }
    );
  }
}

async function windowManageMacOS(
  action: 'activate' | 'resize' | 'minimize',
  windowId: string,
  bounds?: WindowBounds
): Promise<void> {
  let script = '';
  if (action === 'activate') {
    script = `
      tell application "System Events"
        set allProcs to every application process
        repeat with proc in allProcs
          try
            set wins to every window of proc
            repeat with win in wins
              if (id of win as string) is "${windowId}" then
                set frontmost of proc to true
                perform action "AXRaise" of win
              end if
            end repeat
          end try
        end repeat
      end tell
    `;
  } else if (action === 'minimize') {
    script = `
      tell application "System Events"
        set allProcs to every application process
        repeat with proc in allProcs
          try
            set wins to every window of proc
            repeat with win in wins
              if (id of win as string) is "${windowId}" then
                set miniaturized of win to true
              end if
            end repeat
          end try
        end repeat
      end tell
    `;
  } else if (action === 'resize' && bounds) {
    script = `
      tell application "System Events"
        set allProcs to every application process
        repeat with proc in allProcs
          try
            set wins to every window of proc
            repeat with win in wins
              if (id of win as string) is "${windowId}" then
                set position of win to {${bounds.x}, ${bounds.y}}
                set size of win to {${bounds.width}, ${bounds.height}}
              end if
            end repeat
          end try
        end repeat
      end tell
    `;
  }
  if (script) {
    await execFileAsync('osascript', ['-e', script], { timeout: EXEC_TIMEOUT_MS });
  }
}

async function windowManageWin(
  action: 'activate' | 'resize' | 'minimize',
  windowId: string,
  bounds?: WindowBounds
): Promise<void> {
  let script = '';
  if (action === 'activate') {
    script = `(New-Object -ComObject Shell.Application).Windows() | Where-Object { $_.HWND -eq ${windowId} } | ForEach-Object { $_.Visible = $true }`;
  } else if (action === 'minimize') {
    script = `$hwnd = ${windowId}; [System.Runtime.InteropServices.Marshal]::GetActiveObject('Shell.Application')`;
  } else if (action === 'resize' && bounds) {
    script = `
      Add-Type -Name Win32 -Namespace System -MemberDefinition @'
      [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
'@
      [System.Win32]::MoveWindow(${windowId}, ${bounds.x}, ${bounds.y}, ${bounds.width}, ${bounds.height}, $true)
    `;
  }
  if (script) {
    await execFileAsync('powershell', ['-NonInteractive', '-Command', script], {
      timeout: EXEC_TIMEOUT_MS,
    });
  }
}

export async function focusWindow(windowId: string): Promise<void> {
  switch (process.platform) {
    case 'darwin':
      return windowManageMacOS('activate', windowId);
    case 'win32':
      return windowManageWin('activate', windowId);
    default:
      return windowManageLinux('activate', windowId);
  }
}

export async function resizeWindow(windowId: string, bounds: WindowBounds): Promise<void> {
  switch (process.platform) {
    case 'darwin':
      return windowManageMacOS('resize', windowId, bounds);
    case 'win32':
      return windowManageWin('resize', windowId, bounds);
    default:
      return windowManageLinux('resize', windowId, bounds);
  }
}

export async function minimizeWindow(windowId: string): Promise<void> {
  switch (process.platform) {
    case 'darwin':
      return windowManageMacOS('minimize', windowId);
    case 'win32':
      return windowManageWin('minimize', windowId);
    default:
      // xdotool as fallback for Linux minimize
      try {
        await execFileAsync('xdotool', ['windowminimize', windowId], { timeout: EXEC_TIMEOUT_MS });
      } catch {
        // Best-effort
      }
  }
}
