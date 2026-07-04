# Kodama Release Policy

Kodama uses the monorepo package at `packages/kodama` as the canonical release
source. The standalone `Syfyivan/kodama` repo is a mirror for people who only
want the desktop pet; sync it from the monorepo, but do not let it become a
separate source of release truth.

## Release Channel

- Pushing `main` only syncs code. It does not ship a user update.
- A public Kodama release is created by bumping `packages/kodama/package.json`
  and pushing an annotated tag named `kodama-vX.Y.Z`.
- The GitHub Actions workflow for `kodama-v*` builds the app. The macOS job
  publishes the canonical auto-update assets to `Syfyivan/lark-codex-bridge`
  under the same `kodama-vX.Y.Z` tag.
- `electron-builder --publish` stays disabled in CI. This avoids its default
  `vX.Y.Z` draft releases, which do not match Kodama's tag namespace.
- Packaged apps read that GitHub Release metadata. Development runs
  (`pnpm start`) deliberately do not check remote updates.

## When To Release

Release a patch version (`0.1.x`) when any of these are true:

- A user-visible bug is fixed, especially false failure bubbles, bad session
  jumps, update behavior, hook parsing, security, or crash/hang fixes.
- The accumulated Kodama diff reaches about five user-facing commits, or about
  one week of useful changes has built up.
- A fix is already pushed and the installed app should pick it up without
  forcing manual rebuilds.

Release a minor version (`0.x.0`) when a complete new feature surface lands,
for example MCP control, a plugin API, a new event source, or a major panel/UI
workflow. Keep minor releases behind the same verification gate as patches.

Do not release only for docs, tests, internal-only refactors, or sync commits
unless they are bundled with user-visible changes.

## Pre-Release Checklist

Before tagging:

1. Keep unrelated dirty files unstaged.
2. Run `pnpm test`.
3. Run `pnpm run check`.
4. If hook/session/update behavior changed, smoke-test a running Kodama via
   `http://127.0.0.1:7766/healthz` or the relevant local event endpoint.
5. Sync the standalone mirror with
   `node packages/kodama/scripts/sync-standalone.mjs`.
6. Commit the version/documentation/sync changes.
7. Push `main`, tag `kodama-vX.Y.Z`, then push the tag.

After tagging, wait for the GitHub Action to finish and confirm the
`kodama-vX.Y.Z` release has the macOS auto-update assets:

- `Kodama-X.Y.Z-arm64-mac.zip`
- `Kodama-X.Y.Z-arm64-mac.zip.blockmap`
- `Kodama-X.Y.Z-arm64.dmg`
- `Kodama-X.Y.Z-arm64.dmg.blockmap`
- `latest-mac.yml`

## Auto-Update Behavior

Auto-update is already wired for packaged builds:

- The app checks GitHub Releases shortly after startup.
- Downloads start automatically when an update is available.
- The downloaded update installs when the app quits, or manually from the tray
  menu item `安装更新`.

For local development, code edits still need a Kodama process restart. This is
separate from packaged-app auto-update and is intentional.
