// Self-contained HTML for the OAuth consent, continue and error pages. No external fonts,
// scripts, images or CDNs; the one <style> element is allowed by a per-response CSP nonce.
// Every interpolated value passes through escape(). Copy is Australian English.

export const escape = (value: string) => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function newNonce() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
}

/** Sets the HTML headers and a strict CSP. `formAction` is the full form-action source list. */
export function pageHeaders(headers: Headers, nonce: string, formAction = "'none'") {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'same-origin');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}'; form-action ${formAction}; base-uri 'none'; frame-ancestors 'none'`);
  return headers;
}

const css = `
:root{color-scheme:light dark;--ground:#f3f1e8;--surface:#fbfaf5;--ink:#20231f;--muted:#4b5441;--line:#dfe2d6;--control:#7d866f;--accent:#c4e86b;--accent-hover:#b3db52;--on-accent:#20231f;--focus:#20231f;--notice:#e5e8dd}
@media (prefers-color-scheme:dark){:root{--ground:#121411;--surface:#1c1f1a;--ink:#f3f1e8;--muted:#b9c1ad;--line:#2f342b;--control:#8a937c;--accent-hover:#d3f08a;--focus:#c4e86b;--notice:#262b22}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;min-height:100vh;min-height:100dvh;background:var(--ground);color:var(--ink);font:400 1rem/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:38rem;margin:0 auto;padding:1rem 1.25rem 3rem}
header{display:flex;align-items:center;gap:.5rem;min-height:2.75rem;font-size:1.0625rem;font-weight:600;letter-spacing:-.01em}
header svg{width:1.75rem;height:1.75rem;flex:none}
main{margin-top:1.75rem}
h1{margin:0 0 .75rem;font-size:1.75rem;line-height:1.15;font-weight:600;letter-spacing:-.02em;text-wrap:balance}
.lead{margin:0 0 2rem;font-size:1.0625rem;text-wrap:pretty}
.why{margin:-1rem 0 2rem;text-wrap:pretty}
.lead strong{font-weight:600;overflow-wrap:anywhere}
h2,legend{margin:0 0 .5rem;padding:0;font-size:1rem;font-weight:600}
fieldset{margin:0;padding:0;border:0;min-width:0}
section,fieldset{margin-bottom:1.5rem}
.panel{margin:0;padding:.25rem 1.25rem;list-style:none;background:var(--surface);border-radius:20px}
.item{padding:.75rem 0}
.item+.item{border-top:1px solid var(--line)}
.row{display:flex;align-items:center;gap:.75rem;min-height:2.75rem;padding-block:.125rem;font-weight:600}
label.row{cursor:pointer}
.row svg{width:1.5rem;height:1.5rem;flex:none}
.item p{margin:0 0 .25rem 2.25rem;color:var(--muted);font-size:.9375rem;text-wrap:pretty}
code{font:500 .8125rem/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--muted);white-space:nowrap}
.label{flex:1;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;column-gap:.75rem}
input[type=checkbox]{appearance:none;-webkit-appearance:none;flex:none;display:grid;place-content:center;width:1.5rem;height:1.5rem;margin:0;border:2px solid var(--control);border-radius:7px;background:var(--surface);cursor:pointer;transition:background-color .15s ease,border-color .15s ease}
input[type=checkbox]::after{content:"";width:.4rem;height:.75rem;border:solid var(--ground);border-width:0 2.5px 2.5px 0;transform:translateY(-.08rem) rotate(45deg) scale(0);transition:transform .15s ease}
input[type=checkbox]:checked{background:var(--ink);border-color:var(--ink)}
input[type=checkbox]:checked::after{transform:translateY(-.08rem) rotate(45deg) scale(1)}
.notice{margin:0 0 1.5rem;padding:.875rem 1rem;background:var(--notice);border-radius:14px;font-size:.9375rem}
.actions{display:flex;flex-direction:column;gap:.75rem;margin-top:2rem}
button,.button{display:inline-flex;align-items:center;justify-content:center;min-height:3rem;padding:.75rem 1.5rem;border:0;border-radius:999px;font:inherit;font-weight:600;text-decoration:none;cursor:pointer;transition:transform .12s ease,background-color .12s ease}
.primary{background:var(--accent);color:var(--on-accent)}
.primary:hover{background:var(--accent-hover)}
.secondary{background:transparent;color:var(--ink);border:1.5px solid var(--control)}
.secondary:hover{background:var(--surface)}
button:active,.button:active{transform:scale(.98)}
:focus-visible{outline:3px solid var(--focus);outline-offset:3px}
input[type=checkbox]:focus-visible{outline-offset:2px}
.note{margin:1.5rem 0 0;color:var(--muted);font-size:.875rem;text-wrap:pretty}
ol{margin:0;padding:.75rem 1.25rem .75rem 2.75rem;background:var(--surface);border-radius:20px}
ol li{padding:.25rem 0}
@media (min-width:36rem){.wrap{padding:2.5rem 2rem 4rem}h1{font-size:2rem}.actions{flex-direction:row}.actions .primary{min-width:12rem}}
@media (prefers-reduced-motion:reduce){*,*::after{transition:none!important}}
`.replace(/\n/g, '');

