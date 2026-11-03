const axios = require('axios');

async function test() {
  await fetch('/api/health');
  await axios.post('/api/users', { name: 'test' });
  await fetch('/api/users/123', { method: 'PUT' });
  await fetch('/api/v2/info');
  await axios.get('/api/missing');
}
