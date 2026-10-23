# AI chat

Open a PDF and choose **AI chat**. The panel can be closed or resized; its width is saved. Below
1000 px, the PDF and chat alternate. Drafts and attachments survive this switch and panel closure.

Accept the app-wide data notice, then connect a service in **AI settings**. **Continue with
ChatGPT** opens the system browser and requests permission to use an eligible plan. It does not
import personal ChatGPT conversations. Availability is controlled by OpenAI and account/workspace
eligibility. API keys for OpenAI, Anthropic, Google Gemini and OpenRouter use separate provider
billing. The app never switches providers automatically. OpenRouter itself routes requests to its
upstream providers. A new provider or access method starts a new conversation; models within the
same provider can change inside a conversation.

New chat opens an unsaved draft. A conversation is persisted only when its first user message
is accepted, including attachment-only messages. Empty or rejected requests do not add history
entries. The placeholder title is not editable; the first message supplies the initial title.

Use **Edit message** below a user message to change its text. **Save & send** keeps its original
selections, removes all later messages and generates a new answer with the selected model. Cancel
leaves the conversation unchanged. Editing is available when the conversation is ready to send.

Use **Fork conversation** below a finished assistant response to open a separate saved chat with
all messages through that response, including sources, selections and work history. Later messages
stay in the original chat. Forks appear in conversation history with “(fork)” in their title and can
be continued, renamed or deleted independently. Message actions wait for an active response to finish.

## Selecting context

- Select text in the PDF, then choose **Attach text**. Selections spanning pages produce one
  attachment per page.
- Choose **Select region**, then drag a rectangle. The attachment contains a fresh rendering of
  the original PDF content, without annotations or editor overlays. Escape cancels selection.
- Collect multiple selections, inspect previews, remove attachments, or use **Explain**,
  **Summarize**, **Translate**, or **Formula / figure** to prepare a message. Actions do not send it.

Requests accept at most 12 selections, 6 MiB of selection images, 32,000 selection text characters
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
rendering proceed a page at a time, with progress and cancellation. Opening a PDF alone starts no
AI indexing or cloud request. Markdown, math and chat UI code are loaded when chat is first opened.

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

Each assistant message stores an ordered work timeline alongside the answer. One disclosure contains
tool calls and reasoning in their arrival order, including tools between reasoning
segments. It reads **Working for <time>** with a timer updated each second throughout the request, and finally
**Worked for <time>** with the elapsed request time saved by the main process. Durations use
seconds, minutes and hours as needed. It opens during the
request without a toggle and closes at completion. Only the finished timeline can be toggled;
its chevron sits directly beside the elapsed-time label. Tool details have their own
disclosures, initially closed even while running. Reasoning appears directly in the work timeline.
The app does not insert preparation, search or writing status sentences into the timeline.
Answers and reasoning share one Markdown renderer. The running timer updates only its label;
unchanged Markdown and tool records do not need to render again for each stream event.

OpenAI requests reasoning summaries on reasoning models; Anthropic, Gemini and OpenRouter use the
capabilities advertised by their model catalogs. Encrypted reasoning and signatures are not
displayed or saved. Only answer text and cited sources enter subsequent conversation context.

`read_document` reads passages from the local index; `search_document` runs the local full-text
search. Each invocation exposes its actual input, a result preview, and completion or error state.
These are application operations, not model-issued remote tool calls. Reasoning and tool records
are saved with the assistant message, including interrupted responses, and remain available in
conversation history.

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

## Deferred work

- OCR for scanned PDFs.
- Selecting whole pages from sidebar previews.
- Explicit attachment of annotations and notes.
- Web verification with external sources.
- Chat export and cloud synchronization.
- Retrieval quality evaluation on multi-column, multilingual and scientific documents, including
  whether a semantic index adds enough value to justify its local model/runtime cost.
