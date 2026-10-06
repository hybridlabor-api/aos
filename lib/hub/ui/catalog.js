// WP1 stub. WP3 replaces this file with the catalog search/filter UI.
export function mount(view, api) {
  const p = document.createElement('p');
  p.className = 'note';
  p.textContent = 'Catalog arrives in a later release. This tab is a placeholder.';
  view.appendChild(p);
  return () => {};
}
