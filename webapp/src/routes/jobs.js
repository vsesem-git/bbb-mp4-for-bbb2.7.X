const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../db');
const bus = require('../events');
const queue = require('../queue');
const worker = require('../worker');
const { validateRecordingUrl } = require('../urlValidation');

const router = express.Router();

router.post('/jobs', (req, res) => {
    const { url, notifyEmail } = req.body || {};
    const result = validateRecordingUrl(url);
    if (!result.ok) {
        return res.status(400).json({ error: result.error });
    }

    // Avoid piling up duplicate active jobs for the exact same recording.
    const dup = db.listJobs().find(j =>
        j.meeting_id === result.meetingId && (j.status === 'queued' || j.status === 'running'));
    if (dup) {
        return res.status(409).json({ error: 'Эта запись уже в очереди/обработке', job: dup });
    }

    const id = crypto.randomUUID();
    const job = db.createJob({ id, url: result.url, meetingId: result.meetingId, notifyEmail });
    bus.emit('job-updated', job);
    queue.enqueue(id);
    res.status(201).json({ job });
});

router.get('/jobs', (req, res) => {
    res.json({ jobs: db.listJobs(), maxConcurrent: queue.getMaxConcurrent() });
});

router.get('/jobs/:id', (req, res) => {
    const job = db.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Не найдено' });
    res.json({ job });
});

router.get('/jobs/:id/log', (req, res) => {
    const job = db.getJob(req.params.id);
    if (!job || !job.log_path || !fs.existsSync(job.log_path)) {
        return res.status(404).send('Логи отсутствуют');
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (req.query.download) {
        res.setHeader('Content-Disposition', `attachment; filename="${job.meeting_id || job.id}.log"`);
    }
    fs.createReadStream(job.log_path).pipe(res);
});

router.post('/jobs/:id/retry', (req, res) => {
    const result = queue.retryJob(req.params.id);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, job: result.job });
});

router.post('/jobs/:id/cancel', (req, res) => {
    const result = queue.cancelJob(req.params.id);
    if (!result.ok) return res.status(400).json({ error: result.error || 'Не удалось отменить' });
    res.json({ ok: true });
});

router.delete('/jobs/:id', (req, res) => {
    const job = db.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Не найдено' });
    if (job.status === 'running' || worker.isRunning(job.id)) {
        return res.status(400).json({ error: 'Нельзя удалить выполняющуюся задачу, сначала отмените её' });
    }
    if (req.query.deleteFile === 'true' && job.file_name) {
        const p = path.join(config.outputDir, job.file_name);
        if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (job.log_path && fs.existsSync(job.log_path)) fs.unlinkSync(job.log_path);
    db.deleteJob(job.id);
    res.json({ ok: true });
});

// Server-Sent Events: pushes job list updates and log lines in real time.
router.get('/stream', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');

    const sendJob = (job) => {
        res.write(`event: job\ndata: ${JSON.stringify(job)}\n\n`);
    };
    const sendLog = ({ jobId, line }) => {
        res.write(`event: log\ndata: ${JSON.stringify({ jobId, line })}\n\n`);
    };
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

    bus.on('job-updated', sendJob);
    bus.on('log', sendLog);

    req.on('close', () => {
        clearInterval(heartbeat);
        bus.off('job-updated', sendJob);
        bus.off('log', sendLog);
    });
});

module.exports = router;
