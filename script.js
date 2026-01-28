// ==================== AUTH STATE ====================
let isAuthenticated = false;
let currentUser = null;

// ==================== SCREEN NAVIGATION ====================
function navigateTo(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');

    if (screenId === 'reports-screen') {
        renderHistory();
        renderWeeklyReport();
        renderDailyReport();
        renderPastReports();
    } else if (screenId === 'dashboard-screen') {
        renderDashboard();
    } else if (screenId === 'settings-screen') {
        renderProjectsList();
        checkLocalDataForMigration();
    } else if (screenId === 'clockin-screen') {
        populateProjectSelectors();
    }
}

document.querySelectorAll('[data-screen]').forEach(btn => {
    btn.addEventListener('click', () => {
        if (!isAuthenticated && btn.dataset.screen !== 'auth-screen') {
            return navigateTo('auth-screen');
        }
        navigateTo(btn.dataset.screen);
    });
});

// ==================== AUTH FUNCTIONS ====================
async function checkAuth() {
    try {
        const data = await API.getMe();
        currentUser = data.user;
        isAuthenticated = true;
        await initializeApp();
        navigateTo('home-screen');
    } catch (error) {
        isAuthenticated = false;
        currentUser = null;
        navigateTo('auth-screen');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const errorEl = document.getElementById('login-error');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (!username || !password) {
        errorEl.textContent = 'Please fill in all fields';
        return;
    }

    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    errorEl.textContent = '';

    try {
        const data = await API.login(username, password);
        currentUser = data.user;
        isAuthenticated = true;
        document.getElementById('login-form').reset();
        await initializeApp();
        navigateTo('home-screen');
    } catch (error) {
        errorEl.textContent = error.message || 'Login failed';
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const errorEl = document.getElementById('register-error');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    const username = document.getElementById('register-username').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-confirm').value;

    if (!username || !email || !password || !confirm) {
        errorEl.textContent = 'Please fill in all fields';
        return;
    }

    if (password !== confirm) {
        errorEl.textContent = 'Passwords do not match';
        return;
    }

    if (password.length < 8) {
        errorEl.textContent = 'Password must be at least 8 characters';
        return;
    }

    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    errorEl.textContent = '';

    try {
        const data = await API.register(username, email, password);
        currentUser = data.user;
        isAuthenticated = true;
        document.getElementById('register-form').reset();
        await initializeApp();
        navigateTo('home-screen');
    } catch (error) {
        errorEl.textContent = error.message || 'Registration failed';
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

async function handleLogout() {
    try {
        await API.logout();
    } catch (error) {
        console.error('Logout error:', error);
    }

    isAuthenticated = false;
    currentUser = null;
    resetAppState();
    navigateTo('auth-screen');
}

function resetAppState() {
    // Reset timer state
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    clockInTime = null;
    isOnBreak = false;
    totalBreakTime = 0;
    activeSession = null;

    // Reset displays
    if (timerDisplay) timerDisplay.textContent = '00:00:00';
    if (statusDisplay) {
        statusDisplay.textContent = 'Not clocked in';
        statusDisplay.classList.remove('active');
    }
    document.getElementById('home-timer').textContent = '00:00:00';
    document.getElementById('home-timer-status').textContent = 'Not clocked in';
    document.getElementById('home-timer-status').classList.remove('active');

    updateButtonStates(false);

    // Clear projects
    projects = [];
    settings = { hourlyRate: 0, textSize: 'medium' };
}

// Auth form switching
document.getElementById('show-register').addEventListener('click', () => {
    document.getElementById('login-form').classList.remove('active');
    document.getElementById('register-form').classList.add('active');
    document.getElementById('login-error').textContent = '';
});

document.getElementById('show-login').addEventListener('click', () => {
    document.getElementById('register-form').classList.remove('active');
    document.getElementById('login-form').classList.add('active');
    document.getElementById('register-error').textContent = '';
});

document.getElementById('login-form').addEventListener('submit', handleLogin);
document.getElementById('register-form').addEventListener('submit', handleRegister);
document.getElementById('logout-btn').addEventListener('click', handleLogout);

// Listen for auth required events
window.addEventListener('auth:required', () => {
    isAuthenticated = false;
    currentUser = null;
    resetAppState();
    navigateTo('auth-screen');
});

// ==================== SETTINGS ====================
let settings = { hourlyRate: 0, textSize: 'medium' };
let projects = [];

async function loadSettings() {
    try {
        const data = await API.getSettings();
        settings = data.settings;
    } catch (error) {
        console.error('Failed to load settings:', error);
    }

    const hourlyRateInput = document.getElementById('hourly-rate');
    if (hourlyRateInput) hourlyRateInput.value = settings.hourlyRate;

    document.querySelectorAll('.size-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.size === settings.textSize) {
            btn.classList.add('active');
        }
    });

    applyTextSize(settings.textSize);
}

function applyTextSize(size) {
    document.body.classList.remove('text-small', 'text-medium', 'text-large');
    document.body.classList.add('text-' + size);
}

async function saveSettings() {
    const hourlyRateInput = document.getElementById('hourly-rate');
    const newHourlyRate = hourlyRateInput ? parseFloat(hourlyRateInput.value) || 0 : 0;

    try {
        const data = await API.updateSettings({
            hourlyRate: newHourlyRate,
            textSize: settings.textSize
        });
        settings = data.settings;
        updateSummary();
        alert('Settings saved!');
    } catch (error) {
        alert('Failed to save settings: ' + error.message);
    }
}

document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        settings.textSize = btn.dataset.size;
        applyTextSize(settings.textSize);
    });
});

