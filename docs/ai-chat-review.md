# AI chat implementation review

Reviewed on 2026-10-17 after the macOS credential failure and missing return from browser login.

## Corrections

| Area               | Problem                                                                                          | Correction                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Credentials        | A Linux-only Electron API was called on macOS.                                                   | Check the backend only on Linux; reject unavailable protection on both read and write.                  |
| Persistence        | Failed saves could leave unsaved credentials visible in memory; callers mutated shared state.    | Serialize credential updates and publish a new snapshot only after the encrypted atomic write succeeds. |
| Registration       | A failed code exchange discarded the issued client registration.                                 | Save the issued client ID before exchanging the code.                                                   |
| Login cancellation | Cancelling after the callback could leave the token request running and the UI waiting.          | Abort the exchange and stop waiting for identity verification; always close the callback listener.      |
| Returning login    | Identity hints were omitted and a different subject could replace the selected account.          | Supply the retained identity hint and validate the returning subject.                                   |
| Permissions        | Identity-only sign-in was discarded.                                                             | Retain the validated identity, disable inference, and offer explicit plan authorization.                |
| Refresh            | A failed older refresh could erase a newer session.                                              | Bind refresh work and credential updates to the session's refresh token.                                |
| Stop               | An answer could keep waiting for a shared token refresh.                                         | Cancel that caller's wait without corrupting the shared rotating-token operation.                       |
| Login UI           | One waiting label concealed all login stages and disappeared when settings were reopened.        | Publish main-process progress through the preload bridge and retain it in the panel.                    |
| Logout UI          | A remote revocation failure could leave the interface displaying a locally disconnected account. | Reload connection status after failures as well as success.                                             |
| Model discovery    | Catalog failures had no direct retry; Anthropic discovery read only the first page.              | Add retry with a separate recoverable error state and use SDK pagination.                               |
| Submission         | Multiple submissions before initial conversation creation finished could create duplicate chats. | Acquire the submission guard synchronously.                                                             |
| Retrieval          | Neighbor passages could precede direct hits in the bounded context.                              | Place all ranked direct hits before neighbors and prioritize planned queries.                           |
| History            | Failed exchanges contributed orphan user messages to model context.                              | Include only completed user/assistant exchanges.                                                        |
| Citations          | Delayed navigation could scroll a hidden or inactive viewer.                                     | Check visibility and the active tab at navigation time.                                                 |

## Verification

- Node suite: storage, retrieval, version isolation, citations, request budgets, stop/retry,
  summary coverage, model discovery and SDK transport payloads.
- Electron credentials suite: actual platform API shape, serialized updates, failed writes,
  recovery and rejection of unprotected storage. Encryption functions use synthetic fixtures,
  so this does not test native Keychain permission dialogs.
- Electron authentication suite: signed synthetic identities, real HTTP loopback callbacks,
  registration recovery, cancellation, account mismatch, identity hints, declined permission,
  disk failure, refresh races, signature/nonce rejection, progress states and stop during refresh.
- Electron UI suite: real preload, viewer and local services; model-catalog failure/retry,
  progress across settings closure, duplicate submissions, selections, citations, delayed
  navigation after hiding the PDF, history, zoom/rotation, narrow layout and changed documents.
- PDF search and view-layout integration regressions.
- TypeScript checks for main/preload and renderer, ESLint, production build and whitespace check.

OAuth behavior was checked against the official
[registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[session](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
[error recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
and [request constraints](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
Public discovery and JWKS endpoints were also checked over the network without account credentials.

## Remaining live verification

The tests do not consume provider credits or access real account tokens. A complete browser login
and inference against an eligible account, native Keychain permissions, provider-specific admission
and answer quality on representative PDFs remain live checks. Local test success does not establish
those external conditions or guarantee the absence of every defect.
