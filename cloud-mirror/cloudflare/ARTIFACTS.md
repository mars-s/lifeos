# Shared documents

LifeOS can save a document snapshot in D1 and serve a styled, read-only page from `/s/<random-token>`. The Mac can be asleep. Anyone holding the link can view and forward the document without an account. Invite labels are private management labels, not identity checks. LifeOS does not send invitations.

Saving and sharing are separate operations. A new snapshot has no public URL. Publishing requires the owner-authorised `artifacts:write` scope and an explicit user request to share that specific document. Existing OAuth grants do not gain that permission automatically.

## Bot workflow

After deploying this feature, refresh the existing LifeOS plugin's tools and reconnect it. Enable **document sharing (artifacts:write)** on the LifeOS consent page. Preserve whichever existing Things, local tools and notes permissions you use. There is no new OpenAI API key or second MCP connection.

The [official OpenAI custom MCP guide](https://developers.openai.com/api/docs/guides/custom-mcp-server) describes refreshing a connection's tools and instructions. These are standard MCP tools, usable by the bot through its existing LifeOS connection. A live Dot session has not yet been tested with this feature.

1. Call `create_artifact` with the actual document content. A local or sandbox file path is not an upload. Reuse the exact `request_id` and arguments after a timeout. New documents are private by default.
2. Call `read_artifact` to open the styled private preview inside ChatGPT. Opening it does not publish anything. The preview offers **Create share link** and **Revoke this link** actions. It uses the same Page stylesheet as public documents, within the authenticated MCP App. Sanitised markup is delivered in tool-result metadata, not through an anonymous private-document URL.
3. When asked to share it, call `share_artifact` with the returned `artifact_id`, or let the user press the preview's button. Its result contains the public URL and `share_id`.
4. For another recipient, call `share_artifact` with a new `request_id` and a private `label`. Each link is independently revocable. Whoever receives or forwards it can read it.
5. Call `revoke_artifact_share` with one `share_id` to disable future requests immediately. Revocation does not remove copies someone has saved. Revoking or expiring every active link returns the document to private status.

All tools return JSON under `structuredContent.result`, mirrored in their text output. Document reads and lists include `visibility` and `active_share_count`. Do not claim success when `isError` is true. A replay of a revoked or expired share returns `active: false` and `url: null`, never a replacement link.

```json
{
  "request_id": "research-note-v1",
  "title": "Research note",
  "summary": "The findings and the next questions.",
  "format": "markdown",
  "body": "## Findings\n\nThe actual report content.\n\n## Sources\n\n[Source](https://example.com)"
}
```

```json
{
  "request_id": "research-note-share-1",
  "artifact_id": "UUID returned by create_artifact",
  "label": "Shared with the team",
  "expires_at": null
}
```

`expires_at` can be a future ISO timestamp with an offset, such as `2027-01-01T00:00:00Z`. Null means no expiry. Title is limited to 200 characters, summary to 1,000, and body to 140,000 UTF-8 bytes. The existing MCP transport remains limited to 256 KiB including JSON. `list_artifacts` returns metadata for the latest 100 snapshots. `read_artifact` returns the private source. `list_artifact_shares` returns the latest 100 links for a document. These are owner-scoped and require the document permission.

Snapshots are immutable. To change a shared report, save a new snapshot, share it and revoke obsolete links. A `request_id` cannot be reused with different content or link settings. Parallel identical requests converge on the same document or URL through database uniqueness constraints.

## Styling and supported content

The source tokens and component CSS in `artifact-style.css` are adapted from the user-supplied `GrokBot-DESIGN.md` dated 31 October 2026. This is an extension for shared reports, not a redesign of the LifeOS Mac app or existing widgets.

The page uses a 748 px shell, 700 px reading column, system sans font, 30/24/20 px headings, 16/24 px body text, 12 px table and callout radii and 64 px spacing before main sections. Mobile uses 16 px side padding. System dark mode, keyboard focus, reduced motion and A4 print styles are included. Headings produce a contents list. Wide tables scroll within a labelled, keyboard-focusable wrapper.

Markdown supports headings, tables, lists, block quotes, fenced code and links. HTML input is a body fragment, not a standalone app. Supported component examples:

```html
<div class="callout info">
  <div class="callout-body">
    <p class="callout-title">What this means</p>
    <p class="callout-text">Explain the finding in plain language.</p>
  </div>
</div>

<p><span class="pill success">Complete</span></p>

<div class="accordion">
  <details>
    <summary>How was this calculated?</summary>
    <div class="panel">Describe the method here.</div>
  </details>
</div>
```

Scripts, custom CSS, inline event handlers, forms, SVG, images, iframes and embedded apps are removed. Readers do not load remote fonts, tracking images or third-party scripts. This version does not convert PDF or Word files, render interactive charts or provide collaborative editing.

[Marked](https://marked.js.org/) parses Markdown, then sanitize-html applies a tag and attribute allowlist to both Markdown output and HTML input. The response also uses a restrictive Content Security Policy with a hash for the fixed stylesheet and a sandbox. Document text is untrusted data, not tool instructions.

## Storage and access

Migration `../site/drizzle/0006_artifacts.sql` adds only the `artifacts` and `artifact_shares` tables and an index. The existing Things snapshot and native queues stay separate. Queries use [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/) with owner constraints.

Each share has 256 random bits in its URL. Links are bearer credentials. The database stores the document and share tokens so the authenticated owner can recover the same URL after a lost response. Do not log, publicly list or index them. Document routes use `no-store`, `no-referrer` and `noindex`; these are browser and crawler instructions, not access control. Access is controlled by the unguessable token plus live expiry and revocation checks. Missing, expired and revoked links use the same generic 404 page without document metadata.

## Preview and verification

Run from this directory:

```sh
npm run preview:artifacts
```

Open the printed loopback URL. It starts an ephemeral local Worker with a synthetic D1 document. It never loads credentials or production records. Ctrl-C disposes the Worker and removes its temporary bundle. The fixed preview token is local test data only.

```sh
npm run typecheck
npm run test:mcp
npm run test:native
npm test
npm run dry-run
```

The MCP suite exercises real local workerd/D1/KV and SDK requests with a synthetic OAuth upstream. It covers permission opt-in, old-grant denial, owner separation, private snapshots, public GET/HEAD, hostile HTML removal, independent links, immutable retries, expiry, revocation and size limits. Browser checks cover desktop and phone layout, table containment, contents navigation and expandable explanations. This does not establish production CPU usage or live Dot compatibility.

## Deployment status on 31 October 2026

The user identified the active source as `main` at `3f862b2`. The checkout was fast-forwarded to that commit, retaining all pre-existing pending edits in the working tree and a safety stash. Sharing was merged with the current offline Things operations and nonce-based consent page. Migration 0006 was applied successfully to the existing D1 database.

The initial public-link build was deployed from an isolated copy of `3f862b2` plus this feature, excluding the unrelated pending local batch work. Version `f2528c74-ac2b-4c97-b827-9ab7606f5f31` was published. A synthetic document was served publicly with no-store/no-referrer headers; expired and subsequently revoked links returned 404. The synthetic demo expires after seven days. No personal document was published. This admin-created fixture checks the public endpoint, not a live bot write.

The existing authenticated LifeOS connection still works and reports the new document capability, but its grant does not yet contain `artifacts:write`. Refresh/reconnect the existing plugin and enable **Share documents** before testing the bot's create/preview/share flow. Private preview mounting inside the actual ChatGPT host remains a separate verification step. The local preview fixture and three widget action tests check private opening, explicit Share/Revoke, stable retries after response loss and rejection of unexpected link hosts.

The private-preview release and uncertain-sharing fix were subsequently deployed as version `daffe23e-6782-47ec-9b96-d087bde38d8e`. All six Worker suites and four widget action tests passed. The latest deployment rechecked the public sample (200), revoked link (404) and expired link (404). The reviewer accepted the consent, merge and uncertain-sharing fixes at their stated scope. Actual ChatGPT private-preview mounting still needs the refreshed owner grant. The subsequent consent-origin fix publishes this sharing source alongside its regression tests; unrelated local task changes remain separate.