document.getElementById('save-settings').addEventListener('click', saveSettings);

// ==================== PROJECTS ====================
async function loadProjects() {
    try {
        const data = await API.getProjects();
        projects = data.projects;
        populateProjectSelectors();
    } catch (error) {
        console.error('Failed to load projects:', error);
    }
}

async function addProject() {
    const input = document.getElementById('new-project-name');
    const name = input.value.trim();

    if (!name) return;

    try {
        await API.createProject(name);
        input.value = '';
        await loadProjects();
        renderProjectsList();
    } catch (error) {
        alert('Failed to add project: ' + error.message);
    }
}

async function deleteProject(id) {
    if (!confirm('Are you sure you want to delete this project?')) return;

    try {
        await API.deleteProject(id);
        await loadProjects();
        renderProjectsList();
    } catch (error) {
        alert('Failed to delete project: ' + error.message);
    }
}

function renderProjectsList() {
    const list = document.getElementById('projects-list');
    list.innerHTML = '';

    if (projects.length === 0) {
        list.innerHTML = '<p class="no-projects">No projects yet. Add one below.</p>';
        return;
    }

    projects.forEach(project => {
        const div = document.createElement('div');
        div.className = 'project-item';
        div.innerHTML = `
            <span class="project-name">${project.name}</span>
            <button class="delete-project-btn">&times;</button>
        `;
        div.querySelector('.delete-project-btn').addEventListener('click', () => deleteProject(project.id));
        list.appendChild(div);
    });
}

function populateProjectSelectors() {
    const selectors = [
        document.getElementById('current-project'),
        document.getElementById('edit-project')
    ];

    selectors.forEach(select => {
        if (!select) return;
        const currentValue = select.value;
        select.innerHTML = '<option value="">No Project</option>';
        projects.forEach(project => {
            const option = document.createElement('option');
            option.value = project.id;
            option.textContent = project.name;
            select.appendChild(option);
        });
        select.value = currentValue;
    });
}

const addProjectBtn = document.getElementById('add-project-btn');
const newProjectInput = document.getElementById('new-project-name');

if (addProjectBtn) addProjectBtn.addEventListener('click', addProject);
if (newProjectInput) newProjectInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addProject();
});

// ==================== CLOCK IN/OUT ====================
const clockInBtn = document.getElementById('clock-in-btn');
const clockOutBtn = document.getElementById('clock-out-btn');
const breakBtn = document.getElementById('break-btn');
const timerDisplay = document.getElementById('timer');
const statusDisplay = document.getElementById('status');
const breakIndicator = document.getElementById('break-indicator');
const totalHoursDisplay = document.getElementById('total-hours');
const sessionCountDisplay = document.getElementById('session-count');
const todayEarningsDisplay = document.getElementById('today-earnings');
const historyList = document.getElementById('history-list');

