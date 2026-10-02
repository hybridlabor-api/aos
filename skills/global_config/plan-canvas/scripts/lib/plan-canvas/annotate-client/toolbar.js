'use strict';

// Static markup only: nothing here is ever interpolated with page or user data.

const TOOLS = [
  ['element', 'V', 'Element'],
  ['text', 'T', 'Text'],
  ['rect', 'R', 'Area'],
  ['arrow', 'A', 'Arrow'],
  ['freehand', 'F', 'Freehand'],
  ['blur', 'B', 'Blur'],
  ['comment', 'C', 'Comment']
];
const COLORS = ['red', 'yellow', 'blue', 'green'];
const STROKES = [['2', 'Thin'], ['4', 'Medium'], ['7', 'Thick']];

function toolbarCss() {
  return `
:host{all:initial;--bg:#0a0a0a;--fg:#fff;--mut:#a1a1aa;--line:#2a2a30;--acc:#9b30c4;--acc-fg:#fff;--sh:0 8px 32px rgba(0,0,0,.55)}
@media (prefers-color-scheme:light){:host{--bg:#fff;--fg:#0a0a0a;--mut:#52525b;--line:#d4d4d8;--sh:0 8px 32px rgba(0,0,0,.18)}}
*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.hl{position:fixed;pointer-events:none;border:1.5px solid var(--acc);background:rgba(155,48,196,.12);border-radius:4px;display:none;z-index:2147483646;transition:all .06s ease-out}
svg.ov{position:absolute;left:0;top:0;overflow:visible;pointer-events:none;z-index:2147483645}
svg.ov.draw{pointer-events:auto;cursor:crosshair;touch-action:none}
button{font-size:12px;font-weight:600;line-height:1;cursor:pointer;color:var(--fg);background:transparent;border:1px solid var(--line);border-radius:6px;min-width:32px;min-height:32px;padding:6px 8px}
button:hover{border-color:var(--acc)}
button:focus-visible,textarea:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
button[aria-pressed=true],button.primary{background:var(--acc);border-color:var(--acc);color:var(--acc-fg)}
button:disabled{opacity:.4;cursor:default}
.bar{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:2147483647;display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:center;max-width:calc(100vw - 16px);background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:10px;padding:6px;box-shadow:var(--sh)}
.bar[hidden],.launch[hidden],.card[hidden],.mini[hidden]{display:none}
.grp{display:flex;gap:4px;align-items:center}
.sep{width:1px;align-self:stretch;background:var(--line)}
.sw{min-width:24px;min-height:24px;width:24px;height:24px;padding:0;border-radius:50%}
.sw[data-color=red]{background:#e5484d}.sw[data-color=yellow]{background:#f5c518}.sw[data-color=blue]{background:#3b82f6}.sw[data-color=green]{background:#30a46c}
.sw[aria-pressed=true]{outline:2px solid var(--fg);outline-offset:2px;border-color:transparent}
.launch{position:fixed;right:12px;bottom:12px;z-index:2147483647;background:var(--bg);box-shadow:var(--sh)}
.status{flex-basis:100%;text-align:center;font-size:11px;color:var(--mut);min-height:14px}
.selhint{position:absolute;display:none;z-index:2147483647;background:var(--bg);box-shadow:var(--sh)}
.card{position:absolute;z-index:2147483647;width:min(300px,calc(100vw - 16px));background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:8px;box-shadow:var(--sh)}
.card h4{margin:0;padding:10px 12px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--mut)}
.card .snippet{padding:4px 12px 0;font:10.5px 'SF Mono','Fira Code',monospace;color:var(--acc);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card textarea{display:block;width:calc(100% - 24px);margin:8px 12px;min-height:56px;resize:vertical;background:transparent;border:1px solid var(--line);border-radius:6px;color:var(--fg);font-size:16px;line-height:1.4;padding:7px 9px}
.card .row{display:flex;justify-content:flex-end;gap:8px;padding:0 12px 8px}
.card .keys{padding:0 12px 10px;font-size:10px;color:var(--mut)}
.mini{position:fixed;right:12px;bottom:64px;z-index:2147483647;width:min(280px,calc(100vw - 24px));background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:8px;box-shadow:var(--sh);padding:8px;font-size:12px}
.mini ul{list-style:none;margin:0 0 8px;padding:0;max-height:140px;overflow:auto}
.mini li{display:flex;gap:6px;align-items:center;padding:3px 0}
.mini li span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mini .msg{margin-top:6px;font-size:11px;color:var(--mut)}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;
}

function toolbarHtml() {
  const tool = ([id, key, label]) =>
    `<button type="button" data-tool="${id}" aria-pressed="false" aria-keyshortcuts="${key}" aria-label="${label} tool (${key})" title="${label} (${key})">${key}</button>`;
  const color = c =>
    `<button type="button" class="sw" data-color="${c}" aria-pressed="false" aria-label="Colour ${c}" title="${c}"></button>`;
  const stroke = ([w, label]) =>
    `<button type="button" data-stroke="${w}" aria-pressed="false" aria-label="${label} stroke" title="${label}">${w}</button>`;
  return `
<svg class="ov" aria-hidden="true"></svg>
<div class="hl"></div>
<button class="selhint" type="button">Annotate selection</button>
<button class="launch" type="button" aria-label="Annotate this page (Alt+Shift+A)" title="Annotate (Alt+Shift+A)" hidden>Annotate</button>
<div class="bar" role="toolbar" aria-label="Annotation tools" aria-orientation="horizontal" hidden>
  <div class="grp" role="group" aria-label="Tools">${TOOLS.map(tool).join('')}</div>
  <span class="sep"></span>
  <div class="grp" role="group" aria-label="Colour">${COLORS.map(color).join('')}</div>
  <div class="grp" role="group" aria-label="Stroke">${STROKES.map(stroke).join('')}</div>
  <span class="sep"></span>
  <div class="grp" role="group" aria-label="Edit">
    <button type="button" data-act="undo" aria-label="Undo (Ctrl or Cmd+Z)" title="Undo">&#8630;</button>
    <button type="button" data-act="redo" aria-label="Redo (Ctrl or Cmd+Shift+Z)" title="Redo">&#8631;</button>
    <button type="button" data-act="delete" aria-label="Delete drawing (Delete)" title="Delete">&#10005;</button>
    <button type="button" data-act="close" aria-label="Close annotation tools (Esc)" title="Close">Esc</button>
  </div>
  <div class="status" role="status" aria-live="polite"></div>
</div>
<div class="card" role="dialog" aria-label="Annotation note" hidden>
  <h4></h4>
  <div class="snippet"></div>
  <textarea aria-label="What should change here?" placeholder="What should change here?"></textarea>
  <div class="row">
    <button type="button" data-act="cancel">Cancel</button>
    <button type="button" data-act="queue" class="primary">Queue</button>
  </div>
  <div class="keys">Enter to queue &middot; Cmd/Ctrl+Enter to queue &amp; send &middot; Esc to cancel</div>
</div>
<div class="mini" role="region" aria-label="Queued annotations" hidden>
  <ul></ul>
  <button type="button" data-act="send" class="primary">Send</button>
  <div class="msg" role="status" aria-live="polite"></div>
</div>
`;
}

module.exports = { toolbarCss, toolbarHtml, TOOLS, COLORS, STROKES };
