<img src="resources/icon.png" alt="Sunny app icon" width="96" height="96">

# Sunny

Sunny is a local-first PDF viewer and annotation editor for macOS. Open PDFs in tabs,
highlight text, add notes, images and visible signatures, and reorder or export pages.

## Download

Sunny requires macOS 13 or later.

1. Open the [latest GitHub release](https://github.com/Bruno-Nicolo/sunny/releases/latest).
2. Download the `arm64.dmg` for Apple silicon or the `x64.dmg` for an Intel Mac.
3. Open the disk image and drag **Sunny** into **Applications**.

The first release uses an ad hoc signature and has no Apple notarization. If macOS blocks
it, verify that you downloaded it from the release above and follow
[Apple’s instructions for opening the app](https://support.apple.com/en-us/102445).

## Using Sunny

Open a PDF with **⌘O** and save edits with **⌘S**. See the
[user guide](docs/using-sunny.md) for page organization, recovery and keyboard shortcuts.

PDF viewing and editing run on your Mac. If you send an optional AI chat request, the
provider you select receives the prompt and relevant excerpts, attachments and conversation
context. Region attachments can include unsaved annotations. You can turn off requests in
**AI settings → Allow AI requests**.
See [AI chat data handling](docs/ai-chat.md#data-flow-and-citations).

[Report a bug](https://github.com/Bruno-Nicolo/sunny/issues/new/choose) ·
[Build from source or contribute](CONTRIBUTING.md) · [MIT License](LICENSE)
