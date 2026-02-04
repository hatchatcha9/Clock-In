// ==================== AUTH STATE ====================
let isAuthenticated = false;
let currentUser = null;
let isAdmin = false;

// ==================== UTILITY FUNCTIONS ====================
// Escape HTML to prevent XSS attacks
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    const div = document.createElement('div');
    div.textContent = unsafe;
    return div.innerHTML;
}

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
    } else if (screenId === 'admin-screen') {
        renderAdminDashboard();
    } else if (screenId === 'messages-screen') {
        renderMessages();
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
        isAdmin = !!data.user.isAdmin;
        await initializeApp();
        updateAdminUI();
        navigateTo('home-screen');
    } catch (error) {
        isAuthenticated = false;
        currentUser = null;
        isAdmin = false;
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
        isAdmin = !!data.user.isAdmin;
        document.getElementById('login-form').reset();
        await initializeApp();
        updateAdminUI();
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
        const registerAsAdmin = document.getElementById('register-admin').checked;
        const data = registerAsAdmin
            ? await API.registerAdmin(username, email, password)
            : await API.register(username, email, password);
        currentUser = data.user;
        isAuthenticated = true;
        isAdmin = !!data.user.isAdmin;
        document.getElementById('register-form').reset();
        await initializeApp();
        updateAdminUI();
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

    // Reset admin state
    isAdmin = false;
    updateAdminUI();

    // Clear message badge interval
    if (messageBadgeInterval) {
        clearInterval(messageBadgeInterval);
        messageBadgeInterval = null;
    }
    const badge = document.getElementById('messages-badge');
    if (badge) badge.style.display = 'none';
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

// ==================== FORGOT PASSWORD ====================
function openForgotPasswordModal() {
    document.getElementById('forgot-email').value = '';
    document.getElementById('forgot-error').textContent = '';
    document.getElementById('forgot-success').style.display = 'none';
    document.getElementById('forgot-password-modal').classList.add('active');
}

function closeForgotPasswordModal() {
    document.getElementById('forgot-password-modal').classList.remove('active');
}

async function handleForgotPassword() {
    const email = document.getElementById('forgot-email').value.trim();
    const errorEl = document.getElementById('forgot-error');
    const successEl = document.getElementById('forgot-success');
    const sendBtn = document.getElementById('send-reset-btn');

    if (!email) {
        errorEl.textContent = 'Please enter your email address';
        return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        errorEl.textContent = 'Please enter a valid email address';
        return;
    }

    sendBtn.classList.add('loading');
    sendBtn.disabled = true;
    errorEl.textContent = '';
    successEl.style.display = 'none';

    try {
        const data = await API.forgotPassword(email);
        successEl.textContent = data.message;
        successEl.style.display = 'block';
        document.getElementById('forgot-email').value = '';

        // Close modal after 3 seconds
        setTimeout(() => {
            closeForgotPasswordModal();
        }, 3000);
    } catch (error) {
        errorEl.textContent = error.message || 'Failed to send reset email';
    } finally {
        sendBtn.classList.remove('loading');
        sendBtn.disabled = false;
    }
}

// Check if we're on the reset password page
function checkResetPasswordToken() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (token) {
        // Show reset password screen
        navigateTo('reset-password-screen');
    }
}

