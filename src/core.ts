// keybars Pro as the plugin sees it: finding keybars-pro, running it, reading
// its status and following its watch stream. No Stream Deck here, so it can
// be tested on its own.
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where keybars-pro may be: Stream Deck doesn't see your shell's PATH. */
export function candidates(platform = process.platform, env = process.env, home = homedir()): string[] {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return [join(local, "keybars-pro", "bin", "keybars-pro.cmd")];
  }
  return [
    "/usr/local/bin/keybars-pro",
    join(home, ".local/bin/keybars-pro"),
    "/opt/homebrew/bin/keybars-pro",
    "/Applications/keybars Pro.app/Contents/MacOS/keybars-pro-cli",
  ];
}

export function findCommand(exists = existsSync, platform = process.platform): string {
  return candidates(platform).find((p) => exists(p)) ?? "keybars-pro";
}

// a .cmd launcher runs only through cmd.exe, so its arguments are quoted
const viaShell = (cmd: string) => /\.cmd$/i.test(cmd);
const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;

export type Status = {
  on: boolean;
  plays: string;
  focus: { phase: string; remaining: number };
};

export function parseStatus(json: string): Status {
  const v = JSON.parse(json) as Partial<Status>;
  return {
    on: v.on ?? false,
    plays: v.plays ?? "music",
    focus: { phase: v.focus?.phase ?? "", remaining: v.focus?.remaining ?? 0 },
  };
}

export const focusing = (s: Status) => s.focus.phase === "work" || s.focus.phase === "break";

/** A Focus key's title: "12:34" while it runs, "Focus" when it doesn't. */
export function focusTitle(s: Status | undefined): string {
  if (!s || !focusing(s)) return "Focus";
  const left = Math.max(0, Math.round(s.focus.remaining));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

export const modes: Record<string, string> = {
  music: "Equaliser",
  ambient: "Ambient",
  typing: "Typing",
  cpu: "System",
};

/** An event name a key may send: letters, digits, dots, dashes and underscores. */
export function validEvent(event: unknown): event is string {
  return typeof event === "string" && /^[A-Za-z0-9][\w.-]*$/.test(event);
}

/** Splits watch output into whole lines, keeping the partial last one. */
export function lines(buffered: string, chunk: string): { done: string[]; rest: string } {
  const all = (buffered + chunk).split("\n");
  const rest = all.pop() ?? "";
  return { done: all.filter((l) => l.trim() !== ""), rest };
}

/**
 * Keybars runs keybars-pro and keeps its status: read once, then kept
 * current from keybars-pro watch, which is started again a while after the
 * app quits.
 */
export class Keybars {
  status: Status | undefined;
  private listeners = new Set<(s: Status | undefined) => void>();
  private watcher: ChildProcess | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private refreshing: ReturnType<typeof setTimeout> | undefined;
  private ticker: ReturnType<typeof setInterval> | undefined;

  readonly command: string;
  private retryMs: number;

  constructor(command: string, retryMs = 15_000) {
    this.command = command;
    this.retryMs = retryMs;
  }

  run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const shell = viaShell(this.command);
      const file = shell ? quote(this.command) : this.command;
      execFile(file, shell ? args.map(quote) : args, { timeout: 10_000, shell }, (err, stdout, stderr) => {
        if (err)
          reject(
            new Error(
              stderr
                .trim()
                .split("\n")
                .at(-1)
                ?.replace(/^keybars-pro: /, "") || err.message,
            ),
          );
        else resolve(stdout);
      });
    });
  }

  /** Calls fn now and whenever the status changes; returns a function that stops it. */
  subscribe(fn: (s: Status | undefined) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.status);
  }

  async refresh(): Promise<void> {
    try {
      this.status = parseStatus(await this.run(["status", "-json"]));
    } catch {
      this.status = undefined;
    }
    this.emit();
  }

  /** Starts following keybars Pro; stop() ends it. */
  start(): void {
    void this.refresh();
    this.follow();
    // Focus's remaining time counts down between its events
    this.ticker = setInterval(() => {
      const s = this.status;
      if (s && focusing(s) && s.focus.remaining > 0) {
        s.focus.remaining -= 1;
        this.emit();
      }
    }, 1000);
  }

  stop(): void {
    clearTimeout(this.retry);
    clearTimeout(this.refreshing);
    clearInterval(this.ticker);
    const child = this.watcher;
    this.watcher = undefined;
    child?.kill();
  }

  private follow(): void {
    const shell = viaShell(this.command);
    const args = ["watch", "-only", "focus,settings,paused"];
    const child = spawn(shell ? quote(this.command) : this.command, shell ? args.map(quote) : args, {
      stdio: ["ignore", "pipe", "ignore"],
      shell,
    });
    this.watcher = child;
    let rest = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      const got = lines(rest, chunk);
      rest = got.rest;
      for (const line of got.done) this.onEvent(line);
    });
    child.on("error", () => {});
    child.on("exit", () => {
      if (this.watcher !== child) return;
      this.watcher = undefined;
      this.status = undefined;
      this.emit();
      this.retry = setTimeout(() => {
        void this.refresh();
        this.follow();
      }, this.retryMs);
    });
  }

  private onEvent(line: string): void {
    let ev: { event?: string; data?: { phase?: string; remaining?: number } };
    try {
      ev = JSON.parse(line) as typeof ev;
    } catch {
      return;
    }
    if (ev.event === "focus" && this.status) {
      this.status.focus = { phase: ev.data?.phase ?? "", remaining: ev.data?.remaining ?? 0 };
      this.emit();
      return;
    }
    // anything else may have changed what's on or playing: ask again, once
    clearTimeout(this.refreshing);
    this.refreshing = setTimeout(() => void this.refresh(), 200);
  }
}
