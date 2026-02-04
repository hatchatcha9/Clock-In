import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

interface SessionData {
  clock_in: string;
  clock_out: string;
  duration: number;
  project_name: string | null;
  notes: string | null;
}

interface DailyReportData {
  username: string;
  date: string;
  sessions: SessionData[];
  totalMs: number;
  earnings: number;
  hourlyRate: number;
}

interface ProjectBreakdownItem {
  name: string;
  total_ms: number;
  session_count: number;
}

interface WeeklyReportData {
  username: string;
  weekStart: string;
  weekEnd: string;
  sessions: SessionData[];
  totalMs: number;
  earnings: number;
  hourlyRate: number;
  dailyStats: number[];
  projectBreakdown: ProjectBreakdownItem[];
}

export function generateDailyReportEmail(data: DailyReportData): string {
  const { username, date, sessions, totalMs, earnings } = data;

  const sessionsHtml = sessions
    .map(
      (session) => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">${formatTime(session.clock_in)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">${formatTime(session.clock_out)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">${formatDuration(session.duration)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">${session.project_name || 'No Project'}</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">${session.notes || '-'}</td>
    </tr>
  `
    )
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Georgia', serif; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
      <div style="background-color: #8B7355; padding: 30px; text-align: center;">
        <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: normal;">Daily Time Report</h1>
        <p style="margin: 10px 0 0; color: #D4C4B0; font-size: 16px;">${formatDate(date)}</p>
      </div>
      <div style="padding: 30px;">
        <p style="margin: 0 0 20px; color: #666; font-size: 16px;">
          Here's the time tracking summary for <strong>${username}</strong>:
        </p>
        <div style="display: flex; background-color: #FAF8F5; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
          <div style="flex: 1; text-align: center; border-right: 1px solid #E8E0D5;">
            <p style="margin: 0; color: #8B7355; font-size: 14px; text-transform: uppercase;">Total Time</p>
            <p style="margin: 5px 0 0; color: #333; font-size: 24px; font-weight: bold;">${formatDuration(totalMs)}</p>
          </div>
          <div style="flex: 1; text-align: center; border-right: 1px solid #E8E0D5;">
            <p style="margin: 0; color: #8B7355; font-size: 14px; text-transform: uppercase;">Sessions</p>
            <p style="margin: 5px 0 0; color: #333; font-size: 24px; font-weight: bold;">${sessions.length}</p>
          </div>
          <div style="flex: 1; text-align: center;">
            <p style="margin: 0; color: #8B7355; font-size: 14px; text-transform: uppercase;">Earnings</p>
            <p style="margin: 5px 0 0; color: #333; font-size: 24px; font-weight: bold;">${formatCurrency(earnings)}</p>
          </div>
        </div>
        ${
          sessions.length > 0
            ? `
        <h2 style="margin: 0 0 15px; color: #333; font-size: 18px; font-weight: normal;">Session Details</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background-color: #FAF8F5;">
              <th style="padding: 12px; text-align: left; color: #8B7355; font-weight: normal;">Clock In</th>
              <th style="padding: 12px; text-align: left; color: #8B7355; font-weight: normal;">Clock Out</th>
              <th style="padding: 12px; text-align: left; color: #8B7355; font-weight: normal;">Duration</th>
              <th style="padding: 12px; text-align: left; color: #8B7355; font-weight: normal;">Project</th>
              <th style="padding: 12px; text-align: left; color: #8B7355; font-weight: normal;">Notes</th>
            </tr>
          </thead>
          <tbody>
            ${sessionsHtml}
          </tbody>
        </table>
        `
            : '<p style="color: #666; font-style: italic;">No sessions recorded for this day.</p>'
        }
      </div>
      <div style="background-color: #FAF8F5; padding: 20px; text-align: center;">
        <p style="margin: 0; color: #999; font-size: 12px;">Sent from Clock In Time Tracker</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

export function generateWeeklyReportEmail(data: WeeklyReportData): string {
  const {
    username,
    weekStart,
    weekEnd,
    sessions,
    totalMs,
    earnings,
    dailyStats,
    projectBreakdown,
  } = data;

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const maxDailyMs = Math.max(...dailyStats, 1);

  const dailyBarsHtml = dailyStats
    .map((ms, i) => {
      const height = Math.max((ms / maxDailyMs) * 100, 5);
      const hasTime = ms > 0;
      return `
      <div style="flex: 1; text-align: center;">
        <div style="height: 100px; display: flex; flex-direction: column; justify-content: flex-end; align-items: center;">
          <div style="width: 30px; height: ${height}px; background-color: ${hasTime ? '#8B7355' : '#E8E0D5'}; border-radius: 4px 4px 0 0;"></div>
        </div>
        <p style="margin: 5px 0 0; color: #666; font-size: 12px;">${days[i]}</p>
        <p style="margin: 2px 0 0; color: #999; font-size: 10px;">${hasTime ? formatDuration(ms) : '-'}</p>
      </div>
    `;
    })
    .join('');

  const projectsHtml = projectBreakdown
    .map(
      (p) => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #eee;">${p.name}</td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">${formatDuration(p.total_ms)}</td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">${p.session_count} sessions</td>
    </tr>
  `
    )
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Georgia', serif; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
      <div style="background-color: #8B7355; padding: 30px; text-align: center;">
        <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: normal;">Weekly Time Report</h1>
        <p style="margin: 10px 0 0; color: #D4C4B0; font-size: 16px;">
          ${formatDate(weekStart)} - ${formatDate(weekEnd)}
        </p>
      </div>
      <div style="padding: 30px;">
        <p style="margin: 0 0 20px; color: #666; font-size: 16px;">
          Here's the weekly summary for <strong>${username}</strong>:
        </p>
        <table style="width: 100%; margin-bottom: 30px;">
          <tr>
            <td style="background-color: #FAF8F5; border-radius: 8px; padding: 20px; text-align: center; width: 33%;">
              <p style="margin: 0; color: #8B7355; font-size: 14px; text-transform: uppercase;">Total Time</p>
              <p style="margin: 5px 0 0; color: #333; font-size: 24px; font-weight: bold;">${formatDuration(totalMs)}</p>
            </td>
            <td style="width: 10px;"></td>
            <td style="background-color: #FAF8F5; border-radius: 8px; padding: 20px; text-align: center; width: 33%;">
              <p style="margin: 0; color: #8B7355; font-size: 14px; text-transform: uppercase;">Sessions</p>
              <p style="margin: 5px 0 0; color: #333; font-size: 24px; font-weight: bold;">${sessions.length}</p>
            </td>
            <td style="width: 10px;"></td>
            <td style="background-color: #FAF8F5; border-radius: 8px; padding: 20px; text-align: center; width: 33%;">
              <p style="margin: 0; color: #8B7355; font-size: 14px; text-transform: uppercase;">Earnings</p>
              <p style="margin: 5px 0 0; color: #333; font-size: 24px; font-weight: bold;">${formatCurrency(earnings)}</p>
            </td>
          </tr>
        </table>
        <h2 style="margin: 0 0 15px; color: #333; font-size: 18px; font-weight: normal;">Daily Breakdown</h2>
        <div style="display: flex; background-color: #FAF8F5; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
          ${dailyBarsHtml}
        </div>
        ${
          projectBreakdown.length > 0
            ? `
        <h2 style="margin: 0 0 15px; color: #333; font-size: 18px; font-weight: normal;">Time by Project</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background-color: #FAF8F5;">
              <th style="padding: 10px; text-align: left; color: #8B7355; font-weight: normal;">Project</th>
              <th style="padding: 10px; text-align: right; color: #8B7355; font-weight: normal;">Time</th>
              <th style="padding: 10px; text-align: right; color: #8B7355; font-weight: normal;">Sessions</th>
            </tr>
          </thead>
          <tbody>
            ${projectsHtml}
          </tbody>
        </table>
        `
            : ''
        }
      </div>
      <div style="background-color: #FAF8F5; padding: 20px; text-align: center;">
        <p style="margin: 0; color: #999; font-size: 12px;">Sent from Clock In Time Tracker</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error(
      'Email not configured. Set SMTP_USER and SMTP_PASS environment variables.'
    );
  }

  const mailOptions = {
    from: `"Clock In" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  };

  await transporter.sendMail(mailOptions);
}
