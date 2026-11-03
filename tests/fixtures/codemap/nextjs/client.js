async function test() {
  await fetch('/api/users/456');
  await fetch('/api/users/456', { method: 'POST' });
  await fetch('/api/unknown');
}
