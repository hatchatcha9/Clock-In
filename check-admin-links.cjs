const { neon } = require('@netlify/neon');
const sql = neon();

async function checkLinks() {
  const links = await sql`
    SELECT
      ae.id,
      ae.admin_id,
      admin_user.username as admin_name,
      ae.employee_id,
      employee_user.username as employee_name
    FROM admin_employees ae
    JOIN users admin_user ON ae.admin_id = admin_user.id
    JOIN users employee_user ON ae.employee_id = employee_user.id
    ORDER BY ae.id
  `;

  console.log('\n=== Admin-Employee Links ===\n');
  console.log('Link ID | Admin ID | Admin Name | Employee ID | Employee Name');
  console.log('--------|----------|------------|-------------|---------------');
  links.forEach(link => {
    console.log(`${link.id} | ${link.admin_id} | ${link.admin_name} | ${link.employee_id} | ${link.employee_name}`);
  });

  if (links.length === 0) {
    console.log('No links found!');
  }
  console.log('');
}

checkLinks().catch(console.error);
