// The admin pages' only stylesheet and script, served by the Worker so the CSP can allow 'self' alone.

export const CSS = `
:root { color-scheme: light dark; --bg: #f6f5f2; --card: #fff; --ink: #1d1b18; --muted: #6b665e; --line: #e3dfd7; --accent: #8a3ffc; --danger: #c22; --ok-bg: #eaf6ec; --err-bg: #fdecec; }
@media (prefers-color-scheme: dark) { :root { --bg: #151412; --card: #1f1d1a; --ink: #eeebe5; --muted: #a29c92; --line: #34312c; --accent: #b98cff; --danger: #ff6b6b; --ok-bg: #1d2e21; --err-bg: #3a1f1f; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
.top { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.brand { font-weight: 700; color: var(--ink); text-decoration: none; }
main { max-width: 820px; margin: 0 auto; padding: 16px; }
h1 { font-size: 1.4rem; margin: 24px 0 12px; } h2 { font-size: 1.05rem; margin: 0 0 4px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
.narrow { max-width: 420px; margin: 32px auto; }
.narrow h1 { margin-top: 0; }
ul.feeds, ul.accounts, ul.picker { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
.feed { display: flex; gap: 16px; align-items: flex-start; }
.feed img, .art { width: 72px; height: 72px; border-radius: 8px; flex: none; object-fit: cover; background: var(--line); }
.feed-body { min-width: 0; flex: 1; }
.accounts .card { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center; }
label { display: block; margin: 0 0 12px; font-weight: 600; font-size: .9rem; }
label.check { display: flex; gap: 8px; align-items: center; font-weight: 400; font-size: 1rem; margin: 0; }
input[type=text], input[type=email], input[type=password] { display: block; width: 100%; margin-top: 4px; padding: 8px 10px; font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; }
button, .button { display: inline-block; padding: 7px 14px; font: inherit; font-size: .9rem; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; text-decoration: none; }
button.secondary, .button { background: transparent; color: var(--accent); }
button.danger { background: transparent; color: var(--danger); border-color: var(--danger); }
button.link, .button.link { border: none; background: none; color: var(--muted); padding: 7px 4px; }
.copy { display: flex; gap: 8px; margin: 8px 0; } .copy input { margin: 0; font-family: ui-monospace, monospace; font-size: .8rem; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; } .actions form { margin: 0; }
.muted { color: var(--muted); } .small { font-size: .85rem; }
.error { background: var(--err-bg); color: var(--danger); padding: 8px 10px; border-radius: 8px; margin: 8px 0; font-size: .9rem; overflow-wrap: anywhere; }
.notice { background: var(--ok-bg); padding: 8px 12px; border-radius: 8px; }
.badge { font-size: .75rem; padding: 1px 6px; border-radius: 6px; border: 1px solid var(--line); color: var(--muted); font-weight: 400; }
code { font-family: ui-monospace, monospace; font-size: .9em; }
@media (max-width: 520px) { .feed { flex-direction: column; } }
`;

export const JS = `
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1500); }
  catch { b.previousElementSibling?.select(); }
});
document.addEventListener("submit", (e) => {
  const msg = e.target.dataset.confirm;
  if (msg && !confirm(msg)) e.preventDefault();
});
for (const t of document.querySelectorAll("time[datetime]")) {
  const d = new Date(t.getAttribute("datetime"));
  t.textContent = d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
`;
