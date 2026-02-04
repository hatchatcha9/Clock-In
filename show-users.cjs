const { neon } = require('@netlify/neon');
const sql = neon();
sql`SELECT id, username, email, is_admin, created_at FROM users ORDER BY id`.then(users => {
  console.log('\n=== All Users ===\n');
  console.log('ID | Username | Email | Is Admin | Created At');
  console.log('---|----------|-------|----------|------------');
  users.forEach(user => {
    console.log(`${user.id} | ${user.username} | ${user.email} | ${user.is_admin || false} | ${user.created_at}`);
  });
  console.log('');
});