async function handleResetPassword(e) {
    e.preventDefault();
    const errorEl = document.getElementById('reset-error');
    const successEl = document.getElementById('reset-success');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    const password = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-new-password').value;

    if (!password || !confirmPassword) {
        errorEl.textContent = 'Please fill in all fields';
        return;
    }

    if (password !== confirmPassword) {
        errorEl.textContent = 'Passwords do not match';
        return;
    }

    if (password.length < 8) {
        errorEl.textContent = 'Password must be at least 8 characters';
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (!token) {
        errorEl.textContent = 'Invalid reset link';
        return;
    }

    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    errorEl.textContent = '';
    successEl.style.display = 'none';

    try {
        const data = await API.resetPassword(token, password);
        successEl.textContent = data.message;
        successEl.style.display = 'block';
        document.getElementById('reset-password-form').reset();

        // Redirect to login after 2 seconds
        setTimeout(() => {
            window.location.href = '/';
        }, 2000);
    } catch (error) {
        errorEl.textContent = error.message || 'Failed to reset password';
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

// Event listeners for forgot password
document.getElementById('show-forgot-password').addEventListener('click', openForgotPasswordModal);
document.getElementById('cancel-forgot-btn').addEventListener('click', closeForgotPasswordModal);
document.getElementById('send-reset-btn').addEventListener('click', handleForgotPassword);
document.getElementById('forgot-password-modal').addEventListener('click', (e) => {
    if (e.target.id === 'forgot-password-modal') {
        closeForgotPasswordModal();
    }
});

// Event listeners for reset password
document.getElementById('reset-password-form').addEventListener('submit', handleResetPassword);
document.getElementById('back-to-login').addEventListener('click', () => {
    window.location.href = '/';
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

    // Display employee code
    const codeEl = document.getElementById('employee-code');
    if (codeEl && settings.employeeCode) {
        codeEl.textContent = settings.employeeCode;
    }
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
            <span class="project-name">${escapeHtml(project.name)}</span>
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
                ${session.project_name ? `<span class="session-project">${escapeHtml(session.project_name)}</span>` : ''}
                ${session.notes ? `<span class="session-notes">${escapeHtml(session.notes)}</span>` : ''}
            </div>`;
        }

        const requestBtn = !isAdmin ? `<button class="btn request-change-history-btn" data-session-id="${session.id}" title="Request hour change">&hellip;</button>` : '';

        li.innerHTML = `
            ${infoHtml}
            <div class="history-item-actions">
                ${requestBtn}
                <span class="duration">${formatHoursMinutes(session.duration)}</span>
            </div>
        `;

        li.addEventListener('click', (e) => {
            if (e.target.classList.contains('request-change-history-btn')) {
                e.stopPropagation();
                openRequestModal(session.id);
                return;
            }
            openEditModal(session);
        });
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
                <span class="project-bar-label">${escapeHtml(project.name)}</span>
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

    // Update message badge
    updateMessageBadge();
    if (messageBadgeInterval) clearInterval(messageBadgeInterval);
    messageBadgeInterval = setInterval(updateMessageBadge, 2 * 60 * 1000);
}

// ==================== ADMIN FUNCTIONS ====================
function updateAdminUI() {
    const adminCard = document.getElementById('admin-nav-card');
    if (adminCard) {
        adminCard.style.display = isAdmin ? '' : 'none';
    }
}

let currentEmployeeId = null;

async function renderAdminDashboard() {
    const list = document.getElementById('employee-list');
    const errorEl = document.getElementById('admin-add-error');
    errorEl.textContent = '';

    try {
        const data = await API.getEmployees();
        renderEmployeeList(data.employees);
    } catch (error) {
        list.innerHTML = '<p class="empty-history">Failed to load employees</p>';
    }
}

function renderEmployeeList(employees) {
    const list = document.getElementById('employee-list');
    list.innerHTML = '';

    if (employees.length === 0) {
        list.innerHTML = '<p class="empty-history">No employees linked yet. Add one using their employee code.</p>';
        return;
    }

    employees.forEach(emp => {
        const card = document.createElement('div');
        card.className = 'employee-card';

        let statusHtml;
        if (emp.activeSession) {
            if (emp.activeSession.isOnBreak) {
                statusHtml = '<span class="emp-status-badge on-break">On Break</span>';
            } else {
                statusHtml = '<span class="emp-status-badge clocked-in">Clocked In</span>';
            }
            if (emp.activeSession.projectName) {
                statusHtml += `<span class="emp-project">${escapeHtml(emp.activeSession.projectName)}</span>`;
            }
        } else {
            statusHtml = '<span class="emp-status-badge clocked-out">Not Working</span>';
        }

        card.innerHTML = `
            <div class="employee-card-info">
                <span class="employee-card-name">${escapeHtml(emp.username)}</span>
                <span class="employee-card-email">${escapeHtml(emp.email)}</span>
            </div>
            <div class="employee-card-status">${statusHtml}</div>
        `;

        card.addEventListener('click', () => openEmployeeDetail(emp.id, emp.username));
        list.appendChild(card);
    });
}

async function addEmployee() {
    const input = document.getElementById('employee-code-input');
    const errorEl = document.getElementById('admin-add-error');
    const code = input.value.trim();

    if (!code) {
        errorEl.textContent = 'Please enter an employee code';
        return;
    }

    try {
        errorEl.textContent = '';
        await API.addEmployee(code);
        input.value = '';
        await renderAdminDashboard();
    } catch (error) {
        errorEl.textContent = error.message || 'Failed to add employee';
    }
}

async function removeEmployee() {
    if (!currentEmployeeId) return;
    if (!confirm('Are you sure you want to remove this employee?')) return;

    try {
        await API.removeEmployee(currentEmployeeId);
        currentEmployeeId = null;
        navigateTo('admin-screen');
    } catch (error) {
        alert('Failed to remove employee: ' + error.message);
    }
}

async function openEmployeeDetail(employeeId, username) {
    currentEmployeeId = employeeId;
    document.getElementById('employee-detail-name').textContent = username;

    // Navigate first, then load data
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('employee-detail-screen').classList.add('active');

    // Reset displays
    document.getElementById('emp-today-hours').textContent = '0:00';
    document.getElementById('emp-today-sessions').textContent = '0';
    document.getElementById('emp-today-earnings').textContent = '$0.00';
    document.getElementById('emp-weekly-hours').textContent = '0:00';
    document.getElementById('emp-weekly-sessions').textContent = '0';
    document.getElementById('emp-weekly-earnings').textContent = '$0.00';
    document.getElementById('emp-project-breakdown').innerHTML = '';
    document.getElementById('emp-session-history').innerHTML = '';

    // Load all data in parallel
    try {
        const [todayData, weeklyData, projectData, sessionData] = await Promise.all([
            API.getEmployeeTodayReport(employeeId),
            API.getEmployeeWeeklyReport(employeeId),
            API.getEmployeeProjectBreakdown(employeeId),
            API.getEmployeeSessions(employeeId)
        ]);

        // Today report
        document.getElementById('emp-today-hours').textContent = formatHoursMinutes(todayData.totalMs);
        document.getElementById('emp-today-sessions').textContent = todayData.sessionCount;
        document.getElementById('emp-today-earnings').textContent = formatMoney(todayData.earnings);

        // Weekly report
        document.getElementById('emp-weekly-hours').textContent = formatHoursMinutes(weeklyData.totalMs);
        document.getElementById('emp-weekly-sessions').textContent = weeklyData.sessionCount;
        document.getElementById('emp-weekly-earnings').textContent = formatMoney(weeklyData.earnings);

        // Project breakdown
        const projectChart = document.getElementById('emp-project-breakdown');
        const allProjects = [...projectData.projects];
        if (projectData.noProject.total_ms > 0) {
            allProjects.push({ name: 'No Project', total_ms: projectData.noProject.total_ms });
        }
        allProjects.sort((a, b) => b.total_ms - a.total_ms);
        const totalMs = allProjects.reduce((sum, p) => sum + p.total_ms, 0);

        if (totalMs === 0) {
            projectChart.innerHTML = '<p class="empty-history">No project data</p>';
        } else {
            allProjects.slice(0, 5).forEach(project => {
                const percentage = (project.total_ms / totalMs) * 100;
                const div = document.createElement('div');
                div.className = 'project-bar';
                div.innerHTML = `
                    <span class="project-bar-label">${escapeHtml(project.name)}</span>
                    <div class="project-bar-track">
                        <div class="project-bar-fill" style="width: ${percentage}%"></div>
                    </div>
                    <span class="project-bar-value">${formatHoursMinutes(project.total_ms)}</span>
                `;
                projectChart.appendChild(div);
            });
        }

        // Session history
        const historyEl = document.getElementById('emp-session-history');
        if (sessionData.sessions.length === 0) {
            historyEl.innerHTML = '<li class="empty-history">No sessions recorded yet</li>';
        } else {
            sessionData.sessions.slice(0, 30).forEach(session => {
                const li = document.createElement('li');
                li.className = 'history-item';

                const clockIn = new Date(session.clock_in);
                const clockOut = new Date(session.clock_out);
                const dateStr = clockIn.toLocaleDateString([], { month: 'short', day: 'numeric' });

                let infoHtml = `<span class="time-range">${dateStr} &middot; ${formatTime(clockIn)} - ${formatTime(clockOut)}</span>`;
                if (session.project_name || session.notes) {
                    infoHtml = `<div class="session-info">
                        <span class="time-range">${dateStr} &middot; ${formatTime(clockIn)} - ${formatTime(clockOut)}</span>
                        ${session.project_name ? `<span class="session-project">${escapeHtml(session.project_name)}</span>` : ''}
                        ${session.notes ? `<span class="session-notes">${escapeHtml(session.notes)}</span>` : ''}
                    </div>`;
                }

                li.innerHTML = `
                    ${infoHtml}
                    <span class="duration">${formatHoursMinutes(session.duration)}</span>
                `;
                historyEl.appendChild(li);
            });
        }
    } catch (error) {
        console.error('Failed to load employee detail:', error);
    }
}

// Admin event listeners
document.getElementById('add-employee-btn').addEventListener('click', addEmployee);
document.getElementById('employee-code-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addEmployee();
});
document.getElementById('remove-employee-btn').addEventListener('click', removeEmployee);

// ==================== MESSAGES / HOUR CHANGE REQUESTS ====================
let messagesCache = [];
let myAdmins = [];
let respondingToMessage = null;
let messageBadgeInterval = null;

async function renderMessages() {
    const list = document.getElementById('messages-list');
    const newRequestSection = document.getElementById('new-request-section');

    // Show new request button for non-admins only
    newRequestSection.style.display = isAdmin ? 'none' : 'block';

    list.innerHTML = '<p class="empty-history">Loading...</p>';

    try {
        const data = await API.getMessages();
        messagesCache = data.messages;

        if (messagesCache.length === 0) {
            list.innerHTML = '<p class="empty-history">No messages yet</p>';
            return;
        }

        // Group: top-level messages with their responses
        const topLevel = messagesCache.filter(m => !m.parent_id);
        const responses = messagesCache.filter(m => m.parent_id);

        list.innerHTML = '';

        topLevel.forEach(msg => {
            const card = document.createElement('div');
            card.className = `message-card message-${msg.status}`;

            const date = new Date(msg.created_at);
            const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            let sessionInfo = '';
            if (msg.session_clock_in && msg.session_clock_out) {
                const sessIn = new Date(msg.session_clock_in);
                const sessOut = new Date(msg.session_clock_out);
                sessionInfo = `<div class="message-session">
                    <span class="message-session-label">Original Session:</span>
                    ${sessIn.toLocaleDateString([], { month: 'short', day: 'numeric' })} &middot;
                    ${formatTime(sessIn)} - ${formatTime(sessOut)}
                    ${msg.project_name ? ` &middot; ${escapeHtml(msg.project_name)}` : ''}
                </div>`;
            }

            let requestedTimes = '';
            if (msg.requested_clock_in && msg.requested_clock_out) {
                const reqIn = new Date(msg.requested_clock_in);
                const reqOut = new Date(msg.requested_clock_out);
                requestedTimes = `<div class="message-requested">
                    <span class="message-session-label">Requested:</span>
                    ${reqIn.toLocaleDateString([], { month: 'short', day: 'numeric' })} &middot;
                    ${formatTime(reqIn)} - ${formatTime(reqOut)}
                </div>`;
            }

            const statusBadge = `<span class="message-status-badge status-${msg.status}">${msg.status}</span>`;

            const isMySentRequest = msg.sender_id === (currentUser && currentUser.id);
            const direction = isMySentRequest
                ? `To: ${escapeHtml(msg.recipient_name)}`
                : `From: ${escapeHtml(msg.sender_name)}`;

            let respondBtn = '';
            if (isAdmin && msg.recipient_id === currentUser.id && msg.status === 'pending') {
                respondBtn = `<button class="btn respond-btn" data-msg-id="${msg.id}">Respond</button>`;
            }

            // Find child responses
            const childResponses = responses.filter(r => r.parent_id === msg.id);
            let repliesHtml = '';
            if (childResponses.length > 0) {
                repliesHtml = '<div class="message-replies">';
                childResponses.forEach(reply => {
                    const replyDate = new Date(reply.created_at);
                    repliesHtml += `<div class="message-reply">
                        <div class="message-reply-header">
                            <span class="message-reply-from">${escapeHtml(reply.sender_name)}</span>
                            <span class="message-reply-date">${replyDate.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${replyDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        ${reply.message ? `<div class="message-reply-text">${escapeHtml(reply.message)}</div>` : ''}
                    </div>`;
                });
                repliesHtml += '</div>';
            }

            card.innerHTML = `
                <div class="message-header">
                    <span class="message-direction">${direction}</span>
                    <span class="message-date">${dateStr} ${timeStr}</span>
                </div>
                ${statusBadge}
                ${sessionInfo}
                ${requestedTimes}
                ${msg.message ? `<div class="message-text">${escapeHtml(msg.message)}</div>` : ''}
                ${repliesHtml}
                ${respondBtn}
            `;

            // Attach respond button handler
            list.appendChild(card);
            const btn = card.querySelector('.respond-btn');
            if (btn) {
                btn.addEventListener('click', () => openRespondModal(msg));
            }
        });
    } catch (error) {
        console.error('Failed to load messages:', error);
        list.innerHTML = '<p class="empty-history">Failed to load messages</p>';
    }
}

async function openRequestModal(preselectedSessionId) {
    const sessionSelect = document.getElementById('request-session');
    const adminSelect = document.getElementById('request-admin');
    const adminField = document.getElementById('request-admin-field');

    // Reset fields
    document.getElementById('request-clock-in').value = '';
    document.getElementById('request-clock-out').value = '';
    document.getElementById('request-message').value = '';

    // Load sessions
    try {
        const sessData = await API.getSessions({ limit: 50 });
        sessionSelect.innerHTML = '<option value="">Select a session</option>';
        sessData.sessions.forEach(s => {
            const d = new Date(s.clock_in);
            const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
            const inTime = formatTime(new Date(s.clock_in));
            const outTime = formatTime(new Date(s.clock_out));
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = `${dateStr} - ${inTime} to ${outTime}${s.project_name ? ' (' + s.project_name + ')' : ''}`;
            opt.dataset.clockIn = s.clock_in;
            opt.dataset.clockOut = s.clock_out;
            sessionSelect.appendChild(opt);
        });

        if (preselectedSessionId) {
            sessionSelect.value = preselectedSessionId;
            prefillRequestTimes();
        }
    } catch (error) {
        console.error('Failed to load sessions for request:', error);
    }

    // Load admins
    try {
        const adminData = await API.getMyAdmins();
        myAdmins = adminData.admins;
        if (myAdmins.length > 1) {
            adminField.style.display = 'block';
            adminSelect.innerHTML = '';
            myAdmins.forEach(a => {
                const opt = document.createElement('option');
                opt.value = a.id;
                opt.textContent = a.username;
                adminSelect.appendChild(opt);
            });
        } else {
            adminField.style.display = 'none';
        }
    } catch (error) {
        console.error('Failed to load admins:', error);
    }

    document.getElementById('request-modal').classList.add('active');
}

function prefillRequestTimes() {
    const sessionSelect = document.getElementById('request-session');
    const selected = sessionSelect.options[sessionSelect.selectedIndex];
    if (selected && selected.dataset.clockIn) {
        document.getElementById('request-clock-in').value = formatDateTimeLocal(new Date(selected.dataset.clockIn));
        document.getElementById('request-clock-out').value = formatDateTimeLocal(new Date(selected.dataset.clockOut));
    }
}

async function sendRequest() {
    const sessionId = document.getElementById('request-session').value;
    const requestedClockIn = document.getElementById('request-clock-in').value;
    const requestedClockOut = document.getElementById('request-clock-out').value;
    const message = document.getElementById('request-message').value.trim();
    const adminSelect = document.getElementById('request-admin');
    const recipientId = myAdmins.length > 1 ? adminSelect.value : (myAdmins.length === 1 ? myAdmins[0].id : null);

    if (!sessionId) {
        alert('Please select a session');
        return;
    }
    if (!requestedClockIn || !requestedClockOut) {
        alert('Please enter the requested clock in and clock out times');
        return;
    }
    if (new Date(requestedClockOut) <= new Date(requestedClockIn)) {
        alert('Clock out must be after clock in');
        return;
    }

    try {
        await API.sendHourChangeRequest({
            sessionId: parseInt(sessionId),
            requestedClockIn,
            requestedClockOut,
            message: message || null,
            recipientId: recipientId ? parseInt(recipientId) : null
        });

        document.getElementById('request-modal').classList.remove('active');
        renderMessages();
        updateMessageBadge();
    } catch (error) {
        alert('Failed to send request: ' + error.message);
    }
}

function openRespondModal(msg) {
    respondingToMessage = msg;
    const detail = document.getElementById('respond-detail');

    let sessionInfo = '';
    if (msg.session_clock_in && msg.session_clock_out) {
        const sessIn = new Date(msg.session_clock_in);
        const sessOut = new Date(msg.session_clock_out);
        sessionInfo = `<div class="respond-info"><strong>Original:</strong> ${sessIn.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${formatTime(sessIn)} - ${formatTime(sessOut)}</div>`;
    }

    let requestedInfo = '';
    if (msg.requested_clock_in && msg.requested_clock_out) {
        const reqIn = new Date(msg.requested_clock_in);
        const reqOut = new Date(msg.requested_clock_out);
        requestedInfo = `<div class="respond-info"><strong>Requested:</strong> ${reqIn.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${formatTime(reqIn)} - ${formatTime(reqOut)}</div>`;
    }

    detail.innerHTML = `
        <div class="respond-info"><strong>From:</strong> ${escapeHtml(msg.sender_name)}</div>
        ${sessionInfo}
        ${requestedInfo}
        ${msg.message ? `<div class="respond-info"><strong>Reason:</strong> ${escapeHtml(msg.message)}</div>` : ''}
    `;

    document.getElementById('respond-message').value = '';
    document.getElementById('respond-modal').classList.add('active');
}

async function respondToRequest(status) {
    if (!respondingToMessage) return;

    const message = document.getElementById('respond-message').value.trim();

    try {
        await API.respondToMessage(respondingToMessage.id, {
            status,
            message: message || null
        });

        document.getElementById('respond-modal').classList.remove('active');
        respondingToMessage = null;
        renderMessages();
        updateMessageBadge();
    } catch (error) {
        alert('Failed to respond: ' + error.message);
    }
}

async function updateMessageBadge() {
    try {
        const data = await API.getMessagesPendingCount();
        const badge = document.getElementById('messages-badge');
        if (data.count > 0) {
            badge.textContent = data.count;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    } catch (error) {
        // Silently fail for badge updates
    }
}

// Event listeners for messages
document.getElementById('new-request-btn').addEventListener('click', () => openRequestModal());
document.getElementById('request-session').addEventListener('change', prefillRequestTimes);
document.getElementById('send-request-btn').addEventListener('click', sendRequest);
document.getElementById('cancel-request-btn').addEventListener('click', () => {
    document.getElementById('request-modal').classList.remove('active');
});
document.getElementById('approve-btn').addEventListener('click', () => respondToRequest('approved'));
document.getElementById('deny-btn').addEventListener('click', () => respondToRequest('denied'));
document.getElementById('cancel-respond-btn').addEventListener('click', () => {
    document.getElementById('respond-modal').classList.remove('active');
    respondingToMessage = null;
});

// Close modals on overlay click
document.getElementById('request-modal').addEventListener('click', (e) => {
    if (e.target.id === 'request-modal') {
        document.getElementById('request-modal').classList.remove('active');
    }
});
document.getElementById('respond-modal').addEventListener('click', (e) => {
    if (e.target.id === 'respond-modal') {
        document.getElementById('respond-modal').classList.remove('active');
        respondingToMessage = null;
    }
});

// Check for reset password token first
checkResetPasswordToken();

// Start by checking authentication (if not on reset password page)
const urlParams = new URLSearchParams(window.location.search);
if (!urlParams.get('token')) {
    checkAuth();
}
