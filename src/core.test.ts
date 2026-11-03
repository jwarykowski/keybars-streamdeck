import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { candidates, findCommand, focusTitle, Keybars, lines, parseStatus, type Status, validEvent } from "./core.ts";

test("keybars-pro is looked for where the app installs it", () => {
  assert.deepEqual(candidates("darwin", {}, "/Users/me"), [
    "/usr/local/bin/keybars-pro",
    "/Users/me/.local/bin/keybars-pro",
    "/opt/homebrew/bin/keybars-pro",
    "/Applications/keybars Pro.app/Contents/MacOS/keybars-pro-cli",
  ]);
  assert.deepEqual(candidates("win32", { LOCALAPPDATA: "C:/Users/me/AppData/Local" }, "C:/Users/me"), [
    join("C:/Users/me/AppData/Local", "keybars-pro", "bin", "keybars-pro.cmd"),
  ]);
  assert.equal(
    findCommand((p) => String(p) === "/opt/homebrew/bin/keybars-pro", "darwin"),
    "/opt/homebrew/bin/keybars-pro",
  );
  assert.equal(
    findCommand(() => false, "darwin"),
    "keybars-pro",
  );
});

test("status, and Focus's title", () => {
  const s = parseStatus('{"on":true,"plays":"ambient","focus":{"phase":"work","remaining":754.6}}');
  assert.deepEqual(s, { on: true, plays: "ambient", focus: { phase: "work", remaining: 754.6 } });
  assert.equal(focusTitle(s), "12:35");
  assert.equal(focusTitle(parseStatus("{}")), "Focus");
  assert.equal(focusTitle(undefined), "Focus");
});

test("event names a key may send", () => {
  assert.ok(validEvent("stream.brb"));
  assert.ok(validEvent("build_2.failed-now"));
  assert.ok(!validEvent(""));
  assert.ok(!validEvent(".x"));
  assert.ok(!validEvent("a b"));
  assert.ok(!validEvent("a;rm"));
  assert.ok(!validEvent(undefined));
});

test("watch output a whole line at a time", () => {
  assert.deepEqual(lines("", '{"a":1}\n{"b"'), { done: ['{"a":1}'], rest: '{"b"' });
  assert.deepEqual(lines('{"b"', ":2}\n"), { done: ['{"b":2}'], rest: "" });
});

const dir = mkdtempSync(join(tmpdir(), "keybars-streamdeck-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const log = join(dir, "log");
const fake = join(dir, "keybars-pro");
// status answers from a file; watch streams a Focus update, then a settings
// change, then exits as if the app quit
writeFileSync(
  fake,
  `#!/bin/sh
case "$1" in
status) cat "${dir}/status" ;;
watch) sleep 0.2; echo '{"event":"focus","data":{"phase":"work","remaining":600}}'; sleep 0.2
  echo '{"event":"settings"}'; sleep 0.6 ;;
*) echo "$*" >>"${log}"; if [ "$1" = fail ]; then echo "keybars-pro: keybars Pro isn't running" >&2; exit 3; fi ;;
esac
`,
);
chmodSync(fake, 0o755);
writeFileSync(join(dir, "status"), '{"on":false,"plays":"music","focus":{"phase":""}}');

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("Keybars runs keybars-pro, and says why it failed", async () => {
  const k = new Keybars(fake);
  await k.run(["play", "ambient"]);
  assert.equal(readFileSync(log, "utf8"), "play ambient\n");
  await assert.rejects(k.run(["fail"]), /^Error: keybars Pro isn't running$/);
});

test("Keybars follows the status, and starts again after the app quits", async () => {
  const k = new Keybars(fake, 100);
  const seen: (Status | undefined)[] = [];
  k.subscribe((s) => seen.push(s && structuredClone(s)));
  k.start();
  try {
    await wait(100);
    assert.equal(k.status?.on, false);
    // Focus arrives from watch
    await wait(250);
    assert.equal(k.status?.focus.phase, "work");
    // settings changed: the status is read again
    writeFileSync(join(dir, "status"), '{"on":true,"plays":"ambient","focus":{"phase":"work","remaining":590}}');
    await wait(400);
    assert.equal(k.status?.plays, "ambient");
    // watch exits: nothing known until it's started again
    await wait(500);
    assert.ok(seen.includes(undefined));
    await wait(300);
    assert.equal(k.status?.on, true);
  } finally {
    k.stop();
  }
});
