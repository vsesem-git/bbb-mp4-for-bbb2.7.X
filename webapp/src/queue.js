const db = require('./db');
const config = require('./config');
const worker = require('./worker');
const bus = require('./events');

const pending = [];
const runningIds = new Set();

function getMaxConcurrent() {
    const v = parseInt(db.getSetting('max_concurrent_jobs', String(config.maxConcurrentJobsDefault)), 10);
    return Number.isFinite(v) && v > 0 ? v : config.maxConcurrentJobsDefault;
}

function tryStart() {
    while (runningIds.size < getMaxConcurrent() && pending.length > 0) {
        const jobId = pending.shift();
        const job = db.getJob(jobId);
        if (!job || job.status !== 'queued') continue; // may have been canceled/deleted meanwhile
        runningIds.add(jobId);
        worker.start(jobId, () => {
            runningIds.delete(jobId);
            tryStart();
        });
    }
}

function enqueue(jobId) {
    pending.push(jobId);
    tryStart();
}

function cancelJob(jobId) {
    const job = db.getJob(jobId);
    if (!job) return { ok: false, error: 'Задача не найдена' };

    if (job.status === 'queued') {
        const idx = pending.indexOf(jobId);
        if (idx !== -1) pending.splice(idx, 1);
        const updated = db.updateJob(jobId, { status: 'canceled', stage: 'canceled', finished_at: db.nowIso() });
        bus.emit('job-updated', updated);
        return { ok: true };
    }

    if (job.status === 'running') {
        const updated = db.updateJob(jobId, { status: 'canceled', stage: 'canceling' });
        bus.emit('job-updated', updated);
        const stopped = worker.cancel(jobId);
        return { ok: stopped };
    }

    return { ok: false, error: `Нельзя отменить задачу в статусе ${job.status}` };
}

function retryJob(jobId) {
    const job = db.getJob(jobId);
    if (!job) return { ok: false, error: 'Задача не найдена' };
    if (job.status === 'queued' || job.status === 'running') {
        return { ok: false, error: 'Задача ещё выполняется' };
    }
    const updated = db.updateJob(jobId, {
        status: 'queued',
        stage: 'queued',
        progress: 0,
        error_message: null,
        started_at: null,
        finished_at: null,
    });
    bus.emit('job-updated', updated);
    enqueue(jobId);
    return { ok: true, job: updated };
}

// Reconcile state after a process restart: anything left "running" in the DB
// had its worker process killed along with the previous server instance.
function recoverOnBoot() {
    const stale = db.listByStatus('running');
    for (const job of stale) {
        const updated = db.updateJob(job.id, {
            status: 'failed',
            stage: 'error',
            error_message: 'Процесс был прерван перезапуском сервиса',
            finished_at: db.nowIso(),
        });
        bus.emit('job-updated', updated);
    }
    const queued = db.listByStatus('queued');
    for (const job of queued) {
        pending.push(job.id);
    }
    tryStart();
}

module.exports = { enqueue, cancelJob, retryJob, recoverOnBoot, getMaxConcurrent };
