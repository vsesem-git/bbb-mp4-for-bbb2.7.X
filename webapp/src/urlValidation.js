const config = require('./config');

// Matches .../playback/presentation/2.3/<40-char-id>-<13-digit-timestamp>
const RECORDING_URL_RE = /^https?:\/\/[^/]+\/playback\/presentation\/2\.3\/([a-z0-9]{40}-[0-9]{13})\/?$/i;

function validateRecordingUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return { ok: false, error: 'Ссылка не указана' };
    }
    const trimmed = rawUrl.trim();
    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch (e) {
        return { ok: false, error: 'Некорректный URL' };
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { ok: false, error: 'Поддерживаются только http(s) ссылки' };
    }

    const match = trimmed.match(RECORDING_URL_RE);
    if (!match) {
        return {
            ok: false,
            error: 'Ссылка должна быть вида https://<host>/playback/presentation/2.3/<meeting-id>',
        };
    }

    if (config.allowedHosts.length > 0 && !config.allowedHosts.includes(parsed.host)) {
        return { ok: false, error: `Хост ${parsed.host} не входит в список разрешённых (ALLOWED_HOSTS)` };
    }

    return { ok: true, url: trimmed, meetingId: match[1] };
}

module.exports = { validateRecordingUrl, RECORDING_URL_RE };
