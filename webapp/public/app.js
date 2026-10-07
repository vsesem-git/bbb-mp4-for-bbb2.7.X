const STAGE_LABELS = {
    queued: 'В очереди',
    starting: 'Запуск',
    'xvfb-started': 'Инициализация экрана',
    'launching-browser': 'Запуск браузера',
    'opening-recording': 'Открытие записи',
    'checking-recording': 'Проверка записи',
    'duration-detected': 'Определена длительность',
    capturing: 'Запись видео',
    'ffmpeg-start': 'Старт кодирования',
    'ffmpeg-exit': 'Кодирование завершено',
    'moving-file': 'Сохранение файла',
    moved: 'Файл сохранён',
    finalizing: 'Завершение',
    done: 'Готово',
    error: 'Ошибка',
    canceling: 'Отмена...',
    canceled: 'Отменено',
};

const STATUS_LABELS = {
    queued: 'В очереди',
    running: 'Выполняется',
    done: 'Готово',
    failed: 'Ошибка',
    canceled: 'Отменено',
};

let jobsById = new Map();
let currentLogJobId = null;

function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('ru-RU');
}

function fmtDuration(sec) {
    if (!sec && sec !== 0) return '—';
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h, m, s].map((v, i) => (i === 0 && v === 0 ? null : String(v).padStart(2, '0'))).filter(Boolean).join(':') || `${s}с`;
}

