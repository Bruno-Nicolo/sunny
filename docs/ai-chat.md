# AI chat

Open a PDF and choose **AI chat**. The panel can be closed or resized; its width is saved. Below
1000 px, the PDF and chat alternate. Drafts and attachments survive this switch and panel closure.

AI requests are enabled by default. You can disable **Allow AI requests** in **AI settings**;
the saved preference is retained. Connect a service in **AI settings**. **Continue with
ChatGPT** opens the system browser and requests permission to use an eligible plan. It does not
import personal ChatGPT conversations. Availability is controlled by OpenAI and account/workspace
eligibility. API keys for OpenAI, Anthropic, Google Gemini and OpenRouter use separate provider
billing. The app never switches providers automatically. OpenRouter itself routes requests to its
upstream providers. A new provider or access method starts a new conversation; models within the
same provider can change inside a conversation.

New chat opens an unsaved draft. A conversation is persisted only when its first user message
is accepted, including attachment-only messages. Empty or rejected requests do not add history
entries. The placeholder title is not editable; the first message supplies the initial title.
While an answer is generated, the composer remains available for preparing the next message,
including its attachments and model. The next message cannot be sent until generation stops.

Use **Edit message** below a user message to change its text. **Save & send** keeps its original
selections, removes all later messages and generates a new answer with the selected model. Cancel
leaves the conversation unchanged. Editing is available when the conversation is ready to send.

Use **Fork conversation** below a finished assistant response to open a separate saved chat with
all messages through that response, including sources, selections and work history. Later messages
stay in the original chat. Forks appear in conversation history with “(fork)” in their title and can
be continued, renamed or deleted independently. Message actions wait for an active response to finish.

## Selecting context

- Select text in the PDF, then choose **Ask AI**. Selections spanning pages produce one
  attachment per page.
- Choose **Select region**, then drag a rectangle. The attachment contains a fresh rendering of
  the original PDF content, without annotations or editor overlays. Escape cancels selection.
- Drop files onto the message input, or choose **Attach files** in the paperclip menu to add
  external PDFs, UTF-8 text/code files,
  or PNG, JPEG and WebP images. Files are read locally; their extracted text or resized images
  are sent with the message and saved in chat history. External files display their names and
  are not citation targets in the open PDF. PDFs without extractable text must be attached as
  page images. Each input file is limited to 20 MiB; oversized content is rejected, not truncated.
- Collect multiple selections, inspect previews, remove attachments, or use **Explain**,
  **Summarize**, **Translate**, or **Formula / figure** to prepare a message. Actions do not send it.

Requests accept at most 12 attachments, 6 MiB of attachment images, 32,000 attachment text characters
and 16,000 message characters. Limits are checked before provider calls. A rejected request keeps
the draft and attachments. Each crop is rendered at up to twice PDF scale, with a maximum side of
1600 pixels. Partially intersecting text items are left to the image rather than sending text
outside the selected region.

## Data flow and citations

The renderer stays sandboxed, with its existing network CSP. Chat operations cross a typed preload
API; AI IPC accepts only the app's main frame. The main process owns credentials and provider
requests. Official OpenAI, Anthropic and Google SDKs handle their transports; OpenRouter uses its
documented Chat Completions interface through the OpenAI SDK.

PDF.js extracts text and page coordinates locally on first chat use. Extraction and original page
rendering proceed a page at a time, with progress and cancellation. A SHA-256 hash of the loaded
PDF bytes, the PDF.js version and the index format identifies a persistent cache entry. Reopening
an unchanged PDF reuses saved passages and coordinates, including after app restart, without
extracting text or rendering every page again. Cache hits return only document metadata to the renderer; passages remain in SQLite.
The byte hash still requires reading the PDF.
Changed bytes or an updated indexing engine require analysis again; annotation-only changes can
still resolve to the same content version and retain valid conversations. Opening a PDF alone
starts no AI indexing or cloud request. Markdown, math and chat UI code are loaded when chat is first opened.

SQLite FTS5 stores passages. For a question, the chosen model prepares search queries with
synonyms and terms in the document's language; the app retrieves matches and nearby passages
locally. There is no remote file upload, embedding index or hosted file-search service. Retrieval
is lexical and query-assisted; it does not guarantee that every relevant passage is found.

Sources have an app-owned ID, page, text and rectangles in PDF coordinates. The model emits
`[[source_id]]`; the app accepts only IDs supplied as context and resolves them to the saved
geometry. Unknown IDs become an unavailable-reference notice. Clicking a valid reference scrolls
to its passage and adds a temporary overlay that follows zoom and rotation. Reference validation
checks the destination, not whether the passage semantically supports the claim.

Selected regions take priority; other passages remain available. Recent complete conversation
exchanges and their source context are included within explicit budgets. Older exchanges remain
in local history even when they no longer fit the model context. Each answer records its model.

The assistant is instructed to distinguish PDF evidence, interpretation and external model
knowledge. It can identify possible document errors with appropriate uncertainty. It has no web
search and must not claim external verification.

## Reasoning and tool calls

The model selector in the composer opens a menu with Model and Effort entries, each opening
its own submenu. Effort is disabled for models without selectable reasoning levels.
Only the model name appears in the composer. For models with selectable reasoning levels,
Effort lists the available levels and marks the current choice. Choices are saved
separately for each provider and model; Medium is selected initially where supported.
The chosen level applies to every model call for the next message, including document search
planning and summary processing. Changing it during an answer affects the next request.

