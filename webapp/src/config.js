const path = require('path');
require('dotenv').config();

function bool(v, def) {
    if (v === undefined || v === null || v === '') return def;
    return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

module.exports = {
    port: parseInt(process.env.PORT || '8080', 10),
    baseUrl: process.env.BASE_URL || '',

    dataDir: DATA_DIR,
    logDir: path.resolve(process.env.LOG_DIR || path.join(DATA_DIR, 'logs')),
    outputDir: path.resolve(process.env.OUTPUT_DIR || path.join(DATA_DIR, 'output')),
    dbPath: path.resolve(process.env.DB_PATH || path.join(DATA_DIR, 'bbb-mp4.db')),
    // When this service itself runs inside Docker and talks to the host's
    // Docker daemon via a mounted socket ("docker-outside-of-docker"), any
    // `-v host:container` bind mount it requests is resolved by the HOST
    // daemon against the HOST filesystem — not against paths inside this
    // container. HOST_OUTPUT_DIR must therefore be the *host* path that is
    // bind-mounted into this container at OUTPUT_DIR (see docker-compose.yml).
    // For WORKER_MODE=local, or when running this app directly on the host
    // without Docker, it is simply the same as outputDir.
    hostOutputDir: process.env.HOST_OUTPUT_DIR
        ? path.resolve(process.env.HOST_OUTPUT_DIR)
        : path.resolve(process.env.OUTPUT_DIR || path.join(DATA_DIR, 'output')),

    sessionSecret: process.env.SESSION_SECRET || 'please-change-this-secret',
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '',

    // 'docker' (default, reuses the bbb-mp4 worker image) or 'local'
    // (spawns node bbb-mp4.js directly on this host, no Docker required).
    workerMode: (process.env.WORKER_MODE || 'docker').toLowerCase(),
    converterImage: process.env.CONVERTER_IMAGE || 'bbb-mp4-worker',
    dockerCpus: process.env.DOCKER_CPUS || '',
    dockerMemory: process.env.DOCKER_MEMORY || '',
    repoRoot: path.resolve(process.env.REPO_ROOT || path.join(__dirname, '..', '..')),

    maxConcurrentJobsDefault: parseInt(process.env.MAX_CONCURRENT_JOBS || '2', 10),

    allowedHosts: (process.env.ALLOWED_HOSTS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),

    smtp: {
        host: process.env.SMTP_HOST || '',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: bool(process.env.SMTP_SECURE, false),
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
        from: process.env.SMTP_FROM || 'BBB MP4 <no-reply@localhost>',
    },
    notifyEmailDefault: process.env.NOTIFY_EMAIL_DEFAULT || '',
    notifyOnSuccessDefault: bool(process.env.NOTIFY_ON_SUCCESS, true),
    notifyOnFailureDefault: bool(process.env.NOTIFY_ON_FAILURE, true),
};
