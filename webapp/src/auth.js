const bcrypt = require('bcryptjs');
const config = require('./config');

function verifyCredentials(username, password) {
    if (username !== config.adminUsername) return false;
    if (config.adminPasswordHash) {
        try {
            return bcrypt.compareSync(password, config.adminPasswordHash);
        } catch (e) {
            return false;
        }
    }
    if (config.adminPassword) {
        return password === config.adminPassword;
    }
    // No password configured at all -> refuse (fail closed).
    return false;
}

function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) return next();
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    return res.redirect('/login.html');
}

module.exports = { verifyCredentials, requireAuth };
