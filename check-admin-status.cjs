const { neon } = require('@netlify/neon');
const sql = neon();

async function checkAdminStatus() {
  const users = await sql`
    SELECT id, username, email, is_admin
    FROM users
    ORDER BY id
  `;

  console.log('\n=== Current Users and Admin Status ===\n');
  console.log('ID | Username | Email | Is Admin');
  console.log('---|----------|-------|----------');
  users.forEach(user => {
    console.log(`${user.id} | ${user.username} | ${user.email} | ${user.is_admin}`);
  });
  console.log('');
}

checkAdminStatus().catch(console.error);
