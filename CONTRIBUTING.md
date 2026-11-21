# Contributing to Sunny

## Run from source

Use macOS, Node.js 22.13 or newer and the pnpm version in [package.json](package.json).
Electron supplies SQLite, so setup needs no database server or AI account.

```sh
git clone https://github.com/Bruno-Nicolo/sunny.git
cd sunny
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

If your Node.js installation does not include Corepack, install the pinned version of
pnpm using the [pnpm installation guide](https://pnpm.io/installation) and run the
commands with `pnpm` directly.

## Check a change

```sh
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

Run the Electron integration suite related to your change. For example,
`corepack pnpm test:chat` exercises AI and authentication with local fixtures and mocked
provider requests. [package.json](package.json) lists all suites. Run
`corepack pnpm build:mac` to generate a DMG in `dist/` for your Mac. Pass
`--arm64` or `--x64` to select a target explicitly. Electron Builder uses Apple signing
and notarization credentials when configured.

See the [architecture guide](docs/architecture.md) for the Electron process boundaries
and source layout. The app icon comes from `resources/branding/sunny-solid.png`.
Run `corepack pnpm build:icons` on macOS after changing it.

## Report an issue or open a pull request

For bugs, include your Sunny version, macOS version, chip and steps to reproduce. Share a
synthetic or publicly redistributable PDF when a document is needed. Keep credentials
and private documents out of issues and pull requests. Use the
[security policy](SECURITY.md) for vulnerability reports.

In a pull request, describe the behavior change and how you verified it. Include a
screenshot or short recording for visible changes when it helps reviewers.
