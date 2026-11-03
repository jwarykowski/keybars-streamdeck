// The Stream Deck plugin: four actions on one shared view of keybars Pro.
import sd, {
  action,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { findCommand, focusing, focusTitle, Keybars, modes, type Status, validEvent } from "./core.ts";

const keybars = new Keybars(findCommand());

type PlaySettings = { mode?: string };
type EventSettings = { event?: string };

/** Runs keybars-pro for a key, showing an alert on the key when it fails. */
async function press<T extends JsonObject>(ev: KeyDownEvent<T>, args: string[]): Promise<boolean> {
  try {
    await keybars.run(args);
    await keybars.refresh();
    return true;
  } catch (err) {
    sd.logger.warn(`keybars-pro ${args.join(" ")}: ${String(err)}`);
    await ev.action.showAlert();
    return false;
  }
}

/** What a key shows: its state, and a title when the action sets one. */
type Face = { state: 0 | 1; title?: string };

/** An action whose keys show keybars Pro's status, now and as it changes. */
abstract class Shows<T extends JsonObject> extends SingletonAction<T> {
  // what each key shows now, so only changes go to Stream Deck
  private shown = new Map<string, string>();

  constructor() {
    super();
    keybars.subscribe((s) => this.showAll(s));
  }

  abstract face(id: string, s: Status | undefined): Face;

  async show(key: KeyAction<T>, s: Status | undefined): Promise<void> {
    const face = this.face(key.id, s);
    const was = this.shown.get(key.id);
    const now = JSON.stringify(face);
    if (was === now) return;
    this.shown.set(key.id, now);
    await key.setState(face.state);
    if (face.title !== undefined) await key.setTitle(face.title);
  }

  showAll(s: Status | undefined): void {
    this.actions.forEach((key) => {
      if (key.isKey()) void this.show(key, s);
    });
  }

  override async onWillAppear(ev: WillAppearEvent<T>): Promise<void> {
    this.shown.delete(ev.action.id);
    if (ev.action.isKey()) await this.show(ev.action, keybars.status);
  }

  override onWillDisappear(ev: WillDisappearEvent<T>): void {
    this.shown.delete(ev.action.id);
  }
}

@action({ UUID: "app.keybars.streamdeck.focus" })
class Focus extends Shows<JsonObject> {
  override onKeyDown(ev: KeyDownEvent<JsonObject>) {
    const on = keybars.status !== undefined && focusing(keybars.status);
    return press(ev, ["focus", on ? "stop" : "start"]).then(() => {});
  }

  face(_id: string, s: Status | undefined): Face {
    return { state: s && focusing(s) ? 1 : 0, title: focusTitle(s) };
  }
}

@action({ UUID: "app.keybars.streamdeck.lights" })
class Lights extends Shows<JsonObject> {
  override onKeyDown(ev: KeyDownEvent<JsonObject>) {
    return press(ev, ["toggle"]).then(() => {});
  }

  face(_id: string, s: Status | undefined): Face {
    return { state: s?.on ? 1 : 0 };
  }
}

@action({ UUID: "app.keybars.streamdeck.play" })
class Play extends Shows<PlaySettings> {
  // each key's mode, from its settings
  private modes = new Map<string, string>();

  override async onWillAppear(ev: WillAppearEvent<PlaySettings>) {
    this.modes.set(ev.action.id, ev.payload.settings.mode ?? "music");
    await super.onWillAppear(ev);
  }

  override onKeyDown(ev: KeyDownEvent<PlaySettings>) {
    return press(ev, ["play", this.modes.get(ev.action.id) ?? "music"]).then(() => {});
  }

  // a new mode chosen in the key's settings
  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<PlaySettings>) {
    this.modes.set(ev.action.id, ev.payload.settings.mode ?? "music");
    this.showAll(keybars.status);
  }

  face(id: string, s: Status | undefined): Face {
    const mode = this.modes.get(id) ?? "music";
    return { state: s?.plays === mode ? 1 : 0, title: modes[mode] ?? mode };
  }
}

@action({ UUID: "app.keybars.streamdeck.event" })
class SendEvent extends SingletonAction<EventSettings> {
  override async onKeyDown(ev: KeyDownEvent<EventSettings>) {
    const event = ev.payload.settings.event;
    if (!validEvent(event)) {
      await ev.action.showAlert();
      return;
    }
    if (await press(ev, ["alert", event])) await ev.action.showOk();
  }
}

sd.actions.registerAction(new Focus());
sd.actions.registerAction(new Lights());
sd.actions.registerAction(new Play());
sd.actions.registerAction(new SendEvent());
keybars.start();
await sd.connect();
