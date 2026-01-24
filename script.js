const clockInBtn = document.getElementById('clock-in-btn');
const clockOutBtn = document.getElementById('clock-out-btn');
const timerDisplay = document.getElementById('timer');
const statusDisplay = document.getElementById('status');
const totalHoursDisplay = document.getElementById('total-hours');
const sessionCountDisplay = document.getElementById('session-count');
const historyList = document.getElementById('history-list');

let clockInTime = null;
let timerInterval = null;

const today = new Date().toDateString();
let sessions = JSON.parse(localStorage.getItem('clockin-sessions')) || {};

if (!sessions[today]) {
    sessions[today] = [];
}

// Check if there's an active session
const activeSession = localStorage.getItem('clockin-active');
if (activeSession) {
    clockInTime = new Date(activeSession);
    startTimer();
    updateButtonStates(true);
}

function startTimer() {
    statusDisplay.textContent = 'Clocked in since ' + formatTime(clockInTime);
    statusDisplay.classList.add('active');

    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();
}

function updateTimer() {
    if (!clockInTime) return;

    const elapsed = Date.now() - clockInTime.getTime();
    timerDisplay.textContent = formatDuration(elapsed);
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

function updateButtonStates(isClockedIn) {
    clockInBtn.disabled = isClockedIn;
    clockOutBtn.disabled = !isClockedIn;
}

function saveSessions() {
    localStorage.setItem('clockin-sessions', JSON.stringify(sessions));
}

function clockIn() {
    clockInTime = new Date();
    localStorage.setItem('clockin-active', clockInTime.toISOString());
    updateButtonStates(true);
    startTimer();
}

function clockOut() {
    if (!clockInTime) return;

    const clockOutTime = new Date();
    const duration = clockOutTime.getTime() - clockInTime.getTime();

    sessions[today].push({
        clockIn: clockInTime.toISOString(),
        clockOut: clockOutTime.toISOString(),
        duration: duration
    });

    saveSessions();
    localStorage.removeItem('clockin-active');

    clearInterval(timerInterval);
    timerInterval = null;
    clockInTime = null;

    timerDisplay.textContent = '00:00:00';
    statusDisplay.textContent = 'Not clocked in';
    statusDisplay.classList.remove('active');

    updateButtonStates(false);
    renderHistory();
    updateSummary();
}

function renderHistory() {
    historyList.innerHTML = '';

    const todaySessions = sessions[today] || [];

    if (todaySessions.length === 0) {
        historyList.innerHTML = '<li class="empty-history">No sessions recorded today</li>';
        return;
    }

    todaySessions.slice().reverse().forEach(session => {
        const li = document.createElement('li');
        li.className = 'history-item';

        const clockIn = new Date(session.clockIn);
        const clockOut = new Date(session.clockOut);

        li.innerHTML = `
            <span class="time-range">${formatTime(clockIn)} - ${formatTime(clockOut)}</span>
            <span class="duration">${formatHoursMinutes(session.duration)}</span>
        `;

        historyList.appendChild(li);
    });
}

function updateSummary() {
    const todaySessions = sessions[today] || [];
    const totalMs = todaySessions.reduce((sum, s) => sum + s.duration, 0);

    totalHoursDisplay.textContent = formatHoursMinutes(totalMs);
    sessionCountDisplay.textContent = todaySessions.length;
}

clockInBtn.addEventListener('click', clockIn);
clockOutBtn.addEventListener('click', clockOut);

renderHistory();
updateSummary();