const mark = '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><g fill="none" stroke-width="2.4"><ellipse cx="16" cy="16" rx="13" ry="5.5" stroke="currentColor" transform="rotate(-30 16 16)"/><ellipse cx="16" cy="16" rx="13" ry="5.5" stroke="currentColor" transform="rotate(30 16 16)"/><ellipse cx="16" cy="16" rx="13" ry="5.5" stroke="#9cc63f" transform="rotate(90 16 16)"/></g></svg>';

export function shell(title: string, nonce: string, body: string, head = '') {
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="robots" content="noindex,nofollow"><title>${escape(title)}</title>${head}<style nonce="${escape(nonce)}">${css}</style></head><body><div class="wrap"><header>${mark}<span>LifeOS</span></header><main id="main">${body}</main></div></body></html>`;
}

/**
 * Interstitial after consent. It finishes the form POST with a 200 so Chromium does not apply
 * form-action to GitHub's redirect chain, then continues by itself with a meta refresh (a plain
 * navigation, not a form submission). The link stays as the fallback and is the first href.
 */
export function continuePage(href: string, nonce: string) {
  return shell('Continue LifeOS sign-in', nonce,
    `<h1>Continue to GitHub</h1><p class="lead">Your choices are saved. GitHub now confirms that this is the LifeOS owner's account.</p><div class="actions"><a class="button primary" href="${escape(href)}">Continue to GitHub</a></div><p class="note">This should open by itself. If it does not, use the button. The sign-in link works once and expires after 10 minutes.</p>`,
    `<meta http-equiv="refresh" content="0;url=${escape(href)}">`);
}

const explanations: Record<string, string> = {
  browser_session_missing: 'This browser has no record of starting this sign-in. That can happen if sign-in moved to another browser or app part way through, took longer than 10 minutes, or a page loaded twice and the first load used the one-time link.',
  browser_session_mismatch: 'This sign-in was started in a different browser session, so it cannot finish here.',
  session_expired_or_unavailable: 'This sign-in expired or was already used. Each sign-in link works once, for 10 minutes.',
  callback_state_missing: 'GitHub returned without the details needed to match this sign-in.',
  consent_handle_missing: 'The consent form arrived incomplete.',
};

/** Friendly failure page. Shows only the fixed stage and reason codes, never request data. */
export function errorPage(stage: string, reason: string, nonce: string) {
  const why = explanations[reason] ?? 'The connection request was incomplete or no longer matches the app that started it.';
  return shell('LifeOS sign-in did not finish', nonce,
    `<h1>Sign-in did not finish</h1><p class="lead">Nothing was connected and nothing changed.</p><p class="why">${escape(why)}</p><section aria-labelledby="again"><h2 id="again">Start again</h2><ol><li>Return to the app that sent you here.</li><li>Choose connect or reconnect for LifeOS.</li><li>Finish every step in the same browser window, within 10 minutes.</li></ol></section><p class="note">Reference: stage <code>${escape(stage)}</code>, reason <code>${escape(reason)}</code>.</p>`);
}

export type ConsentModel = {
  clientName: string; redirectHost: string; loopback: boolean; handle: string;
  /** The client asked for things:write itself; it is granted with read, no checkbox. */
  writeRequested: boolean;
  /** Writes are enabled but not requested; offered as a checkbox, ticked by default. */
  writeOffered: boolean;
  localRequested: boolean; notesRequested: boolean; notesWriteRequested: boolean;
  artifactsRequested?: boolean;
  /** The Oura binding is configured, so health:read can be offered. */
  healthOffered?: boolean;
  healthRequested?: boolean;
  /** The conflict policy sentence for queued edits. */
  policy: string;
};

const tick = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="11" fill="#c4e86b"/><path d="M7.2 12.4l3.1 3.1 6.5-6.6" fill="none" stroke="#20231f" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const included = (title: string, scope: string, text: string) =>
  `<li class="item"><div class="row">${tick}<span class="label"><span>${title}</span><code>${scope}</code></span></div><p>${text}</p></li>`;
