async function test() {
  await fetch('/api/health');
  await axios.post('/api/users', { name: 'test' });
  await fetch('/api/users/123', { method: 'PUT' });
  await fetch('/api/v2/info');
  await fetch('/api/file.name(with*special)');
  await fetch('/api/auth/details');
  await fetch('/api/settings/update', { method: 'PUT' });
  await fetch('/api/health', {
    method: 'GET',
    headers: {}
  });
  await axios.get('/api/missing');
}
