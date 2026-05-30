const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const http = require('http');

const app = express();

console.log('='.repeat(50));
console.log('🚀 VOXIOM BOT MANAGER - ULTIMATE v20');
console.log('🏗️ INSTANT REDEPLOY | SLOT BLOCKING | AGGRESSIVE LAG');
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
        heartbeatMs: 1000,  // FASTER HEARTBEAT
        tickMs: 10,         // ULTRA AGGRESSIVE: 10ms (100 packets/sec per bot)
        jumpEvery: 15,      // Jump frequently
        slot: 1,
        description: 'Extreme lag - 100 packets/sec spam, rapid jumping & clicking'
    },
    pillar: {
        label: 'PILLAR + SLOT BLOCK',
        handshake: Buffer.from([0x03, 0x87, 0x03, 0x02, 0x05]),
        heartbeatMs: 50,
        tickMs: 25,         // FASTER: 25ms for aggressive blocking
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

// ==================== URL CONVERTER (FIXED) ====================
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

// ==================== BOT CLASS (LIGHTWEIGHT) ====================
class VoxiomBot {
    constructor(id, url, mode, timer, cycle, sessionId, rejoinDelay = 1) {
        this.id = id;
        this.url = url;
        this.mode = mode;
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
        console.log(`[Bot #${this.id}] Created - Mode: ${mode} (${this.cfg.description}), Tick: ${this.cfg.tickMs}ms, Rejoin: ${this.rejoinDelay}ms`);
        this.connect();
    }

    // ==================== ORIGINAL PACKET BUILDER ====================
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

    // ⛏️ DIG PACKET
    buildDigPacket() {
        return Buffer.from([
            0x1a,
            0x00, 0x10,
            0x00, 0x03,
            0xff, 0xec,
            0x00, 0x00
        ]);
    }

    // ==================== PILLAR TICK (ENHANCED SLOT BLOCKING) ====================
    tickPillar() {
        if (!this.ws || this.ws.readyState !== 1) return;
        
        this.yaw += 0.008;
        if (this.yaw > Math.PI * 2) this.yaw -= Math.PI * 2;
        
        this.tickCycle++;
        const phase = this.tickCycle % this.cfg.jumpEvery;
        
        // SLOT BLOCKING: Send slot packets to occupy slots
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

    // ==================== DIG TICK ====================
    tickDig() {
        if (!this.ws || this.ws.readyState !== 1) return;
        
        this.pitch = -1.5;
        this.ws.send(this.buildPacket({}));
        this.ws.send(this.buildDigPacket());
        this.packetsSent += 2;
    }

    // ==================== LAG TICK (ULTRA AGGRESSIVE SPAM) ====================
    tickLag() {
        if (!this.ws || this.ws.readyState !== 1) return;
        
        // EXTREME RAPID MOVEMENT
        this.yaw += (Math.random() - 0.5) * 0.3;  // INCREASED from 0.15
        if (this.yaw > Math.PI * 2) this.yaw -= Math.PI * 2;
        if (this.yaw < 0) this.yaw += Math.PI * 2;
        
        // EXTREME PITCH RANDOMNESS
        this.pitch += (Math.random() - 0.5) * 0.2;  // INCREASED from 0.1
        this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
        
        this.tickCycle++;
        const phase = this.tickCycle % this.cfg.jumpEvery;
        
        // CONSTANT PACKET SPAM - Every tick sends multiple packets for extreme lag
        try {
            // Primary movement packet
            this.ws.send(this.buildPacket({ click: true }));
            this.packetsSent++;
            
            // Secondary spam packet - duplicate for extra lag
            if (phase % 2 === 0) {
                this.ws.send(this.buildPacket({ click: true }));
                this.packetsSent++;
            }
            
            // Jump spam on certain phases
            if (phase === 1 || phase === 5 || phase === 10) {
                this.ws.send(this.buildPacket({ jump: true }));
                this.packetsSent++;
            }
        } catch (e) {
            // Silently fail if connection drops
        }
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
        
        console.log(`[Bot #${this.id}] Connecting...`);
        
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
            console.log(`[Bot #${this.id}] ✅ Connected [${this.cfg.label}]`);
            
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
            console.log(`[Bot #${this.id}] 🎮 Joined, slot ${this.cfg.slot + 1}`);
            
            let timeLeft = this.customTimer;
            this._killTimer = setInterval(() => {
                if (--timeLeft <= 0) {
                    clearInterval(this._killTimer);
                    console.log(`[Bot #${this.id}] ⏰ Timer expired (${this.customTimer}s) - ${this.packetsSent} packets sent`);
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

        // INSTANT REDEPLOY - NO DELAY
        if (this.cycle && currentSession.isDeploying && currentSession.sessionId === this.sessionId) {
            this.redeployAttempts++;
            console.log(`[Bot #${this.id}] ⚡ INSTANT REDEPLOY #${this.redeployAttempts}`);
            
            // IMMEDIATE - 0ms delay for instant respawn
            if (currentSession.isDeploying && currentSession.sessionId === this.sessionId) {
                botIdCounter++;
                
                const newBot = new VoxiomBot(
                    botIdCounter,
                    this.url,
                    this.mode,
                    this.customTimer,
                    true,
                    this.sessionId,
                    1  // 1ms rejoin delay for instant redeploy
                );
                bots.set(newBot.id, newBot);
            }
        } else {
            const reason = !this.cycle ? 'cycle=false' : !currentSession.isDeploying ? 'isDeploying=false' : 'sessionId mismatch';
            console.log(`[Bot #${this.id}] ⛔ No redeploy (${reason})`);
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
    const botCycle = true; // FORCE TRUE FOR INFINITE REDEPLOY
    const botRejoinDelay = 1;  // FORCE 1ms FOR INSTANT REDEPLOY
    const sessionId = Date.now() + '_' + Math.random().toString(36);
    
    currentSession = {
        url,
        mode,
        active: true,
        sessionId,
        isDeploying: true,
        botConfig: {
            count: botCount,
            timer: botTimer,
            rejoinDelay: botRejoinDelay
        }
    };
    
    console.log(`   🔄 INFINITE REDEPLOY MODE ENABLED`);
    console.log(`   Deploying: ${botCount} ${mode.toUpperCase()} bots`);
    console.log(`   Mode: ${MODES[mode].description}`);
    console.log(`   Tick Rate: ${MODES[mode].tickMs}ms | Heartbeat: ${MODES[mode].heartbeatMs}ms`);
    console.log(`   ⚡ INSTANT REDEPLOY: ${botRejoinDelay}ms`);
    console.log(`   Timer: ${botTimer}s`);
    console.log('='.repeat(50));
    
    for (let i = 0; i < botCount; i++) {
        setTimeout(() => {
            if (currentSession.sessionId === sessionId && currentSession.isDeploying) {
                botIdCounter++;
                new VoxiomBot(
                    botIdCounter,
                    url,
                    mode,
                    botTimer,
                    botCycle,
                    sessionId,
                    botRejoinDelay
                );
            }
        }, i * 100);
    }
    
    res.json({
        success: true,
        message: `🔄 INFINITE INSTANT REDEPLOY: ${botCount} bot(s) deploying indefinitely in ${MODES[mode].label}`,
        deployed: botCount,
        sessionId: sessionId,
        isDeploying: true,
        mode: mode,
        tickRate: MODES[mode].tickMs,
        rejoinDelay: botRejoinDelay
    });
});

app.post('/api/clear-url', (req, res) => {
    console.log(`🧹 CLEAR URL - Terminating infinite redeploy`);
    currentSession.active = false;
    currentSession.isDeploying = false;
    currentSession.sessionId = null;
    currentSession.url = null;
    
    const killed = bots.size;
    bots.forEach(bot => bot.disconnect());
    bots.clear();
    
    console.log(`   Killed ${killed} bots`);
    console.log('='.repeat(50));
    
    res.json({ success: true, killed, message: '✅ All bots stopped. Infinite redeploy DISABLED.' });
});

app.post('/api/kill-all', (req, res) => {
    console.log(`💀 KILL ALL - Terminating infinite redeploy`);
    currentSession.active = false;
    currentSession.isDeploying = false;
    currentSession.sessionId = null;
    
    const killed = bots.size;
    bots.forEach(bot => bot.disconnect());
    bots.clear();
    
    console.log(`   Killed ${killed} bots`);
    console.log('='.repeat(50));
    
    res.json({ success: true, killed, message: '✅ All bots terminated. Infinite redeploy DISABLED.' });
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
        return res.status(404).json({ success: false, error: 'Bot not found' });
    }
    found.disconnect();
    res.json({ success: true, killed: 1 });
});

app.get('/api/status', (req, res) => {
    const botArray = Array.from(bots.values());
    const activeBots = botArray.filter(b => b.alive);
    const totalPackets = botArray.reduce((sum, bot) => sum + bot.packetsSent, 0);
    
    res.json({
        success: true,
        active: activeBots.length,
        total: botArray.length,
        totalDeployed: botIdCounter,
        totalPackets: totalPackets,
        packetsPerSecond: (totalPackets / (process.uptime() || 1)).toFixed(2),
        currentUrl: currentSession.url,
        currentMode: currentSession.mode,
        sessionActive: currentSession.active,
        infiniteRedeployActive: currentSession.isDeploying,
        sessionId: currentSession.sessionId,
        bots: activeBots.map(bot => ({
            id: bot.id,
            mode: bot.mode,
            alive: bot.alive,
            cycle: bot.cycle,
            timer: bot.customTimer,
            redeployAttempts: bot.redeployAttempts,
            packetsSent: bot.packetsSent
        }))
    });
});

app.get('/api/health', (req, res) => {
    const activeBots = Array.from(bots.values()).filter(b => b.alive).length;
    const mem = process.memoryUsage();
    const totalPackets = Array.from(bots.values()).reduce((sum, bot) => sum + bot.packetsSent, 0);
    
    res.json({
        status: 'ok',
        activeBots: activeBots,
        totalBots: bots.size,
        totalPackets: totalPackets,
        memoryMB: (mem.heapUsed / 1024 / 1024).toFixed(1),
        uptime: process.uptime(),
        infiniteRedeployActive: currentSession.isDeploying
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
    console.log(`🎮 MODES:`);
    console.log(`   - LAG: 100 packets/sec (10ms tick) - EXTREME SPAM`);
    console.log(`   - PILLAR: Slot blocking + jumping (25ms tick)`);
    console.log(`   - DIG: Dig attack mode (50ms tick)`);
    console.log(`♾️ INFINITE INSTANT REDEPLOY: 1ms respawn on death`);
    console.log(`💾 Lightweight mode: Optimized memory/CPU\n`);
});

// Simple stats logger (every 10 seconds)
setInterval(() => {
    const active = Array.from(bots.values()).filter(b => b.alive).length;
    const mem = process.memoryUsage();
    const totalPackets = Array.from(bots.values()).reduce((sum, bot) => sum + bot.packetsSent, 0);
    const redeployStatus = currentSession.isDeploying ? '🔄 INFINITE' : '⛔ STOPPED';
    if (bots.size > 0) {
        console.log(`📊 Active: ${active}/${bots.size} | Packets: ${totalPackets.toLocaleString()} | Memory: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB | ${redeployStatus} | Mode: ${currentSession.mode}`);
    }
}, 10000);

// Graceful shutdown
let shuttingDown = false;
function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n🛑 Shutting down...');
    currentSession.isDeploying = false;
    for (const bot of bots.values()) bot.disconnect();
    bots.clear();
    setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => console.error('❌', err.message));
process.on('unhandledRejection', (reason) => console.error('❌', reason));
