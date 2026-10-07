const nodemailer = require('nodemailer');
const config = require('./config');
const db = require('./db');

let transporter = null;

function getTransporter() {
    if (!config.smtp.host) return null;
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: config.smtp.host,
            port: config.smtp.port,
            secure: config.smtp.secure,
            auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
        });
    }
    return transporter;
}

function jobUrl(job) {
    const base = config.baseUrl ? config.baseUrl.replace(/\/$/, '') : '';
    return `${base}/#job-${job.id}`;
}

async function notifyJob(job, kind) {
    const t = getTransporter();
    if (!t) return { skipped: true, reason: 'SMTP not configured' };

    const notifyOnSuccess = db.getSetting('notify_on_success', String(config.notifyOnSuccessDefault)) === 'true';
    const notifyOnFailure = db.getSetting('notify_on_failure', String(config.notifyOnFailureDefault)) === 'true';
    if (kind === 'done' && !notifyOnSuccess) return { skipped: true, reason: 'notify_on_success disabled' };
    if (kind === 'failed' && !notifyOnFailure) return { skipped: true, reason: 'notify_on_failure disabled' };

    const to = job.notify_email || db.getSetting('notify_email_default', config.notifyEmailDefault);
    if (!to) return { skipped: true, reason: 'no recipient configured' };

    let subject, text;
    if (kind === 'done') {
        subject = `✅ Конвертация завершена: ${job.meeting_id || job.id}`;
        text = [
            `Запись успешно сконвертирована в MP4.`,
            ``,
            `Meeting ID: ${job.meeting_id}`,
            `Исходная ссылка: ${job.url}`,
            `Файл: ${job.file_name}`,
            `Длительность записи: ${job.duration_sec ? Math.round(job.duration_sec) + ' сек' : '—'}`,
            `Ссылка на задачу в панели: ${jobUrl(job)}`,
        ].join('\n');
    } else if (kind === 'failed') {
        subject = `❌ Ошибка конвертации: ${job.meeting_id || job.id}`;
        text = [
            `Не удалось сконвертировать запись в MP4.`,
            ``,
            `Meeting ID: ${job.meeting_id}`,
            `Исходная ссылка: ${job.url}`,
            `Ошибка: ${job.error_message || 'см. логи'}`,
            `Попытка №: ${job.attempts}`,
            `Ссылка на задачу в панели: ${jobUrl(job)}`,
        ].join('\n');
    } else {
        return { skipped: true, reason: 'unknown kind' };
    }

    try {
        await t.sendMail({ from: config.smtp.from, to, subject, text });
        return { sent: true, to };
    } catch (err) {
        return { sent: false, error: err.message };
    }
}

module.exports = { notifyJob };
