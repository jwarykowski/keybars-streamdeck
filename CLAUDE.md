# keybars for Stream Deck

A Stream Deck plugin (TypeScript, Elgato's SDK 3, bundled by esbuild) with
four actions on keybars Pro: Focus, Lights, Play and Send event. README.md
has the detail; this file is what to keep in mind while working here.

## Commands

- `npm run check` (tsc), `npm run lint` (oxlint), `npm run fmt` (oxfmt;
  never prettier), `npm test` (builds, then `node --test`), `npm run
  validate` (Elgato's manifest checks), `npm run pack`.

## Keep in mind

- `app.keybars.streamdeck.sdPlugin/` is the plugin as shipped: manifest,
  images, the settings pages in `ui/`, and the bundle in `bin/` (built, not
  committed). The folder's name must be the manifest's UUID.
- The bundle is `bin/plugin.mjs`: ESM with a `createRequire` banner, since
  the SDK's `ws` requires Node built-ins and the packed plugin has no
  package.json to say it's a module.
- Stream Deck runs the plugin from its folder; the SDK reads manifest.json
  from the working directory. SDK 3 needs Stream Deck 7.1
  (`Software.MinimumVersion`); with less it logs an error and stays up
  without connecting.
- Every key's look goes through `Shows.face`, and only changes are sent:
  Focus ticks each second and would otherwise redraw every key.
- `src/plugin.test.ts` is the end-to-end check: it speaks Stream Deck's
  WebSocket protocol to the built plugin. A new action wants a case there.
- Node's type stripping runs the tests: no parameter properties, enums or
  namespaces in `src/`.

## Related repos (in ~/development)

- `keybars-pro`: the app and the `keybars-pro` command (`status -json`,
  `watch`, `focus`, `toggle`, `play`, `alert`); `internal/install` is where
  it puts the command, which `candidates` in `src/core.ts` mirrors.
