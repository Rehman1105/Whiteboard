const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const os = require('os');

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'board-data.json');

// --- Persisted state ---
let state = { blocks: {}, drInitials: {} };
if (fs.existsSync(DATA_FILE)) {
    try {
        state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
        console.error('Could not load board-data.json, starting fresh:', e.message);
    }
}

function saveState() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

// --- Static file server ---
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.png':  'image/png',
    '.ico':  'image/x-icon',
};

// Whitelist of files that may be served to browsers
const ALLOWED_FILES = new Set([
    'index.html',
    'board.html',
    'board.js',
    'style.css',
    'preload.js',
]);

const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    const basename = urlPath === '/' ? 'index.html' : path.basename(urlPath);

    if (!ALLOWED_FILES.has(basename)) {
        res.writeHead(404);
        res.end('Not found');
        return;
    }

    const filePath = path.join(__dirname, basename);
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'text/plain';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

// --- WebSocket server ---
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    // Send current full state to newly connected client
    ws.send(JSON.stringify({ type: 'full-state', blocks: state.blocks, drInitials: state.drInitials }));

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            return;
        }

        if (msg.type === 'update-block') {
            // Validate id is one of the known numeric block IDs (1–14)
            const id = String(msg.id);
            if (/^(1[0-4]|[1-9])$/.test(id)) {
                state.blocks[id] = msg.data;
                saveState();
            }
        } else if (msg.type === 'dr-initials-changed') {
            Object.assign(state.drInitials, msg.data);
            saveState();
        }

        // Broadcast to every other connected client
        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(msg));
            }
        });
    });
});

// --- Start ---
server.listen(PORT, '0.0.0.0', () => {
    console.log('\nWhiteboard server is running!\n');
    console.log(`  Local:   http://localhost:${PORT}`);

    const interfaces = os.networkInterfaces();
    Object.values(interfaces).flat().forEach(({ family, address, internal }) => {
        if (family === 'IPv4' && !internal) {
            console.log(`  Network: http://${address}:${PORT}`);
        }
    });

    console.log('\nOpen the Network URL on every computer that needs access.');
    console.log('Press Ctrl+C to stop.\n');
});
