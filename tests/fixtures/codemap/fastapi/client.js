async function test() {
  await fetch('/items/789');
  await fetch('/items', { method: 'POST' });
  await fetch('/users/12', { method: 'POST' });
  await fetch('/info');
  await fetch('/other');
}
