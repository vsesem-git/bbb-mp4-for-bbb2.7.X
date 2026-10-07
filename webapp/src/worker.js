const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config');
const db = require('./db');
const bus = require('./events');
const { notifyJob } = require('./mailer');

// jobId -> { child, containerName, logStream }
const running = new Map();

function logLine(job, line) {
    const entry = running.get(job.id);
    if (entry && entry.logStream) {
        entry.logStream.write(line.endsWith('\n') ? line : line + '\n');
    }
    bus.emit('log', { jobId: job.id, line });
}

function parseLine(job, line, progressState) {
    let m;
    if ((m = line.match(/^STAGE:(\{.*\})\s*$/))) {
        try {
            const payload = JSON.parse(m[1]);
            const update = { stage: payload.stage };
            if (payload.duration && !progressState.durationSec) {
                progressState.durationSec = parseFloat(payload.duration);
                update.duration_sec = progressState.durationSec;
            }
            if (payload.stage === 'ffmpeg-exit' && payload.exitCode !== 0) {
                update.error_message = `ffmpeg завершился с кодом ${payload.exitCode}`;
            }
            db.updateJob(job.id, update);
            bus.emit('job-updated', db.getJob(job.id));
        } catch (e) { /* ignore malformed stage line */ }
        return;
    }
    if ((m = line.match(/^DURATION:([0-9.]+)/))) {
        progressState.durationSec = parseFloat(m[1]);
        db.updateJob(job.id, { duration_sec: progressState.durationSec });
        bus.emit('job-updated', db.getJob(job.id));
        return;
    }
    if ((m = line.match(/^out_time_ms=(\d+)/))) {
        const elapsedSec = parseInt(m[1], 10) / 1000000;
        if (progressState.durationSec > 0) {
            const pct = Math.min(99, Math.round((elapsedSec / progressState.durationSec) * 100));
            if (pct !== progressState.lastPct) {
                progressState.lastPct = pct;
                db.updateJob(job.id, { progress: pct, stage: 'capturing' });
                bus.emit('job-updated', db.getJob(job.id));
            }
        }
        return;
    }
    if (/^progress=end/.test(line)) {
        db.updateJob(job.id, { progress: 99, stage: 'finalizing' });
        bus.emit('job-updated', db.getJob(job.id));
    }
}

function expectedOutputPath(job) {
    return path.join(config.outputDir, `${job.meeting_id}.mp4`);
}

function buildDockerCommand(job) {
    const containerName = `bbbmp4-${job.id}`;
    const args = ['run', '--rm', '--name', containerName,
        '-v', `${config.hostOutputDir}:/usr/src/app/processed`,
        '--env', `REC_URL=${job.url}`];
    if (config.dockerCpus) args.push('--cpus', config.dockerCpus);
    if (config.dockerMemory) args.push('--memory', config.dockerMemory);
    args.push(config.converterImage);
    return { cmd: 'docker', args, containerName };
}

function buildLocalCommand(job) {
    const processingDir = path.join(config.dataDir, 'processing');
    fs.mkdirSync(processingDir, { recursive: true });
    return {
        cmd: 'node',
        args: ['bbb-mp4.js', job.url],
        containerName: null,
        env: Object.assign({}, process.env, {
            PROCESSING_DIR: processingDir,
            PROCESSED_DIR: config.outputDir,
        }),
        cwd: config.repoRoot,
    };
}

function start(jobId, onFinished) {
    let job = db.getJob(jobId);
    if (!job) return;

    const attempt = (job.attempts || 0) + 1;
    job = db.updateJob(jobId, {
        status: 'running',
        stage: 'starting',
        progress: 0,
        error_message: null,
        attempts: attempt,
        started_at: db.nowIso(),
        finished_at: null,
    });
    bus.emit('job-updated', job);

    const logPath = job.log_path || path.join(config.logDir, `${job.id}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    logStream.write(`\n===== Попытка №${attempt} запущена ${db.nowIso()} =====\n`);
    db.updateJob(jobId, { log_path: logPath });

    let built;
    let spawnOpts = {};
    if (config.workerMode === 'local') {
        built = buildLocalCommand(job);
        spawnOpts = { cwd: built.cwd, env: built.env };
    } else {
        built = buildDockerCommand(job);
    }

    db.updateJob(jobId, { container_name: built.containerName });

    let child;
    try {
        child = spawn(built.cmd, built.args, spawnOpts);
    } catch (err) {
        logStream.write(`Не удалось запустить процесс: ${err.message}\n`);
        logStream.end();
        const failed = db.updateJob(jobId, {
            status: 'failed',
            stage: 'error',
            error_message: `Не удалось запустить процесс: ${err.message}`,
            finished_at: db.nowIso(),
        });
        bus.emit('job-updated', failed);
        notifyJob(failed, 'failed').catch(() => {});
        onFinished();
        return;
    }

    const progressState = { durationSec: job.duration_sec || 0, lastPct: -1 };
    running.set(jobId, { child, containerName: built.containerName, logStream });

    const handleData = (data) => {
        const text = data.toString();
        text.split(/\r?\n/).filter(Boolean).forEach((line) => {
            logLine(job, line);
            parseLine(job, line, progressState);
        });
    };

    child.stdout.on('data', handleData);
    child.stderr.on('data', handleData);

    child.on('error', (err) => {
        logStream.write(`Ошибка процесса: ${err.message}\n`);
    });

    child.on('close', (code) => {
        logStream.write(`\n===== Процесс завершился с кодом ${code} (${db.nowIso()}) =====\n`);
        logStream.end();
        running.delete(jobId);

        const current = db.getJob(jobId);
        if (!current) { onFinished(); return; }

        if (current.status === 'canceled') {
            onFinished();
            return;
        }

        const outPath = expectedOutputPath(current);
        const exists = fs.existsSync(outPath);
        let finalJob;
        if (code === 0 && exists) {
            const stat = fs.statSync(outPath);
            finalJob = db.updateJob(jobId, {
                status: 'done',
                stage: 'done',
                progress: 100,
                file_name: `${current.meeting_id}.mp4`,
                file_size: stat.size,
                finished_at: db.nowIso(),
            });
        } else {
            finalJob = db.updateJob(jobId, {
                status: 'failed',
                stage: 'error',
                error_message: current.error_message || `Процесс завершился с кодом ${code}, файл результата не найден`,
                finished_at: db.nowIso(),
            });
        }
        bus.emit('job-updated', finalJob);
        notifyJob(finalJob, finalJob.status === 'done' ? 'done' : 'failed').catch(() => {});
        onFinished();
    });
}

function cancel(jobId) {
    const entry = running.get(jobId);
    if (!entry) return false;
    if (entry.containerName) {
        spawn('docker', ['stop', '-t', '5', entry.containerName]);
    } else if (entry.child && entry.child.pid) {
        try { process.kill(entry.child.pid, 'SIGTERM'); } catch (e) { /* ignore */ }
    }
    return true;
}

function getLogTail(jobId, maxBytes = 200000) {
    const job = db.getJob(jobId);
    if (!job || !job.log_path || !fs.existsSync(job.log_path)) return '';
    const stat = fs.statSync(job.log_path);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(job.log_path, 'r');
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8');
}

module.exports = { start, cancel, getLogTail, isRunning: (id) => running.has(id) };
