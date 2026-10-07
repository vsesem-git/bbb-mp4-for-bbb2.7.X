const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const config = require('./src/config');
const { requireAuth } = require('./src/auth');
const authRoutes = require('./src/routes/auth');
const jobsRoutes = require('./src/routes/jobs');
const settingsRoutes = require('./src/routes/settings');
const queue = require('./src/queue');

if (!config.adminPassword && !config.adminPasswordHash) {
    console.warn('[WARN] ADMIN_PASSWORD / ADMIN_PASSWORD_HASH не заданы — вход в панель будет невозможен. Задайте их в .env');
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

app.use('/api/auth', authRoutes);

// Everything below requires an authenticated session.
app.use('/api', requireAuth, jobsRoutes);
app.use('/api', requireAuth, settingsRoutes);

// Download finished MP4 files.
app.get('/files/:name', requireAuth, (req, res) => {
    const name = path.basename(req.params.name);
    if (!/^.+\.mp4$/i.test(name)) return res.status(400).send('Bad file name');
    const full = path.join(config.outputDir, name);
    if (!fs.existsSync(full)) return res.status(404).send('Файл не найден');
    res.download(full, name);
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'app.html'));
});

queue.recoverOnBoot();

app.listen(config.port, '0.0.0.0', () => {
    console.log(`BBB-MP4 dashboard listening on http://0.0.0.0:${config.port} (worker mode: ${config.workerMode})`);
});
