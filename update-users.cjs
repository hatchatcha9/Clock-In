const { neon } = require('@netlify/neon');
const sql = neon();

async function updateUsers() {
  // Make user 5 an admin
  console.log('Setting user 5 (admin) as admin...');
  await sql`UPDATE users SET is_admin = true WHERE id = 5`;

  // Delete users 1, 3, 4, 6, 8
  console.log('Deleting users 1, 3, 4, 6, 8...');
  await sql`DELETE FROM users WHERE id IN (1, 3, 4, 6, 8)`;

  console.log('\nDone! Remaining users:');
  const users = await sql`SELECT id, username, email, is_admin FROM users ORDER BY id`;
  console.log('\nID | Username | Email | Is Admin');
  console.log('---|----------|-------|----------');
  users.forEach(user => {
    console.log(`${user.id} | ${user.username} | ${user.email} | ${user.is_admin}`);
  });
}

updateUsers().catch(console.error);
