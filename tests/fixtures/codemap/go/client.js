async function test() {
  await fetch('/api/go/users');
  await fetch('/api/go/users/999');
  await fetch('/api/go/unknown');
}
