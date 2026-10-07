const express = require('express');
const db = require('../db');
const config = require('../config');

const router = express.Router();

router.get('/settings', (req, res) => {
    res.json({
        maxConcurrentJobs: parseInt(db.getSetting('max_concurrent_jobs', String(config.maxConcurrentJobsDefault)), 10),
        notifyEmailDefault: db.getSetting('notify_email_default', config.notifyEmailDefault),
        notifyOnSuccess: db.getSetting('notify_on_success', String(config.notifyOnSuccessDefault)) === 'true',
        notifyOnFailure: db.getSetting('notify_on_failure', String(config.notifyOnFailureDefault)) === 'true',
        smtpConfigured: !!config.smtp.host,
        workerMode: config.workerMode,
        converterImage: config.converterImage,
    });
});

router.post('/settings', (req, res) => {
    const { maxConcurrentJobs, notifyEmailDefault, notifyOnSuccess, notifyOnFailure } = req.body || {};
    if (maxConcurrentJobs !== undefined) {
        const n = parseInt(maxConcurrentJobs, 10);
        if (!Number.isFinite(n) || n < 1) return res.status(400).json({ error: 'maxConcurrentJobs должен быть положительным числом' });
        db.setSetting('max_concurrent_jobs', n);
    }
    if (notifyEmailDefault !== undefined) db.setSetting('notify_email_default', notifyEmailDefault || '');
    if (notifyOnSuccess !== undefined) db.setSetting('notify_on_success', !!notifyOnSuccess);
    if (notifyOnFailure !== undefined) db.setSetting('notify_on_failure', !!notifyOnFailure);
    res.json({ ok: true });
});

module.exports = router;
