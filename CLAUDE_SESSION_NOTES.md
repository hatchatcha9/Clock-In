# Clock In Project - Development Session Notes

## Project Overview
Time tracking application with admin/employee management features, built with Netlify Functions, Neon PostgreSQL database, and Drizzle ORM.

## Recent Changes (Feb 2, 2026)

### 1. Admin Registration Feature
**Problem:** Admin registration wasn't working - clicking "Register as Administrator" resulted in "Not found" error.

**Solution:**
- Added `isAdmin` boolean field to `users` table in database schema
- Created `handleRegisterAdmin` function in `netlify/functions/auth.ts`
- Added route handler for `/auth/register-admin` endpoint
- Generated and ran database migration

**Files Modified:**
- `db/schema.ts` - Added `isAdmin: boolean('is_admin').default(false)` to users table
- `netlify/functions/auth.ts` - Added `handleRegisterAdmin` function and route

### 2. Employee Code Generation
**Problem:** Employee codes weren't being generated for users.

**Solution:**
- Added `employeeCode` field (8-char unique varchar) to `user_settings` table
- Created `admin_employees` join table to track admin-employee relationships
- Added automatic employee code generation for non-admin users during registration
- Updated settings endpoint to return employee code
- Generated migration and backfilled codes for existing users

**Files Modified:**
- `db/schema.ts` - Added `employeeCode` field and `adminEmployees` table
- `netlify/functions/auth.ts` - Added `generateEmployeeCode()` function, modified registration to include codes
- `netlify/functions/settings.ts` - Modified to return `employeeCode` in response

**Database Changes:**
- Migration 0002: Added `employee_code` column and `admin_employees` table

### 3. Admin Dashboard Functionality
**Problem:** Admin page wasn't showing for existing users, and employee management endpoints didn't exist.

**Solution:**
- Updated auth endpoints (`/auth/login`, `/auth/me`, `/auth/register`) to return `isAdmin` field
- Created complete admin API at `netlify/functions/admin.ts` with endpoints:
  - `GET /admin/employees` - List linked employees
  - `POST /admin/employees/add` - Add employee by code
  - `DELETE /admin/employees/:id` - Remove employee
  - `GET /admin/employees/:id/sessions` - View employee sessions
  - `GET /admin/employees/:id/active` - View active session
  - `GET /admin/employees/:id/reports/today` - Today's report
  - `GET /admin/employees/:id/reports/weekly` - Weekly report
  - `GET /admin/employees/:id/reports/projects` - Project breakdown
- Created `netlify/functions/messages.ts` for employees to view their linked admins
- Added routing rules to `netlify.toml` for `/api/admin/*` and `/api/messages/*`

**Files Created:**
- `netlify/functions/admin.ts` - Complete admin functionality
- `netlify/functions/messages.ts` - Employee-admin relationship viewing

**Files Modified:**
- `netlify/functions/auth.ts` - Updated to return `isAdmin` in all responses
- `netlify.toml` - Added admin and messages route redirects

### 4. Database Cleanup
**Problem:** Multiple test accounts cluttering the database.

**Actions Taken:**
- Kept only 3 users:
  - User 2: `romanlee9` (hatchatcha9@gmail.com) - Employee with code `13T7NSR3`
  - User 5: `admin` (claudetest@gmail.com) - Admin
  - User 7: `admintest2` (add@gmail.com) - Admin
- Set user 5 as admin
- Deleted users 1, 3, 4, 6, 8

## Current Database Schema

### users table
- `id` (serial, primary key)
- `username` (varchar, unique)
- `email` (varchar, unique)
- `password_hash` (text)
- `is_admin` (boolean, default false) ← NEW
- `created_at` (timestamp)
- `updated_at` (timestamp)

### user_settings table
- `user_id` (integer, primary key, FK to users)
- `hourly_rate` (real, default 0)
- `text_size` (varchar, default 'medium')
- `employee_code` (varchar(8), unique) ← NEW
- `created_at` (timestamp)
- `updated_at` (timestamp)

### admin_employees table ← NEW
- `id` (serial, primary key)
- `admin_id` (integer, FK to users)
- `employee_id` (integer, FK to users)
- `created_at` (timestamp)
- Unique constraint on (admin_id, employee_id)

## API Endpoints Added

### Admin Endpoints (require admin authentication)
- `POST /api/admin/employees/add` - Add employee by code (body: `{ code: string }`)
- `GET /api/admin/employees` - List all linked employees
- `DELETE /api/admin/employees/:id` - Remove employee
- `GET /api/admin/employees/:id/sessions` - Get employee sessions
- `GET /api/admin/employees/:id/active` - Get employee active session
- `GET /api/admin/employees/:id/reports/today` - Get today's report
- `GET /api/admin/employees/:id/reports/weekly` - Get weekly report
- `GET /api/admin/employees/:id/reports/projects` - Get project breakdown

### Messages Endpoints
- `GET /api/messages/admins` - Get list of admins linked to current employee

## Testing Instructions

### Test Admin Registration
1. Go to http://localhost:8888
2. Click register
3. Check "Register as Administrator"
4. Fill in credentials and submit
5. Should successfully create admin account

### Test Employee Code
1. Register as regular user (don't check admin box)
2. Log in and go to Settings
3. Should see 8-character employee code displayed

### Test Admin-Employee Linking
1. Log in as admin (user: `admin` or `admintest2`)
2. Navigate to Admin dashboard
3. Enter employee code: `13T7NSR3`
4. Click "Add Employee"
5. Should successfully link employee and show in list

## Development Commands

```bash
# Start local dev server
netlify dev
# Runs on http://localhost:8888

# Generate database migration
npm run db:generate

# Apply database migrations
npm run db:migrate

# Open Drizzle Studio
npm run db:studio
```

## Utility Scripts Created

Located in project root:
- `show-users.cjs` - Display all users with admin status
- `check-employee-codes.cjs` - Show employee codes for all users
- `generate-employee-codes.cjs` - Generate codes for existing users without them
- `update-users.cjs` - Bulk update users (used for cleanup)

Run with: `netlify dev:exec "node script-name.cjs"`

## Known Issues / Todo
- [ ] Employee code should regenerate if compromised
- [ ] Add admin interface to view/manage all employees
- [ ] Add employee permissions/roles system
- [ ] Add notification when admin links an employee

## Server Info
- Local dev server: http://localhost:8888
- Database: Neon PostgreSQL (connected via NETLIFY_DATABASE_URL env var)
- Auth: JWT tokens stored in httpOnly cookies
