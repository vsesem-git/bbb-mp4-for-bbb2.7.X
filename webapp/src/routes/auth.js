const express = require('express');
const { verifyCredentials } = require('../auth');

const router = express.Router();

router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    if (verifyCredentials(username, password)) {
        req.session.authenticated = true;
        req.session.username = username;
        return res.json({ ok: true });
    }
    return res.status(401).json({ ok: false, error: 'Неверный логин или пароль' });
});

router.post('/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
    res.json({ authenticated: !!(req.session && req.session.authenticated), username: req.session && req.session.username });
});

module.exports = router;