const option = (id: string, name: string, title: string, scope: string, text: string, checked: boolean) =>
  `<div class="item"><label class="row" for="${id}"><input type="checkbox" id="${id}" name="${name}" value="allow" aria-describedby="${id}-text"${checked ? ' checked' : ''}><span class="label"><span>${title}</span><code>${scope}</code></span></label><p id="${id}-text">${text}</p></div>`;

const copy = {
  read: 'Tasks, projects, areas and tags, with their notes, as your Mac last synced them. This is a cached copy, not live Things.',
  offline: 'Access lasts an hour and renews by itself for up to 30 days, so you are not asked to sign in every session.',
  readOnly: 'Edits stay off for this connection.',
  write: (policy: string) => `Create, update, move, complete, cancel, trash and restore to-dos through the offline queue. Your Mac applies and confirms each change when it is awake. Trash stays recoverable. Current Mac limits: no checklist, evening or heading writes, restore to Inbox. ${policy}`,
  local: 'Calendar, saved brain dumps, Mac captures, planning, memory and proposal review, run on your awake Mac. With queued edits, one task you ask for is saved directly; other changes need an approved proposal. Raw captures stay on the Mac, but requests and results pass through this service and the app. Memory indexing uses a remote extraction service.',
  notes: 'Search and read notes in your LifeOS Anytype space. Notes stay in Anytype on the Mac and only pass through this service in memory. Needs local tools.',
  health: 'Read your Oura sleep, readiness, heart rate variability (HRV), activity, heart rate and workouts. Read only. Fetched live from Oura when the app asks. LifeOS does not store them, but the app you connect receives them.',
  notesWrite: 'Add new objects, tags, properties, collections and Things links, each marked Made by the assistant. Never deletes. Needs notes.',
};

/** The consent form. Field names and values match the POST /authorize handler exactly. */
export function consentPage(m: ConsentModel, nonce: string) {
  const always = [
    included('Read your Things mirror', 'things:read', copy.read + (m.writeRequested || m.writeOffered ? '' : ' ' + copy.readOnly)),
    included('Stay connected', 'offline_access', copy.offline),
    m.writeRequested ? included('Queued edits', 'things:write', escape(copy.write(m.policy))) : '',
    m.localRequested ? included('Local LifeOS tools', 'lifeos:local', copy.local) : '',
  ].join('');
  const optional = [
    m.writeOffered ? option('opt-writes', 'queued_writes', 'Queued edits', 'things:write', escape(copy.write(m.policy)) + ' Untick for read-only access.', true) : '',
    m.localRequested ? '' : option('opt-local', 'local_tools', 'Local LifeOS tools', 'lifeos:local', copy.local, false),
    option('opt-notes', 'notes', 'Anytype notes', 'notes', copy.notes, m.notesRequested),
    option('opt-notes-write', 'notes_write', 'Add and edit notes', 'notes:write', copy.notesWrite, m.notesWriteRequested),
    option('opt-artifacts', 'artifacts', 'Share documents', 'artifacts:write', 'Save document snapshots in Cloudflare and create or revoke read-only public links. Anyone holding a link can read and forward the document without signing in. Works while your Mac is asleep.', m.artifactsRequested??false),
    m.healthOffered ? option('opt-health', 'health', 'Oura health', 'health:read', copy.health, m.healthRequested??false) : '',
  ].join('');
  const hidden = `<input type="hidden" name="handle" value="${escape(m.handle)}">`
    + (m.writeRequested ? '<input type="hidden" name="queued_writes" value="allow">' : '')
    + (m.localRequested ? '<input type="hidden" name="local_tools" value="allow">' : '');
  return shell('Allow access to LifeOS', nonce,
    `<h1>Allow access to LifeOS?</h1>`
    + `<p class="lead"><strong>${escape(m.clientName)}</strong> wants to connect. Its access tokens go to <strong>${escape(m.redirectHost)}</strong>.</p>`
    + (m.loopback ? '<p class="notice">This is an app on your own computer. Check that you started this request before you allow it.</p>' : '')
    + `<form method="post" action="/authorize">${hidden}`
    + `<section aria-labelledby="always"><h2 id="always">Always included</h2><ul class="panel" role="list">${always}</ul></section>`
    + `<fieldset><legend>Optional</legend><div class="panel">${optional}</div></fieldset>`
    + '<div class="actions"><button class="primary" name="decision" value="allow">Allow with GitHub</button><button class="secondary" name="decision" value="deny">Deny</button></div>'
    + '</form><p class="note">Next, GitHub confirms your account. Only the LifeOS owner can finish signing in. This page expires after 10 minutes.</p>');
}
