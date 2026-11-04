async function test() {
  await fetch('/api/users/456');
  await fetch('/api/users/456', { method: 'POST' });
  await fetch('/api/posts');
  await fetch('/api/unknown');
}
