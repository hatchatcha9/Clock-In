const { neon } = require('@netlify/neon');
const sql = neon();

async function checkEmployeeCodes() {
  const settings = await sql`
    SELECT us.user_id, u.username, us.employee_code, u.is_admin
    FROM user_settings us
    JOIN users u ON us.user_id = u.id
    ORDER BY us.user_id
  `;

  console.log('\n=== User Employee Codes ===\n');
  console.log('User ID | Username | Employee Code | Is Admin');
  console.log('--------|----------|---------------|----------');
  settings.forEach(s => {
    console.log(`${s.user_id} | ${s.username} | ${s.employee_code || 'NULL'} | ${s.is_admin}`);
  });
  console.log('');
}

checkEmployeeCodes().catch(console.error);
