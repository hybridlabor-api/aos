// usage: node ocmsg.mjs <oc-url> <dir> <sessionID> <needle>
// Prints JSON about the user message containing <needle>: its parts' synthetic flags and text.
const [url, dir, sid, needle] = process.argv.slice(2);
const r = await fetch(`${url}/session/${sid}/message?directory=${encodeURIComponent(dir)}`);
const msgs = await r.json();
const u = msgs.find((m) => m.info?.role === 'user' && (m.parts ?? []).some((p) => p.type === 'text' && p.text.includes(needle)));
console.log(JSON.stringify(u ? {
  found: true,
  allSynthetic: u.parts.length > 0 && u.parts.every((p) => p.synthetic === true),
  prefixOk: u.parts.some((p) => p.type === 'text' && /^\[aos-bus from [^\]]+\] /.test(p.text)),
  parts: u.parts.map((p) => ({ type: p.type, synthetic: p.synthetic, text: p.text })),
} : { found: false, count: msgs.length }));
