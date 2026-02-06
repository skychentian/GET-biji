#!/usr/bin/env node

/**
 * Get Notes Sync Dashboard
 * 
 * Visualization and control panel for Get Notes Sync.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');

const PORT = process.env.PORT || 3456;
const BASE_DIR = __dirname;
// State files are stored in parent or same dir relative to script execution
const SYNC_STATE_FILE = path.join(BASE_DIR, '../.sync-state.json');
const TOKEN_CACHE_FILE = path.join(BASE_DIR, '../.token-cache.json');
const LOG_FILE = path.join(BASE_DIR, '../sync.log');
const ACTIVITY_LOG_FILE = path.join(BASE_DIR, '../.activity-log.json');

// Helper to check file existence in multiple locations
function findFile(filename) {
    if (fs.existsSync(filename)) return filename;
    const parentPath = path.join(BASE_DIR, '..', path.basename(filename));
    if (fs.existsSync(parentPath)) return parentPath;
    return filename;
}

// Log activity
function logActivity(type, message, details = null) {
    let logs = [];
    const logFile = ACTIVITY_LOG_FILE;
    if (fs.existsSync(logFile)) {
        try {
            logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
        } catch (e) { }
    }

    logs.unshift({
        time: new Date().toISOString(),
        type,
        message,
        details
    });

    logs = logs.slice(0, 100);
    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2), 'utf8');
}

function getStatus() {
    const status = {
        lastSync: null,
        syncedCount: 0,
        tokenValid: false,
        tokenExpireAt: null,
        activityLogs: []
    };

    const syncFile = findFile(SYNC_STATE_FILE);
    if (fs.existsSync(syncFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(syncFile, 'utf8'));
            status.lastSync = data.lastSyncTime;
            status.syncedCount = data.syncedIds?.length || 0;
        } catch (e) { }
    }

    const tokenFile = findFile(TOKEN_CACHE_FILE);
    if (fs.existsSync(tokenFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
            status.tokenExpireAt = data.tokenExpireAt;
            status.tokenValid = data.tokenExpireAt && (Date.now() / 1000) < data.tokenExpireAt;
        } catch (e) { }
    }

    const actFile = findFile(ACTIVITY_LOG_FILE);
    if (fs.existsSync(actFile)) {
        try {
            status.activityLogs = JSON.parse(fs.readFileSync(actFile, 'utf8')).slice(0, 20);
        } catch (e) { }
    }

    return status;
}

function sendNotification(title, message) {
    if (process.platform === 'darwin') {
        const script = `display notification "${message}" with title "${title}"`;
        exec(`osascript -e '${script}'`);
    }
}

function formatTime(isoString) {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} mins ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;

    return date.toLocaleString();
}

function getHTML(status) {
    const lastSyncTime = formatTime(status.lastSync);
    const tokenStatus = status.tokenValid ? 'Logged In' : 'Login Required';
    const tokenClass = status.tokenValid ? 'success' : 'warning';

    let logsHTML = '';
    if (status.activityLogs.length === 0) {
        logsHTML = '<div class="empty-state">No activity logs. Click "Sync Now" to start.</div>';
    } else {
        status.activityLogs.forEach(log => {
            const icon = log.type === 'sync' ? '🔄' : log.type === 'success' ? '✅' : log.type === 'error' ? '❌' : log.type === 'login' ? '🔐' : '📝';
            const time = formatTime(log.time);
            logsHTML += `
        <div class="log-item">
          <span class="log-icon">${icon}</span>
          <div class="log-content">
            <div class="log-message">${log.message}</div>
            ${log.details ? `<div class="log-details">${log.details}</div>` : ''}
          </div>
          <span class="log-time">${time}</span>
        </div>
      `;
        });
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Get Notes Sync</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg-primary: #ffffff;
      --bg-secondary: #f7f6f3;
      --bg-hover: #efefef;
      --text-primary: #37352f;
      --text-secondary: #6b6b6b;
      --text-tertiary: #9b9a97;
      --border: #e9e9e7;
      --accent: #2eaadc;
      --success: #0f7b6c;
      --warning: #d9730d;
      --error: #e03e3e;
    }
    body {
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif;
      background: var(--bg-secondary);
      color: var(--text-primary);
      line-height: 1.5;
      min-height: 100vh;
    }
    .container { max-width: 720px; margin: 0 auto; padding: 60px 40px; }
    .header { margin-bottom: 32px; }
    .header h1 { font-size: 32px; font-weight: 700; display: flex; align-items: center; gap: 12px; }
    .header p { margin-top: 8px; color: var(--text-secondary); font-size: 14px; }
    .card { background: var(--bg-primary); border-radius: 8px; border: 1px solid var(--border); margin-bottom: 16px; overflow: hidden; }
    .card-header { padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); }
    .stat { padding: 20px 16px; text-align: center; border-right: 1px solid var(--border); }
    .stat:last-child { border-right: none; }
    .stat-value { font-size: 24px; font-weight: 600; }
    .stat-label { font-size: 12px; color: var(--text-tertiary); margin-top: 4px; }
    .actions { display: flex; gap: 8px; padding: 16px; }
    button { flex: 1; padding: 10px 16px; border: none; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .btn-primary { background: var(--accent); color: white; }
    .btn-secondary { background: var(--bg-secondary); border: 1px solid var(--border); }
    .btn-warning { background: var(--warning); color: white; }
    #syncStatus { padding: 12px 16px; background: var(--bg-secondary); border-top: 1px solid var(--border); font-size: 14px; color: var(--text-secondary); display: none; }
    .log-item { display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
    .log-message { font-size: 14px; }
    .log-details, .log-time { font-size: 12px; color: var(--text-tertiary); }
    .logs-container { max-height: 400px; overflow-y: auto; }
    .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 500; }
    .status-badge.success { background: rgba(15, 123, 108, 0.1); color: var(--success); }
    .status-badge.warning { background: rgba(217, 115, 13, 0.1); color: var(--warning); }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1><span>📝</span> Get Notes Sync</h1>
      <p>Automatic sync dashboard</p>
    </div>
    
    <div class="card">
      <div class="stats">
        <div class="stat">
          <div class="stat-value">${status.syncedCount}</div>
          <div class="stat-label">Synced Notes</div>
        </div>
        <div class="stat">
          <div class="stat-value" style="font-size: 16px;">${lastSyncTime}</div>
          <div class="stat-label">Last Sync</div>
        </div>
        <div class="stat">
          <div class="stat-value">
            <span class="status-badge ${tokenClass}">
              <span class="status-dot"></span>
              ${tokenStatus}
            </span>
          </div>
          <div class="stat-label">Status</div>
        </div>
      </div>
      <div class="actions">
        <button class="btn-primary" onclick="syncNow()" id="syncBtn"><span>🔄</span> Sync Now</button>
        <button class="btn-warning" onclick="reLogin()" id="loginBtn"><span>🔐</span> Re-Login</button>
        <button class="btn-secondary" onclick="location.reload()"><span>↻</span> Refresh</button>
      </div>
      <div id="syncStatus"></div>
    </div>
     <div class="card">
      <div class="card-header">Activity Log</div>
      <div class="logs-container">${logsHTML}</div>
    </div>
  </div>
  <script>
    function syncNow() {
      const statusEl = document.getElementById('syncStatus');
      const btn = document.getElementById('syncBtn');
      statusEl.innerHTML = 'Running sync...';
      statusEl.style.display = 'block';
      btn.disabled = true;
      fetch('/api/sync', { method: 'POST' }).then(r=>r.json()).then(d=>{
        statusEl.innerHTML = (d.success ? '✅ ' : '❌ ') + d.message;
        if(d.success) setTimeout(()=>location.reload(), 1500);
        else btn.disabled = false;
      }).catch(e=>{ statusEl.innerHTML='❌ Error: '+e.message; btn.disabled=false; });
    }
    function reLogin() {
      const statusEl = document.getElementById('syncStatus');
      const btn = document.getElementById('loginBtn');
      statusEl.innerHTML = 'Launching login window...';
      statusEl.style.display = 'block';
      btn.disabled = true;
      fetch('/api/login', { method: 'POST' }).then(r=>r.json()).then(d=>{
        statusEl.innerHTML = (d.success ? '✅ ' : '❌ ') + d.message;
        if(d.success) setTimeout(()=>location.reload(), 1500);
        else btn.disabled = false;
      }).catch(e=>{ statusEl.innerHTML='❌ Error: '+e.message; btn.disabled=false; });
    }
  </script>
</body>
</html>`;
}

function parseSyncOutput(output) {
    const synced = [];
    let totalNew = 0;
    let totalSuccess = 0;
    output.split('\n').forEach(line => {
        const saveMatch = line.match(/\[Saved\]\s+(.+\.md)/);
        if (saveMatch) { synced.push(saveMatch[1]); totalSuccess++; }
        const newMatch = line.match(/New notes to sync:\s*(\d+)/);
        if (newMatch) { totalNew = parseInt(newMatch[1]); }
    });
    return { synced, totalNew, totalSuccess };
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getStatus()));
        return;
    }

    if (url.pathname === '/api/sync' && req.method === 'POST') {
        logActivity('sync', 'Starting manual sync...');
        const child = spawn('node', ['sync.js'], { cwd: BASE_DIR });
        let output = '';
        child.stdout.on('data', d => output += d);
        child.stderr.on('data', d => output += d);
        child.on('close', code => {
            if (code === 0) {
                const result = parseSyncOutput(output);
                if (result.totalNew === 0) {
                    logActivity('success', 'Sync complete (no new notes)');
                    res.end(JSON.stringify({ success: true, message: 'Sync complete (no new notes)' }));
                } else {
                    logActivity('success', `Synced ${result.totalSuccess} notes`, result.synced.slice(0, 5).join(', '));
                    res.end(JSON.stringify({ success: true, message: `Synced ${result.totalSuccess} notes!` }));
                }
            } else {
                if (output.includes('LoginRequired') || output.includes('Token expired')) {
                    logActivity('error', 'Sync failed: Login required');
                    sendNotification('Get Notes Sync', 'Login expired, please re-login');
                    res.end(JSON.stringify({ success: false, message: 'Login expired, click Re-Login' }));
                } else {
                    logActivity('error', 'Sync failed', output.slice(-200));
                    res.end(JSON.stringify({ success: false, message: 'Sync failed, check console logs' }));
                }
            }
        });
        return;
    }

    if (url.pathname === '/api/login' && req.method === 'POST') {
        logActivity('login', 'Re-login initiated...');
        const child = spawn('node', ['sync.js'], { cwd: BASE_DIR }); // sync.js prompts login if needed
        let output = '';
        child.stdout.on('data', d => output += d);
        child.stderr.on('data', d => output += d);
        child.on('close', code => {
            if (code === 0) {
                logActivity('success', 'Login successful');
                res.end(JSON.stringify({ success: true, message: 'Login successful' }));
            } else {
                logActivity('error', 'Login failed');
                res.end(JSON.stringify({ success: false, message: 'Login failed' }));
            }
        });
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getHTML(getStatus()));
});

server.listen(PORT, () => {
    console.log(`Research dashboard running at http://localhost:${PORT}`);
    exec(`open http://localhost:${PORT}`);
});
