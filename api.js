// API Client for Clock In
const API = {
  baseUrl: '/api',

  // Helper for making requests
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const config = {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    };

    if (options.body && typeof options.body === 'object') {
      config.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, config);

    // Handle 401 - trigger auth check
    if (response.status === 401) {
      // Try to refresh token
      const refreshed = await this.refreshToken();
      if (refreshed) {
        // Retry original request
        return this.request(endpoint, options);
      }
      // Dispatch auth required event
      window.dispatchEvent(new CustomEvent('auth:required'));
      throw new Error('Authentication required');
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  },

  // ==================== AUTH ====================
  async register(username, email, password) {
    return this.request('/auth/register', {
      method: 'POST',
      body: { username, email, password }
    });
  },

  async login(username, password) {
    return this.request('/auth/login', {
      method: 'POST',
      body: { username, password }
    });
  },

  async logout() {
    return this.request('/auth/logout', { method: 'POST' });
  },

  async getMe() {
    return this.request('/auth/me');
  },

  async refreshToken() {
    try {
      await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include'
      });
      return true;
    } catch {
      return false;
    }
  },

  // ==================== SESSIONS ====================
  async getSessions(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/sessions${query ? '?' + query : ''}`);
  },

  async getActiveSession() {
    return this.request('/sessions/active');
  },

  async clockIn(projectId = null) {
    return this.request('/sessions/clock-in', {
      method: 'POST',
      body: { projectId }
    });
  },

  async clockOut(notes = null) {
    return this.request('/sessions/clock-out', {
      method: 'POST',
      body: { notes }
    });
  },

  async toggleBreak() {
    return this.request('/sessions/break', { method: 'POST' });
  },

  async createSession(data) {
    return this.request('/sessions', {
      method: 'POST',
      body: data
    });
  },

  async updateSession(id, data) {
    return this.request(`/sessions/${id}`, {
      method: 'PUT',
      body: data
    });
  },

  async deleteSession(id) {
    return this.request(`/sessions/${id}`, { method: 'DELETE' });
  },

  // ==================== PROJECTS ====================
  async getProjects() {
    return this.request('/projects');
  },

  async createProject(name) {
    return this.request('/projects', {
      method: 'POST',
      body: { name }
    });
  },

  async updateProject(id, name) {
    return this.request(`/projects/${id}`, {
      method: 'PUT',
      body: { name }
    });
  },

  async deleteProject(id) {
    return this.request(`/projects/${id}`, { method: 'DELETE' });
  },

  // ==================== SETTINGS ====================
  async getSettings() {
    return this.request('/settings');
  },

  async updateSettings(settings) {
    return this.request('/settings', {
      method: 'PUT',
      body: settings
    });
  },

  // ==================== REPORTS ====================
  async getTodayReport() {
    return this.request('/reports/today');
  },

  async getWeeklyReport(date = null) {
    const query = date ? `?date=${date}` : '';
    return this.request(`/reports/weekly${query}`);
  },

  async getMonthlyReport(date = null) {
    const query = date ? `?date=${date}` : '';
    return this.request(`/reports/monthly${query}`);
  },

  async getProjectBreakdown(start = null, end = null) {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const query = params.toString();
    return this.request(`/reports/projects${query ? '?' + query : ''}`);
  },

  async getPastWeeklyReports() {
    return this.request('/reports/past-weeks');
  },

  async generateWeeklyReport(date = null) {
    return this.request('/reports/generate-weekly', {
      method: 'POST',
      body: { date }
    });
  },

  // ==================== SHARE ====================
  async shareDailyReport(email, date = null) {
    return this.request('/share/daily', {
      method: 'POST',
      body: { email, date }
    });
  },

  async shareWeeklyReport(email, date = null) {
    return this.request('/share/weekly', {
      method: 'POST',
      body: { email, date }
    });
  }
};

// Make available globally
window.API = API;
