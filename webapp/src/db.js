const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.logDir, { recursive: true });
fs.mkdirSync(config.outputDir, { recursive: true });

const db = new DatabaseSync(config.dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    meeting_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    stage TEXT,
    progress INTEGER DEFAULT 0,
    duration_sec REAL,
    file_name TEXT,
    file_size INTEGER,
    log_path TEXT,
    error_message TEXT,
    attempts INTEGER DEFAULT 0,
    notify_email TEXT,
    container_name TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
`);

function nowIso() {
    return new Date().toISOString();
}

function rowToJob(row) {
    if (!row) return null;
    return row;
}

const stmts = {
    insertJob: db.prepare(`INSERT INTO jobs
        (id, url, meeting_id, status, stage, progress, duration_sec, file_name, file_size,
         log_path, error_message, attempts, notify_email, container_name, created_at, started_at, finished_at, updated_at)
        VALUES (@id, @url, @meeting_id, @status, @stage, @progress, @duration_sec, @file_name, @file_size,
         @log_path, @error_message, @attempts, @notify_email, @container_name, @created_at, @started_at, @finished_at, @updated_at)`),
    getJob: db.prepare('SELECT * FROM jobs WHERE id = ?'),
    listJobs: db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 500'),
    listByStatus: db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at ASC'),
    deleteJob: db.prepare('DELETE FROM jobs WHERE id = ?'),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
};

function createJob({ id, url, meetingId, notifyEmail }) {
    const job = {
        id,
        url,
        meeting_id: meetingId || null,
        status: 'queued',
        stage: 'queued',
        progress: 0,
        duration_sec: null,
        file_name: null,
        file_size: null,
        log_path: null,
        error_message: null,
        attempts: 0,
        notify_email: notifyEmail || null,
        container_name: null,
        created_at: nowIso(),
        started_at: null,
        finished_at: null,
        updated_at: nowIso(),
    };
    stmts.insertJob.run(job);
    return getJob(id);
}

function getJob(id) {
    return rowToJob(stmts.getJob.get(id));
}

function listJobs() {
    return stmts.listJobs.all();
}

function listByStatus(status) {
    return stmts.listByStatus.all(status);
}

function updateJob(id, fields) {
    const keys = Object.keys(fields);
    if (keys.length === 0) return getJob(id);
    const assignments = keys.map(k => `${k} = @${k}`).join(', ');
    const stmt = db.prepare(`UPDATE jobs SET ${assignments}, updated_at = @updated_at WHERE id = @id`);
    stmt.run(Object.assign({}, fields, { id, updated_at: nowIso() }));
    return getJob(id);
}

function deleteJob(id) {
    stmts.deleteJob.run(id);
}

function getSetting(key, def) {
    const row = stmts.getSetting.get(key);
    return row ? row.value : def;
}

function setSetting(key, value) {
    stmts.setSetting.run(key, String(value));
}

module.exports = {
    db,
    nowIso,
    createJob,
    getJob,
    listJobs,
    listByStatus,
    updateJob,
    deleteJob,
    getSetting,
    setSetting,
};
