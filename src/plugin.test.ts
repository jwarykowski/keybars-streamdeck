// The built plugin (npm test builds it) against a fake Stream Deck: a
// WebSocket server that registers it, shows it keys and presses them, as
// Stream Deck would, with a fake keybars-pro on PATH.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";

import { type WebSocket, WebSocketServer } from "ws";

const plugin = resolve(import.meta.dirname, "..", "app.keybars.streamdeck.sdPlugin");
const dir = mkdtempSync(join(tmpdir(), "keybars-streamdeck-plugin-"));
const log = join(dir, "log");
writeFileSync(join(dir, "status"), '{"on":false,"plays":"music","focus":{"phase":""}}');
writeFileSync(
  join(dir, "keybars-pro"),
  `#!/bin/sh
case "$1" in
status) cat "${dir}/status" ;;
watch) exec sleep 30 ;;
*) echo "$*" >>"${log}" ;;
esac
`,
);
chmodSync(join(dir, "keybars-pro"), 0o755);

type Message = { event: string; context?: string; payload?: Record<string, unknown> };
const got: Message[] = [];
let socket: WebSocket;
let child: ChildProcess;
const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
const settings: Record<string, Record<string, unknown>> = {};

before(
  async () => {
    await new Promise<void>((r) => server.once("listening", () => r()));
    const port = (server.address() as { port: number }).port;
    const registered = new Promise<void>((r) => {
      server.on("connection", (ws) => {
        socket = ws;
        ws.on("message", (raw) => {
          const m = JSON.parse(String(raw)) as Message;
          got.push(m);
          if (m.event === "registerPlugin") r();
          // Stream Deck answers getSettings with the key's settings
          if (m.event === "getSettings" && m.context) {
            send("didReceiveSettings", m.context, settings[m.context]?.action as string, {
              settings: settings[m.context]?.settings ?? {},
            });
          }
        });
      });
    });
    const info = {
      application: { font: "", language: "en", platform: "mac", platformVersion: "15.0", version: "7.1.0.0" },
      plugin: { uuid: "app.keybars.streamdeck", version: "0.1.0.0" },
      devicePixelRatio: 2,
      colors: {},
      devices: [{ id: "deck", name: "Stream Deck", size: { columns: 5, rows: 3 }, type: 0 }],
    };
    child = spawn(
      process.execPath,
      [
        join(plugin, "bin", "plugin.mjs"),
        "-port",
        String(port),
        "-pluginUUID",
        "test-uuid",
        "-registerEvent",
        "registerPlugin",
        "-info",
        JSON.stringify(info),
      ],
      // Stream Deck runs a plugin from its folder, where the SDK reads manifest.json
      { cwd: plugin, env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, stdio: "ignore" },
    );
    await Promise.race([
      registered,
      new Promise((_, reject) => child.once("exit", (code) => reject(new Error(`the plugin exited (${code})`)))),
    ]);
  },
  { timeout: 20_000 },
);

after(() => {
  child?.kill();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

function send(event: string, context: string, action: string, payload: Record<string, unknown> = {}) {
  socket.send(JSON.stringify({ event, action, context, device: "deck", payload }));
}

function key(event: string, context: string, action: string, keySettings: Record<string, unknown> = {}) {
  settings[context] = { action, settings: keySettings };
  send(event, context, action, {
    controller: "Keypad",
    coordinates: { column: 0, row: 0 },
    isInMultiAction: false,
    settings: keySettings,
    state: 0,
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits for the plugin to send a message matching want, and takes it. */
async function sent(want: (m: Message) => boolean, what: string): Promise<Message> {
  for (let i = 0; i < 100; i++) {
    const at = got.findIndex(want);
    if (at >= 0) return got.splice(at, 1)[0];
    await wait(50);
  }
  assert.fail(`no ${what}; got ${JSON.stringify(got.map((m) => [m.event, m.context, m.payload]))}`);
}
const title = (context: string, text: string) => (m: Message) =>
  m.event === "setTitle" && m.context === context && m.payload?.title === text;
const state = (context: string, n: number) => (m: Message) =>
  m.event === "setState" && m.context === context && m.payload?.state === n;
const logged = () => {
  try {
    return readFileSync(log, "utf8");
  } catch {
    return "";
  }
};

test("keys show keybars Pro's status as they appear, and only what changed after", async () => {
  key("willAppear", "focus", "app.keybars.streamdeck.focus");
  key("willAppear", "lights", "app.keybars.streamdeck.lights");
  key("willAppear", "play", "app.keybars.streamdeck.play", { mode: "ambient" });
  await sent(title("focus", "Focus"), "Focus title");
  await sent(state("focus", 0), "Focus off");
  await sent(state("lights", 0), "lights off");
  await sent(title("play", "Ambient"), "Play's mode as its title");
  await sent(state("play", 0), "Play off while music plays");
  await wait(1200);
  assert.deepEqual(
    got.filter((m) => m.event.startsWith("set") || m.event === "getSettings"),
    [],
    "nothing changed, so nothing more was sent",
  );
});

test("pressing a key runs keybars-pro, and the keys follow", async () => {
  writeFileSync(join(dir, "status"), '{"on":true,"plays":"ambient","focus":{"phase":"work","remaining":1500}}');
  key("keyDown", "lights", "app.keybars.streamdeck.lights");
  await sent(state("lights", 1), "lights on after the press");
  assert.match(logged(), /^toggle$/m);
  await sent(state("play", 1), "Play on once Ambient plays");
  await sent(title("focus", "25:00"), "Focus's time left");
  key("didReceiveSettings", "play", "app.keybars.streamdeck.play", { mode: "cpu" });
  await sent(title("play", "System"), "Play's new mode");
  key("keyDown", "play", "app.keybars.streamdeck.play", { mode: "cpu" });
  for (let i = 0; i < 40 && !/^play cpu$/m.test(logged()); i++) await wait(50);
  assert.match(logged(), /^play cpu$/m);
});

test("Send event sends what its settings name, and refuses anything else", async () => {
  // Stream Deck shows a key before it's pressed
  key("willAppear", "ev", "app.keybars.streamdeck.event", { event: "stream.brb" });
  key("willAppear", "bad", "app.keybars.streamdeck.event", { event: "x; rm -rf ~" });
  key("keyDown", "ev", "app.keybars.streamdeck.event", { event: "stream.brb" });
  await sent((m) => m.event === "showOk" && m.context === "ev", "showOk");
  assert.match(logged(), /^alert stream\.brb$/m);
  key("keyDown", "bad", "app.keybars.streamdeck.event", { event: "x; rm -rf ~" });
  await sent((m) => m.event === "showAlert" && m.context === "bad", "showAlert");
});
