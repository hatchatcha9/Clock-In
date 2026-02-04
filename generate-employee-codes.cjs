const { neon } = require('@netlify/neon');
const sql = neon();

function generateEmployeeCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function generateCodes() {
  // Get all non-admin users without employee codes
  const users = await sql`
    SELECT u.id, u.username, u.is_admin
    FROM users u
    JOIN user_settings us ON u.id = us.user_id
    WHERE u.is_admin = false AND us.employee_code IS NULL
  `;

  console.log(`\nFound ${users.length} non-admin user(s) without employee codes.\n`);

  for (const user of users) {
    const code = generateEmployeeCode();
    await sql`
      UPDATE user_settings
      SET employee_code = ${code}
      WHERE user_id = ${user.id}
    `;
    console.log(`Generated code for ${user.username}: ${code}`);
  }

  // Show all codes
  console.log('\n=== All Employee Codes ===\n');
  const allSettings = await sql`
    SELECT us.user_id, u.username, us.employee_code, u.is_admin
    FROM user_settings us
    JOIN users u ON us.user_id = u.id
    ORDER BY us.user_id
  `;

  console.log('User ID | Username | Employee Code | Is Admin');
  console.log('--------|----------|---------------|----------');
  allSettings.forEach(s => {
    console.log(`${s.user_id} | ${s.username} | ${s.employee_code || 'NULL'} | ${s.is_admin}`);
  });
  console.log('');
}

generateCodes().catch(console.error);