function renderRow(job) {
    const tr = document.createElement('tr');
    tr.id = `job-row-${job.id}`;

    const stageLabel = STAGE_LABELS[job.stage] || job.stage || '—';
    const statusLabel = STATUS_LABELS[job.status] || job.status;

    tr.innerHTML = `
        <td>
            <div class="meeting-cell" title="${job.url}">${job.meeting_id || job.id}</div>
        </td>
        <td><span class="badge ${job.status}">${statusLabel}</span></td>
        <td class="stage-cell">${stageLabel}${job.error_message ? `<br><span style="color:var(--err)">${escapeHtml(job.error_message)}</span>` : ''}</td>
        <td>
            <div class="progress-outer"><div class="progress-inner" style="width:${job.progress || 0}%"></div></div>
            <div class="sub" style="margin-top:4px;">${job.progress || 0}% ${job.duration_sec ? '· запись ' + fmtDuration(job.duration_sec) : ''}</div>
        </td>
        <td class="sub">${fmtDate(job.created_at)}</td>
        <td class="actions-cell"></td>
    `;

    const actions = tr.querySelector('.actions-cell');

    const logBtn = document.createElement('button');
    logBtn.className = 'small';
    logBtn.textContent = 'Логи';
    logBtn.onclick = () => openLogModal(job.id);
    actions.appendChild(logBtn);

    if (job.status === 'done' && job.file_name) {
        const dl = document.createElement('a');
        dl.className = 'btn small';
        dl.style.textDecoration = 'none';
        dl.href = `/files/${encodeURIComponent(job.file_name)}`;
        dl.textContent = 'Скачать';
        actions.appendChild(dl);
    }

    if (job.status === 'queued' || job.status === 'running') {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'small danger';
        cancelBtn.textContent = 'Отменить';
        cancelBtn.onclick = () => api(`/api/jobs/${job.id}/cancel`, 'POST');
        actions.appendChild(cancelBtn);
    }

    if (job.status === 'failed' || job.status === 'done' || job.status === 'canceled') {
        const retryBtn = document.createElement('button');
        retryBtn.className = 'small';
        retryBtn.textContent = job.status === 'done' ? 'Перезапустить' : 'Повторить';
        retryBtn.onclick = () => api(`/api/jobs/${job.id}/retry`, 'POST');
        actions.appendChild(retryBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'small danger';
        delBtn.textContent = 'Удалить';
        delBtn.onclick = async () => {
            if (confirm('Удалить задачу из списка? (файл результата останется, если не выбрать удаление)')) {
                await api(`/api/jobs/${job.id}`, 'DELETE');
                renderAll();
            }
        };
        actions.appendChild(delBtn);
    }

    return tr;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderAll() {
    const tbody = document.getElementById('jobsBody');
    tbody.innerHTML = '';
    const jobs = Array.from(jobsById.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    document.getElementById('emptyState').style.display = jobs.length === 0 ? 'block' : 'none';
    jobs.forEach(j => tbody.appendChild(renderRow(j)));
}

async function api(url, method = 'GET', body) {
    const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
        window.location.href = '/login.html';
        throw new Error('unauthenticated');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
}

async function loadJobs() {
    const data = await api('/api/jobs');
    jobsById = new Map(data.jobs.map(j => [j.id, j]));
    document.getElementById('queueInfo').textContent = `Одновременно: до ${data.maxConcurrent}`;
    renderAll();
}

document.getElementById('submitForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('urlInput').value.trim();
    const notifyEmail = document.getElementById('emailInput').value.trim();
    const errEl = document.getElementById('submitError');
    errEl.style.display = 'none';
    try {
        const { job } = await api('/api/jobs', 'POST', { url, notifyEmail: notifyEmail || undefined });
        jobsById.set(job.id, job);
        renderAll();
        document.getElementById('urlInput').value = '';
    } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
    }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api('/api/auth/logout', 'POST');
    window.location.href = '/login.html';
});

function openLogModal(jobId) {
    currentLogJobId = jobId;
    const job = jobsById.get(jobId);
    document.getElementById('logModalTitle').textContent = `Логи — ${job ? (job.meeting_id || job.id) : jobId}`;
    document.getElementById('logDownloadLink').href = `/api/jobs/${jobId}/log?download=1`;
    document.getElementById('logContent').textContent = 'Загрузка...';
    document.getElementById('logModal').classList.add('open');
    fetch(`/api/jobs/${jobId}/log`).then(r => r.ok ? r.text() : 'Логи отсутствуют').then(text => {
        if (currentLogJobId === jobId) {
            const el = document.getElementById('logContent');
            el.textContent = text;
            el.scrollTop = el.scrollHeight;
        }
    });
}

document.getElementById('closeLogModal').addEventListener('click', () => {
    currentLogJobId = null;
    document.getElementById('logModal').classList.remove('open');
});

// Settings modal
async function openSettings() {
    const s = await api('/api/settings');
    document.getElementById('maxConcurrentInput').value = s.maxConcurrentJobs;
    document.getElementById('notifyEmailInput').value = s.notifyEmailDefault || '';
    document.getElementById('notifySuccessInput').checked = s.notifyOnSuccess;
    document.getElementById('notifyFailureInput').checked = s.notifyOnFailure;
    document.getElementById('smtpStatus').textContent = s.smtpConfigured
        ? `Email-уведомления включены (режим обработки: ${s.workerMode}, образ: ${s.converterImage})`
        : `SMTP не настроен в .env — email-уведомления отправляться не будут (режим обработки: ${s.workerMode})`;
    document.getElementById('settingsModal').classList.add('open');
}

document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('closeSettingsModal').addEventListener('click', () => {
    document.getElementById('settingsModal').classList.remove('open');
});
document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    const errEl = document.getElementById('settingsError');
    errEl.style.display = 'none';
    try {
        await api('/api/settings', 'POST', {
            maxConcurrentJobs: parseInt(document.getElementById('maxConcurrentInput').value, 10),
            notifyEmailDefault: document.getElementById('notifyEmailInput').value.trim(),
            notifyOnSuccess: document.getElementById('notifySuccessInput').checked,
            notifyOnFailure: document.getElementById('notifyFailureInput').checked,
        });
        document.getElementById('settingsModal').classList.remove('open');
        loadJobs();
    } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
    }
});

function connectStream() {
    const es = new EventSource('/api/stream');
    es.addEventListener('job', (e) => {
        const job = JSON.parse(e.data);
        jobsById.set(job.id, job);
        renderAll();
    });
    es.addEventListener('log', (e) => {
        const { jobId, line } = JSON.parse(e.data);
        if (jobId === currentLogJobId) {
            const el = document.getElementById('logContent');
            el.textContent += (el.textContent ? '\n' : '') + line;
            el.scrollTop = el.scrollHeight;
        }
    });
    es.onerror = () => {
        // EventSource auto-reconnects; also do a periodic full refresh as a safety net.
    };
}

(async function init() {
    try {
        const me = await api('/api/auth/me');
        if (!me.authenticated) { window.location.href = '/login.html'; return; }
        document.getElementById('meLabel').textContent = me.username || '';
    } catch (e) { return; }
    await loadJobs();
    connectStream();
    setInterval(loadJobs, 30000);
})();