let clockInTime = null;
let timerInterval = null;
let isOnBreak = false;
let totalBreakTime = 0;
let activeSession = null;

async function loadActiveSession() {
    try {
        const data = await API.getActiveSession();
        activeSession = data.active;

        if (activeSession) {
            clockInTime = new Date(activeSession.clock_in);
            totalBreakTime = activeSession.break_time || 0;
            isOnBreak = !!activeSession.is_on_break;

            if (activeSession.project_id) {
                document.getElementById('current-project').value = activeSession.project_id;
            }

            startTimer();
            updateButtonStates(true);

            if (isOnBreak) {
                breakBtn.textContent = 'Resume';
                breakBtn.classList.add('on-break');
                breakIndicator.classList.remove('hidden');
                statusDisplay.textContent = 'On break';
            }
        } else {
            clockInTime = null;
            totalBreakTime = 0;
            isOnBreak = false;
            updateButtonStates(false);
        }
    } catch (error) {
        console.error('Failed to load active session:', error);
    }
}

function startTimer() {
    statusDisplay.textContent = 'Clocked in since ' + formatTime(clockInTime);
    statusDisplay.classList.add('active');

    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();
}

function updateTimer() {
    if (!clockInTime) {
        document.getElementById('home-timer').textContent = '00:00:00';
        document.getElementById('home-timer-status').textContent = 'Not clocked in';
        document.getElementById('home-timer-status').classList.remove('active');
        return;
    }

    let elapsed = Date.now() - clockInTime.getTime() - totalBreakTime;
    if (isOnBreak && activeSession && activeSession.break_start) {
        elapsed -= (Date.now() - new Date(activeSession.break_start).getTime());
    }
    const timeStr = formatDuration(Math.max(0, elapsed));
    timerDisplay.textContent = timeStr;

    // Update home timer too
    document.getElementById('home-timer').textContent = timeStr;
    document.getElementById('home-timer-status').textContent = isOnBreak ? 'On break' : 'Currently working';
    document.getElementById('home-timer-status').classList.add('active');
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / (1000 * 60)) % 60;
    const hours = Math.floor(ms / (1000 * 60 * 60));
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function formatHoursMinutes(ms) {
    const totalMinutes = Math.floor(ms / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}:${pad(minutes)}`;
}

function pad(num) {
    return num.toString().padStart(2, '0');
}

function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatMoney(amount) {
    return '$' + amount.toFixed(2);
}

function calculateEarnings(ms) {
    const hours = ms / (1000 * 60 * 60);
    return hours * settings.hourlyRate;
}

function updateButtonStates(isClockedIn) {
    if (clockInBtn) clockInBtn.disabled = isClockedIn;
    if (clockOutBtn) clockOutBtn.disabled = !isClockedIn;
    if (breakBtn) breakBtn.disabled = !isClockedIn;
}

async function clockIn() {
    const projectSelect = document.getElementById('current-project');
    const projectId = projectSelect ? projectSelect.value || null : null;

    try {
        const data = await API.clockIn(projectId);
        activeSession = data.active;
        clockInTime = new Date(activeSession.clock_in);
        totalBreakTime = 0;
        isOnBreak = false;

        updateButtonStates(true);
        startTimer();
    } catch (error) {
        alert('Failed to clock in: ' + error.message);
    }
}

async function toggleBreak() {
    try {
        const data = await API.toggleBreak();
        isOnBreak = data.isOnBreak;

        if (isOnBreak) {
            activeSession.break_start = data.breakStart;
            breakBtn.textContent = 'Resume';
            breakBtn.classList.add('on-break');
            breakIndicator.classList.remove('hidden');
            statusDisplay.textContent = 'On break';
        } else {
            totalBreakTime = data.breakTime;
            activeSession.break_start = null;
            activeSession.break_time = totalBreakTime;
            breakBtn.textContent = 'Break';
            breakBtn.classList.remove('on-break');
            breakIndicator.classList.add('hidden');
            statusDisplay.textContent = 'Clocked in since ' + formatTime(clockInTime);
        }
    } catch (error) {
        alert('Failed to toggle break: ' + error.message);
    }
}

function clockOut() {
    if (!clockInTime) return;

    // Show notes modal
    document.getElementById('clockout-notes').value = '';
    document.getElementById('clockout-modal').classList.add('active');
}

async function finishClockOut(withNotes) {
    const notes = withNotes ? document.getElementById('clockout-notes').value.trim() : null;

    try {
        await API.clockOut(notes);

        clearInterval(timerInterval);
        timerInterval = null;
        clockInTime = null;
        totalBreakTime = 0;
        isOnBreak = false;
        activeSession = null;

        timerDisplay.textContent = '00:00:00';
        statusDisplay.textContent = 'Not clocked in';
        statusDisplay.classList.remove('active');
        breakBtn.textContent = 'Break';
        breakBtn.classList.remove('on-break');
        breakIndicator.classList.add('hidden');

        // Reset home timer
        document.getElementById('home-timer').textContent = '00:00:00';
        document.getElementById('home-timer-status').textContent = 'Not clocked in';
        document.getElementById('home-timer-status').classList.remove('active');

        updateButtonStates(false);
        updateSummary();
        checkAndGenerateWeeklyReport();

        document.getElementById('clockout-modal').classList.remove('active');
    } catch (error) {
        alert('Failed to clock out: ' + error.message);
    }
}

document.getElementById('save-notes-btn').addEventListener('click', () => finishClockOut(true));
document.getElementById('skip-notes-btn').addEventListener('click', () => finishClockOut(false));

if (clockInBtn) clockInBtn.addEventListener('click', clockIn);
if (clockOutBtn) clockOutBtn.addEventListener('click', clockOut);
if (breakBtn) breakBtn.addEventListener('click', toggleBreak);

// ==================== HISTORY & EDITING ====================
let editingSession = null;
let sessionsCache = [];

async function loadSessions() {
    try {
        const data = await API.getSessions({ limit: 100 });
        sessionsCache = data.sessions;
    } catch (error) {
        console.error('Failed to load sessions:', error);
    }
}

function renderHistory() {
    historyList.innerHTML = '';

    if (sessionsCache.length === 0) {
        historyList.innerHTML = '<li class="empty-history">No sessions recorded yet</li>';
        return;
    }

    sessionsCache.slice(0, 30).forEach(session => {
        const li = document.createElement('li');
        li.className = 'history-item';

        const clockIn = new Date(session.clock_in);
        const clockOut = new Date(session.clock_out);
        const dateStr = clockIn.toLocaleDateString([], { month: 'short', day: 'numeric' });

        let infoHtml = `<span class="time-range">${dateStr} &middot; ${formatTime(clockIn)} - ${formatTime(clockOut)}</span>`;

        if (session.project_name || session.notes) {
            infoHtml = `<div class="session-info">
                <span class="time-range">${dateStr} &middot; ${formatTime(clockIn)} - ${formatTime(clockOut)}</span>
                ${session.project_name ? `<span class="session-project">${session.project_name}</span>` : ''}
                ${session.notes ? `<span class="session-notes">${session.notes}</span>` : ''}
            </div>`;
        }

        li.innerHTML = `
            ${infoHtml}
            <span class="duration">${formatHoursMinutes(session.duration)}</span>
        `;

        li.addEventListener('click', () => openEditModal(session));
        historyList.appendChild(li);
    });
}

function openEditModal(session) {
    editingSession = session;

    const clockIn = new Date(session.clock_in);
    const clockOut = new Date(session.clock_out);

    document.getElementById('edit-session-id').value = session.id;
    document.getElementById('edit-clock-in').value = formatDateTimeLocal(clockIn);
    document.getElementById('edit-clock-out').value = formatDateTimeLocal(clockOut);
    document.getElementById('edit-project').value = session.project_id || '';
    document.getElementById('edit-notes').value = session.notes || '';

    document.getElementById('edit-modal').classList.add('active');
}

function formatDateTimeLocal(date) {
    const offset = date.getTimezoneOffset();
    const local = new Date(date.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
}

async function saveEdit() {
    if (!editingSession) return;

    const clockIn = document.getElementById('edit-clock-in').value;
    const clockOut = document.getElementById('edit-clock-out').value;
    const projectId = document.getElementById('edit-project').value || null;
    const notes = document.getElementById('edit-notes').value.trim();

    if (new Date(clockOut) <= new Date(clockIn)) {
        alert('Clock out time must be after clock in time');
        return;
    }

    try {
        await API.updateSession(editingSession.id, {
            clockIn,
            clockOut,
            projectId,
            notes
        });

        await loadSessions();
        closeEditModal();
        renderHistory();
        updateSummary();
    } catch (error) {
        alert('Failed to update session: ' + error.message);
    }
}

async function deleteSession() {
    if (!editingSession) return;

    if (!confirm('Are you sure you want to delete this session?')) return;

    try {
        await API.deleteSession(editingSession.id);
        await loadSessions();
        closeEditModal();
        renderHistory();
        updateSummary();
    } catch (error) {
        alert('Failed to delete session: ' + error.message);
    }
}

function closeEditModal() {
    editingSession = null;
    document.getElementById('edit-modal').classList.remove('active');
}

document.getElementById('save-edit-btn').addEventListener('click', saveEdit);
document.getElementById('delete-session-btn').addEventListener('click', deleteSession);
document.getElementById('cancel-edit-btn').addEventListener('click', closeEditModal);

// ==================== SUMMARY ====================
async function updateSummary() {
    try {
        const data = await API.getTodayReport();

        if (totalHoursDisplay) totalHoursDisplay.textContent = formatHoursMinutes(data.totalMs);
        if (sessionCountDisplay) sessionCountDisplay.textContent = data.sessionCount;
        if (todayEarningsDisplay) todayEarningsDisplay.textContent = formatMoney(data.earnings);
    } catch (error) {
        console.error('Failed to update summary:', error);
    }
}

// ==================== WEEKLY REPORTS ====================
function formatDateRange(start, end) {
    const options = { month: 'short', day: 'numeric' };
    return `Week of ${start.toLocaleDateString([], options)} - ${end.toLocaleDateString([], options)}`;
}

async function renderWeeklyReport() {
    try {
        const data = await API.getWeeklyReport();

        const weekStart = new Date(data.weekStart);
        const weekEnd = new Date(data.weekEnd);

        document.getElementById('report-period').textContent = formatDateRange(weekStart, weekEnd);
        document.getElementById('weekly-hours').textContent = formatHoursMinutes(data.totalMs);
        document.getElementById('weekly-earnings').textContent = formatMoney(data.earnings);
        document.getElementById('weekly-sessions').textContent = data.sessionCount;
    } catch (error) {
        console.error('Failed to render weekly report:', error);
    }
}

async function checkAndGenerateWeeklyReport() {
    const now = new Date();
    if (now.getDay() === 0 && now.getHours() >= 12) {
        try {
            await API.generateWeeklyReport();
        } catch (error) {
            // Report might already exist, which is fine
        }
    }
}

async function renderPastReports() {
    const list = document.getElementById('past-reports-list');
    list.innerHTML = '';

    try {
        const data = await API.getPastWeeklyReports();

        if (data.reports.length === 0) {
            list.innerHTML = '<li class="empty-history">No weekly reports yet. Reports are generated on Sundays at 12 PM.</li>';
            return;
        }

        data.reports.forEach(report => {
            const li = document.createElement('li');
            li.className = 'report-item';

            const weekStart = new Date(report.week_start);
            const weekEnd = new Date(report.week_end);

            li.innerHTML = `
                <span class="report-date">${formatDateRange(weekStart, weekEnd)}</span>
                <div class="report-stats">
                    <div class="report-stat">
                        <div class="report-stat-label">Hours</div>
                        <div class="report-stat-value">${formatHoursMinutes(report.total_ms)}</div>
                    </div>
                    <div class="report-stat">
                        <div class="report-stat-label">Earned</div>
                        <div class="report-stat-value">${formatMoney(report.earnings)}</div>
                    </div>
                </div>
            `;

            list.appendChild(li);
        });
    } catch (error) {
        console.error('Failed to render past reports:', error);
    }
}

// ==================== DASHBOARD ====================
async function renderDashboard() {
    await renderWeeklyChart();
    await renderProjectChart();
    await renderMonthlyStats();
}

async function renderWeeklyChart() {
    try {
        const data = await API.getWeeklyReport();
        const dailyStats = data.dailyStats;

        let maxMs = Math.max(...dailyStats, 3600000); // At least 1 hour for scale

        document.querySelectorAll('.chart-bar').forEach(bar => {
            const day = parseInt(bar.dataset.day);
            const height = (dailyStats[day] / maxMs) * 150;
            bar.querySelector('.bar-fill').style.height = Math.max(2, height) + 'px';
        });
    } catch (error) {
        console.error('Failed to render weekly chart:', error);
    }
}

async function renderProjectChart() {
    const chart = document.getElementById('project-chart');
    chart.innerHTML = '';

    try {
        const data = await API.getProjectBreakdown();
        const allProjects = [...data.projects];

        // Add "No Project" if it has data
        if (data.noProject.total_ms > 0) {
            allProjects.push({
                name: 'No Project',
                total_ms: data.noProject.total_ms
            });
        }

        // Sort by total time
        allProjects.sort((a, b) => b.total_ms - a.total_ms);

        const totalMs = allProjects.reduce((sum, p) => sum + p.total_ms, 0);

        if (totalMs === 0) {
            chart.innerHTML = '<p class="empty-history">No data yet</p>';
            return;
        }

        allProjects.slice(0, 5).forEach(project => {
            const percentage = (project.total_ms / totalMs) * 100;
            const div = document.createElement('div');
            div.className = 'project-bar';
            div.innerHTML = `
                <span class="project-bar-label">${project.name}</span>
                <div class="project-bar-track">
                    <div class="project-bar-fill" style="width: ${percentage}%"></div>
                </div>
                <span class="project-bar-value">${formatHoursMinutes(project.total_ms)}</span>
            `;
            chart.appendChild(div);
        });
    } catch (error) {
        console.error('Failed to render project chart:', error);
        chart.innerHTML = '<p class="empty-history">Failed to load data</p>';
    }
}

async function renderMonthlyStats() {
    try {
        const data = await API.getMonthlyReport();

        document.getElementById('monthly-hours').textContent = formatHoursMinutes(data.totalMs);
        document.getElementById('monthly-earnings').textContent = formatMoney(data.earnings);
    } catch (error) {
        console.error('Failed to render monthly stats:', error);
    }
}

// ==================== DATA MIGRATION ====================
function hasLocalData() {
    return localStorage.getItem('clockin-sessions') ||
           localStorage.getItem('clockin-projects') ||
           localStorage.getItem('clockin-settings');
}

function checkLocalDataForMigration() {
    const migrationSection = document.getElementById('migration-section');
    if (hasLocalData()) {
        migrationSection.style.display = 'block';
    } else {
        migrationSection.style.display = 'none';
    }
}

async function importLocalData() {
    const btn = document.getElementById('import-data-btn');
    btn.classList.add('loading');
    btn.disabled = true;

    try {
        // Import projects first
        const localProjects = JSON.parse(localStorage.getItem('clockin-projects') || '[]');
        const projectMap = {}; // Map old names to new IDs

        for (const name of localProjects) {
            try {
                const data = await API.createProject(name);
                projectMap[name] = data.project.id;
            } catch (error) {
                // Project might already exist
                console.log('Project might exist:', name);
            }
        }

        // Reload projects to get all IDs
        await loadProjects();
        projects.forEach(p => {
            projectMap[p.name] = p.id;
        });

        // Import sessions
        const localSessions = JSON.parse(localStorage.getItem('clockin-sessions') || '{}');
        for (const dateStr of Object.keys(localSessions)) {
            for (const session of localSessions[dateStr]) {
                try {
                    await API.createSession({
                        clockIn: session.clockIn,
                        clockOut: session.clockOut,
                        projectId: session.project ? projectMap[session.project] : null,
                        notes: session.notes
                    });
                } catch (error) {
                    console.error('Failed to import session:', error);
                }
            }
        }

        // Import settings
        const localSettings = JSON.parse(localStorage.getItem('clockin-settings') || '{}');
        if (localSettings.hourlyRate || localSettings.textSize) {
            await API.updateSettings({
                hourlyRate: localSettings.hourlyRate || 0,
                textSize: localSettings.textSize || 'medium'
            });
            await loadSettings();
        }

        // Clear local data after successful import
        localStorage.removeItem('clockin-sessions');
        localStorage.removeItem('clockin-projects');
        localStorage.removeItem('clockin-settings');
        localStorage.removeItem('clockin-active');
        localStorage.removeItem('clockin-weekly-reports');

        // Reload data
        await loadSessions();
        await loadProjects();
        updateSummary();

        alert('Data imported successfully!');
        document.getElementById('migration-section').style.display = 'none';
    } catch (error) {
        alert('Failed to import data: ' + error.message);
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

document.getElementById('import-data-btn').addEventListener('click', importLocalData);

// ==================== DAILY REPORT ====================
async function renderDailyReport() {
    try {
        const data = await API.getTodayReport();

        document.getElementById('daily-hours').textContent = formatHoursMinutes(data.totalMs);
        document.getElementById('daily-earnings').textContent = formatMoney(data.earnings);
        document.getElementById('daily-sessions').textContent = data.sessionCount;
    } catch (error) {
        console.error('Failed to render daily report:', error);
    }
}

// ==================== SHARE FUNCTIONALITY ====================
let currentShareType = null;

function openShareModal(type) {
    currentShareType = type;
    const modal = document.getElementById('share-modal');
    const title = document.getElementById('share-modal-title');
    const status = document.getElementById('share-status');
    const emailInput = document.getElementById('share-email');

    title.textContent = type === 'weekly' ? 'Share Weekly Report' : 'Share Daily Report';
    status.textContent = '';
    status.className = 'share-status';
    emailInput.value = '';

    modal.classList.add('active');
    emailInput.focus();
}

function closeShareModal() {
    document.getElementById('share-modal').classList.remove('active');
    currentShareType = null;
}

async function sendShareEmail() {
    const email = document.getElementById('share-email').value.trim();
    const status = document.getElementById('share-status');
    const sendBtn = document.getElementById('send-share-btn');

    if (!email) {
        status.textContent = 'Please enter an email address';
        status.className = 'share-status error';
        return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        status.textContent = 'Please enter a valid email address';
        status.className = 'share-status error';
        return;
    }

    sendBtn.classList.add('loading');
    sendBtn.disabled = true;
    status.textContent = 'Sending...';
    status.className = 'share-status loading';

    try {
        if (currentShareType === 'weekly') {
            await API.shareWeeklyReport(email);
        } else {
            await API.shareDailyReport(email);
        }

        status.textContent = 'Report sent successfully!';
        status.className = 'share-status success';

        // Close modal after 2 seconds
        setTimeout(() => {
            closeShareModal();
        }, 2000);
    } catch (error) {
        status.textContent = error.message || 'Failed to send email';
        status.className = 'share-status error';
    } finally {
        sendBtn.classList.remove('loading');
        sendBtn.disabled = false;
    }
}

// Share button event listeners
document.getElementById('share-weekly-btn').addEventListener('click', () => openShareModal('weekly'));
document.getElementById('share-daily-btn').addEventListener('click', () => openShareModal('daily'));
document.getElementById('cancel-share-btn').addEventListener('click', closeShareModal);
document.getElementById('send-share-btn').addEventListener('click', sendShareEmail);

// Close modal on overlay click
document.getElementById('share-modal').addEventListener('click', (e) => {
    if (e.target.id === 'share-modal') {
        closeShareModal();
    }
});

// ==================== INITIALIZE ====================
async function initializeApp() {
    await loadSettings();
    await loadProjects();
    await loadActiveSession();
    await loadSessions();
    updateSummary();
    checkAndGenerateWeeklyReport();

    // Restore project if there's an active session
    if (activeSession && activeSession.project_id) {
        document.getElementById('current-project').value = activeSession.project_id;
    }

    // Initialize home timer display
    if (clockInTime) {
        updateTimer();
    } else {
        document.getElementById('home-timer').textContent = '00:00:00';
        document.getElementById('home-timer-status').textContent = 'Not clocked in';
    }
}

// Start by checking authentication
checkAuth();
