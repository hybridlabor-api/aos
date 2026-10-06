// WP1 stub. WP2 replaces this file with the service table (the dashboard's
// status table structure moves here).
export function mount(view, api) {
  const p = document.createElement('p');
  p.className = 'note';
  p.textContent = 'Services arrive in a later release. This tab is a placeholder.';
  view.appendChild(p);
  return () => {};
}
