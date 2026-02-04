const { neon } = require('@netlify/neon');
const sql = neon();
sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`.then(r => console.log(r));
