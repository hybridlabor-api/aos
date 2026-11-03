async function test() {
  await fetch('/items/789');
  await fetch('/items', { method: 'POST' });
  await fetch('/other');
}
