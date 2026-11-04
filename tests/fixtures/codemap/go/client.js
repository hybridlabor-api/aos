async function test() {
  await fetch('/api/go/users');
  await fetch('/api/go/users/999');
  await fetch('/api/v2/items/123');
  await fetch('/api/v2/items', { method: 'POST' });
  await fetch('/api/go/unknown');
}
