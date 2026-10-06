// WP1 stub. WP4 replaces this file with the store UI.
export function mount(view, api) {
  const p = document.createElement('p');
  p.className = 'note';
  p.textContent = 'Store arrives in a later release. This tab is a placeholder.';
  view.appendChild(p);
  return () => {};
}