Each assistant message stores an ordered work timeline alongside the answer. One disclosure contains
tool calls, reasoning and assistant updates in their arrival order.
It reads **Working for <time>** with a timer updated each second throughout the request, and finally
**Worked for <time>** with the elapsed request time saved by the main process. Durations use
seconds, minutes and hours as needed. It opens during the
request without a toggle and closes at completion. Only the finished timeline can be toggled;
its chevron sits directly beside the elapsed-time label. Tool details have their own
disclosures, initially closed even while running. Reasoning appears directly in the work timeline.
ChatGPT and OpenAI updates appear when the provider sends a message in the `commentary` phase.
Answers, updates and reasoning share one Markdown renderer. The running timer updates only its label;
unchanged Markdown and tool records do not need to render again for each stream event.

The timeline shows reasoning returned during search planning, summary processing and answer
generation. ChatGPT and OpenAI request summaries on reasoning models and also read summaries
returned at completion. Anthropic, Gemini and OpenRouter request reasoning according to the model
catalog. Encrypted reasoning and signatures are not displayed or saved. Only answer text and
cited sources enter subsequent conversation context.

`read_document` reads passages from the local index; `search_document` runs the local full-text
search. Each invocation exposes its actual input, a result preview, and completion or error state.
The timeline can also show tool calls reported by provider streams. A client-side tool request is
shown as **Requested**. The PDF chat executes its local document operations. Reasoning, updates
and tool records are saved with the assistant message, including interrupted responses.

## Full-document requests

**Summarize PDF**, or a request classified as requiring a whole-document synthesis, processes all
groups of extractable text while the Working indicator remains visible, then combines the section summaries. This may
make multiple requests. Groups are bounded to about 20,000 text characters, at most 100 groups;
intermediate summaries are reduced in bounded rounds. Oversized context stops with an explicit
error. Pages without extractable text are not interpreted automatically; the answer must disclose
this. A user-selected region can still be sent as an image without OCR of the whole document.

## Storage and document changes

`userData/ai/chat.sqlite` holds settings, passage indices, conversations, selected text and crop
images. Conversation deletion removes its messages and selections. The shared local PDF index
remains reusable. No chat synchronization is provided. Chat data is local application data;
credentials are separately encrypted using Electron `safeStorage` and written atomically with
0600 permissions. Unsupported or plaintext-only system credential storage is rejected.

Content versions hash extracted text/geometry and annotation-free rendered page pixels. Rendered
pages are capped at four million pixels for bounded memory, so this is a content/appearance
identity rather than an exact byte identity. Font/rendering changes can conservatively create a
new version. Annotations do not participate in the identity. Separate file paths retain separate
conversation ownership even when their content hashes match.

Changed content retains old conversations and their saved excerpts/images, but disables their
citations and requires a new conversation. The app does not archive complete historical PDFs.
Interrupted streams are checkpointed locally and marked interrupted on restart. Stop aborts the
local request; whether an upstream stops billing immediately depends on the provider.

## ChatGPT authentication

The official flow uses a stable installation host ID, the system browser, a loopback callback,
PKCE S256, state and nonce. The issued client ID is saved before code exchange, so an expired
code does not lose the registration. Returning sign-in includes the saved identity hint and
rejects an identity different from the selected account. ID tokens are checked
against OpenAI's JWKS for signature, issuer, audience, expiry, nonce and subject. Refreshes are
serialized and rotating tokens are saved atomically. Logout removes local credentials and attempts
remote revocation through OpenID discovery; an unconfirmed revocation is reported.

The panel displays browser, code exchange, identity verification and secure persistence stages.
An accepted callback brings the app to the foreground. Cancel interrupts the browser wait, token
exchange and identity verification. A valid identity without plan permission remains signed in,
but inference is disabled until the user explicitly enables plan usage. Credential changes become
visible only after the encrypted atomic write succeeds. Refresh results cannot replace or clear
a newer session, and stopping an answer stops waiting for a shared refresh.

ChatGPT inference uses the public Responses API with `store:false`, `stream:true` and an explicit
input array. It does not use internal ChatGPT endpoints, hosted file search or personal chat data.
Model choices come from the signed-in account's catalog. Completion requires a terminal success
event; failures and incomplete streams remain explicit.

Official references: [sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
[inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
[limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

## Verification

`pnpm test` includes storage, version isolation, fabricated references, attachment budgets,
streaming, stop/retry, global-summary coverage, restart recovery and mocked HTTP transports for
all provider adapters, including paginated model discovery. `pnpm test:chat` runs credential
storage regressions, signed offline OAuth success/failure/cancellation cases, and Electron with
the real preload/viewer/local services. UI coverage includes duplicate submissions, model-catalog
recovery and login progress while settings are closed and reopened. It does not send real documents or consume
provider credits. Live account admission and answer quality still need validation with eligible
accounts and representative PDFs.

## Provider logos

Monochrome logos explicitly use black in light mode and white in dark mode instead of inheriting
muted control colors. OpenAI's [brand guidelines](https://openai.com/brand/) specify a monochrome
Blossom. Gemini uses the full-color [official favicon](https://www.gstatic.com/lamda/images/gemini_sparkle_4g_512_lt_f94943af3be039176192d.png),
bundled locally. OpenRouter's glyph comes from its [official brand assets](https://openrouter.ai/brand).

## Deferred work

- OCR for scanned PDFs.
- Selecting whole pages from sidebar previews.
- Explicit attachment of annotations and notes.
- Web verification with external sources.
- Chat export and cloud synchronization.
- Retrieval quality evaluation on multi-column, multilingual and scientific documents, including
  whether a semantic index adds enough value to justify its local model/runtime cost.
