# keybars for Stream Deck

An [Elgato Stream Deck](https://www.elgato.com/stream-deck) plugin for
[keybars Pro](https://keybars.app/pro/): its Focus timer, the keyboard's
lights and what it plays, on buttons that show where things are.

| action         | press                                                            | the button shows          |
| -------------- | ---------------------------------------------------------------- | ------------------------- |
| **Focus**      | starts Focus, or stops it                                        | the time left, `12:34`    |
| **Lights**     | keybars Pro's lights on, or the keyboard back to its layout      | lit while they're on      |
| **Play**       | plays its mode: the equaliser, Ambient, Typing or System         | lit while that mode plays |
| **Send event** | sends its event, e.g. `stream.brb`, to keybars Pro's alert rules | a tick when it's sent     |

Send event is for anything a rule can light: a "be right back" scene on the
keyboard, a reminder, a cue. Add a rule for its event on keybars Pro's
Alerts page.

## requirements

- keybars Pro running, with its command installed: App settings, Command
  line, **Install the command-line tool**
- Stream Deck 7.1 or later, on macOS or Windows (Windows untested)

The plugin looks for `keybars-pro` where keybars Pro installs it:
`/usr/local/bin`, `~/.local/bin`, `/opt/homebrew/bin` or inside the app on
macOS; `%LocalAppData%\keybars-pro\bin` on Windows.

## install

Until it's on the Elgato Marketplace, download the `.streamDeckPlugin` file
from the releases and open it.

## development

```sh
npm ci
npm run check && npm run lint && npm test
npm run validate   # Elgato's checks on the manifest
npm run pack       # dist/app.keybars.streamdeck.streamDeckPlugin
```

`src/core.ts` finds and runs `keybars-pro` and follows its status; its tests
use a fake `keybars-pro`. `src/plugin.test.ts` runs the built plugin against
a fake Stream Deck, a WebSocket server that registers it, shows it keys and
presses them, and checks what it sends back.

`python3 scripts/icons.py` redraws the images.

## licence

MIT
