const express = require('express');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const cors = require('cors');
const { spawn } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');

async function readJsonSafe(filename) {
    const p = path.join(DATA_DIR, filename);
    try {
        const text = await fsPromises.readFile(p, 'utf8');
        return JSON.parse(text);
    } catch (err) {
        return null;
    }
}


app.get('/api/groups', async (req, res) => {
    const groups = await readJsonSafe('groups.json');
    if (!groups) return res.status(500).json({ error: 'groups.json not found' });
    const arr = Object.entries(groups).map(([id, number]) => ({ id, number }));
    res.json(arr);
});

app.get('/api/staff', async (req, res) => {
    const staff = await readJsonSafe('staff.json');
    if (!staff) return res.status(500).json({ error: 'staff.json not found' });
    const arr = Object.entries(staff).map(([id, name]) => ({ id, name }));
    res.json(arr);
});

app.get('/api/search', async (req, res) => {
    try {
        const q = (req.query.q || '').trim().toLowerCase();
        if (!q) return res.json({ groups: [], staff: [] });
        const groups = await readJsonSafe('groups.json') || {};
        const staff = await readJsonSafe('staff.json') || {};

        const groupResults = Object.entries(groups)
            .filter(([id, num]) => String(num).toLowerCase().includes(q))
            .slice(0, 40)
            .map(([id, number]) => ({ id, number }));

        const staffResults = Object.entries(staff)
            .filter(([id, name]) => String(name).toLowerCase().includes(q))
            .slice(0, 40)
            .map(([id, name]) => ({ id, name }));

        res.json({ groups: groupResults, staff: staffResults });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/schedule', async (req, res) => {
    try {
        const groupId = req.query.groupId;
        const week = req.query.week;
        if (groupId && week) {
            const fname = `schedule_${groupId}_${week}.json`;
            const specific = await readJsonSafe(fname);
            if (specific) return res.json({ meta: { for: 'specific' }, data: specific });
        }
        const fallback = await readJsonSafe('schedule.json');
        if (fallback) return res.json({ meta: { for: 'fallback' }, data: fallback });
        res.status(404).json({ error: 'Файл расписания не найден. Запустите /api/refresh-schedule или поместите data/schedule.json' });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера при чтении расписания' });
    }
});

app.post('/api/refresh-schedule', (req, res) => {
    const scriptPath = path.join(ROOT, 'lessons_parse.js');
    if (!fs.existsSync(scriptPath)) return res.status(500).json({ error: 'lessons_parse.js not found' });

    const spawnArgs = [];

    if (req.query.url) {
        try {
            const u = new URL(req.query.url);
            if (!u.host.includes('ssau.ru')) return res.status(400).json({ error: 'URL host must be ssau.ru' });
        } catch (e) {
            return res.status(400).json({ error: 'Invalid url parameter' });
        }
        spawnArgs.push(req.query.url);
    } else if (req.query.staffId) {
        const staffId = String(req.query.staffId).trim();
        const week = String(req.query.week || '1').trim();
        if (!staffId) return res.status(400).json({ error: 'staffId required' });
        spawnArgs.push(`staff:${staffId}`, week);
    } else if (req.query.groupId) {
        const groupId = String(req.query.groupId).trim();
        const week = String(req.query.week || '1').trim();
        if (!groupId) return res.status(400).json({ error: 'groupId required' });
        spawnArgs.push(groupId, week);
    } else {
        return res.status(400).json({ error: 'Provide url or staffId or (groupId and week)' });
    }

    const nodePath = process.execPath;
    const child = spawn(nodePath, [scriptPath, ...spawnArgs], { cwd: ROOT, stdio: ['ignore','pipe','pipe'], env: process.env });

    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());

    const TIMEOUT_MS = 2 * 60 * 1000;
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch(e){} }, TIMEOUT_MS);

    child.on('close', code => {
        clearTimeout(timer);
        const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('schedule_') || f === 'schedule.json');
        res.json({ ok: true, code, stdout, stderr, files });
    });

    child.on('error', err => {
        clearTimeout(timer);
        res.status(500).json({ ok: false, error: String(err) });
    });
});


if (fs.existsSync(PUBLIC_DIR)) {
    app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));
} else {
    console.warn('Public dir not found:', PUBLIC_DIR);
}

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server started at http://localhost:${PORT}`);
});
