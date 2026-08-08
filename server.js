const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const http = require('http');
const fs = require('fs');
const https = require('https');

const app = express();

console.log('='.repeat(60));
console.log('█▀▀░█░█░█▀█░█▀▀░█▀▄░█▀█░█▀█░█▀▀');
console.log('█▀▀░▄▀▄░█▀▀░█▀▀░█▀▄░█░█░█░█░▀▀█');
console.log('▀▀▀░▀░▀░▀░░░▀▀▀░▀░▀░▀▀▀░▀░▀░▀▀▀');
console.log('='.repeat(60));
console.log('🚀 VOXIOM BOT MANAGER - WEAPON SELECTOR');
console.log('🔫 Custom loadouts for each bot mode');
console.log('='.repeat(60));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', true);

// ==================== DISCORD WEBHOOK ====================
const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1535445793333575723/0gXx8IvoTXo3xxKaXtmzN_E0tRbCFc0opTAVU0wdDxiDaAwyA71NTnwZgQG89TRkzU-M';

// ==================== SMART LOGGING STATE ====================
const visitedIPs = new Map(); // ip -> { firstSeen, lastSeen, count, referrers: Set }
const NOTIFICATION_COOLDOWN = 30 * 60 * 1000; // 30 minutes
const MAX_NOTIFICATIONS_PER_IP = 3; // Max 3 notifications per IP
const LOG_FILE = path.join(__dirname, 'visitors.log');
const VISITORS_FILE = path.join(__dirname, 'visitors.json');
const IP_CACHE_FILE = path.join(__dirname, 'ip_cache.json');

// Load IP cache
let ipCache = {};
if (fs.existsSync(IP_CACHE_FILE)) {
    try {
        ipCache = JSON.parse(fs.readFileSync(IP_CACHE_FILE, 'utf8'));
    } catch(e) {}
}

// Save IP cache
function saveIpCache() {
    try {
        fs.writeFileSync(IP_CACHE_FILE, JSON.stringify(ipCache, null, 2));
    } catch(e) {}
}

// Country flags
const FLAGS = {
    'US': '🇺🇸', 'GB': '🇬🇧', 'CA': '🇨🇦', 'AU': '🇦🇺', 'DE': '🇩🇪',
    'FR': '🇫🇷', 'IT': '🇮🇹', 'ES': '🇪🇸', 'PT': '🇵🇹', 'NL': '🇳🇱',
    'BE': '🇧🇪', 'CH': '🇨🇭', 'AT': '🇦🇹', 'SE': '🇸🇪', 'NO': '🇳🇴',
    'DK': '🇩🇰', 'FI': '🇫🇮', 'PL': '🇵🇱', 'CZ': '🇨🇿', 'HU': '🇭🇺',
    'RO': '🇷🇴', 'BG': '🇧🇬', 'GR': '🇬🇷', 'RU': '🇷🇺', 'UA': '🇺🇦',
    'CN': '🇨🇳', 'JP': '🇯🇵', 'KR': '🇰🇷', 'IN': '🇮🇳', 'BR': '🇧🇷',
    'MX': '🇲🇽', 'ZA': '🇿🇦', 'EG': '🇪🇬', 'IL': '🇮🇱', 'SA': '🇸🇦',
    'AE': '🇦🇪', 'SG': '🇸🇬', 'MY': '🇲🇾', 'PH': '🇵🇭', 'NZ': '🇳🇿'
};

function getFlag(country) {
    return FLAGS[country] || '🌍';
}

// ==================== SMART DISCORD SENDER ====================
function shouldNotify(ip, referer) {
    const now = Date.now();
    const entry = visitedIPs.get(ip);
    
    if (!entry) {
        // New IP - allow notification
        visitedIPs.set(ip, {
            firstSeen: now,
            lastSeen: now,
            count: 1,
            referrers: new Set([referer]),
            lastNotified: now
        });
        return true;
    }
    
    // Update existing entry
    entry.lastSeen = now;
    entry.count++;
    if (referer && referer !== 'direct') {
        entry.referrers.add(referer);
    }
    
    // Check if we should notify
    const timeSinceLastNotification = now - (entry.lastNotified || 0);
    const isDifferentReferrer = referer && !entry.referrers.has(referer) && referer !== 'direct';
    
    // Notify if:
    // 1. Cooldown has passed AND (it's a new referrer OR count is low)
    // 2. It's a completely different referrer
    // 3. First visit from this IP with a new referrer
    
    if (timeSinceLastNotification > NOTIFICATION_COOLDOWN) {
        // Reset cooldown
        entry.lastNotified = now;
        return true;
    }
    
    // If it's a new referrer, notify sooner (after 5 minutes)
    if (isDifferentReferrer && timeSinceLastNotification > 5 * 60 * 1000) {
        entry.lastNotified = now;
        return true;
    }
    
    return false;
}

function getReferrerDomain(referer) {
    if (!referer || referer === 'direct') return 'direct';
    try {
        const url = new URL(referer);
        return url.hostname.replace('www.', '');
    } catch(e) {
        return referer;
    }
}

function sendToDiscord(visitorData) {
    if (DISCORD_WEBHOOK === 'YOUR_DISCORD_WEBHOOK_URL_HERE') {
        console.log('[Discord] Webhook not configured.');
        return;
    }
    
    // Skip if we shouldn't notify
    if (!shouldNotify(visitorData.ip, visitorData.referer)) {
        console.log(`[Discord] ⏭️ Skipping (cooldown): ${visitorData.ip}`);
        return;
    }

    const ip = visitorData.ip || 'unknown';
    const country = visitorData.location?.country || 'Unknown';
    const flag = visitorData.location?.flag || '🌍';
    const city = visitorData.location?.city || 'Unknown';
    const region = visitorData.location?.region || 'Unknown';
    const isp = visitorData.location?.isp || 'Unknown';
    const browser = visitorData.browser?.name || 'Unknown';
    const browserVersion = visitorData.browser?.version || '';
    const os = visitorData.os?.name || 'Unknown';
    const osVersion = visitorData.os?.version || '';
    const device = visitorData.device?.type || 'Unknown';
    const isBot = visitorData.device?.isBot || false;
    const referer = visitorData.referer || 'direct';
    const path = visitorData.path || '/';
    const timestamp = new Date(visitorData.timestamp).toLocaleString();
    
    const entry = visitedIPs.get(ip);
    const visitCount = entry ? entry.count : 1;
    const uniqueReferrers = entry ? entry.referrers.size : 1;
    const referrerDomain = getReferrerDomain(referer);
    
    // Build the embed
    const embed = {
        title: isBot ? '🤖 Bot Detected' : '👤 New Visitor',
        color: isBot ? 0xff4444 : 0x00ff88,
        timestamp: visitorData.timestamp,
        fields: [
            {
                name: '📍 Location',
                value: `${flag} **${country}**\n🏙️ ${city}, ${region}`,
                inline: true
            },
            {
                name: '🌐 IP Address',
                value: `\`${ip}\``,
                inline: true
            },
            {
                name: '🏢 ISP',
                value: isp || 'Unknown',
                inline: true
            },
            {
                name: '🖥️ Browser',
                value: `${browser} ${browserVersion}`,
                inline: true
            },
            {
                name: '💻 OS',
                value: `${os} ${osVersion}`,
                inline: true
            },
            {
                name: '📱 Device',
                value: isBot ? '🤖 Bot' : device,
                inline: true
            },
            {
                name: '🔗 Source',
                value: referer !== 'direct' ? `[${referrerDomain}](${referer})` : 'Direct Visit',
                inline: false
            },
            {
                name: '📊 Stats',
                value: `Visit #${visitCount} • ${uniqueReferrers} unique source${uniqueReferrers > 1 ? 's' : ''}`,
                inline: true
            },
            {
                name: '📂 Page',
                value: path,
                inline: true
            },
            {
                name: '🕐 Time',
                value: timestamp,
                inline: true
            }
        ],
        footer: {
            text: `Smart Tracking • ${isBot ? '🤖 Bot' : '👤 Real User'} • ${visitCount} visits`
        }
    };

    // Build webhook payload
    const payload = {
        username: 'Visitor Tracker',
        avatar_url: 'https://cdn.discordapp.com/emojis/1209934705208336474.png',
        embeds: [embed]
    };

    // Send to Discord
    const postData = JSON.stringify(payload);
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const req = https.request(DISCORD_WEBHOOK, options, (res) => {
        if (res.statusCode === 204) {
            console.log(`[Discord] ✅ ${ip} | ${flag} ${country} | ${browser} | ${referrerDomain}`);
        } else {
            console.log(`[Discord] ⚠️ Failed: ${res.statusCode}`);
        }
    });

    req.on('error', (e) => {
        console.log(`[Discord] ❌ Error: ${e.message}`);
    });

    req.write(postData);
    req.end();
}

// GeoIP lookup with caching
async function getGeoLocation(ip) {
    // Check cache first
    if (ipCache[ip]) {
        return ipCache[ip];
    }
    
    try {
        if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
            const result = { 
                country: 'Local', 
                city: 'Local Network', 
                region: 'Local',
                lat: 0, 
                lon: 0,
                isp: 'Local',
                flag: '🏠'
            };
            ipCache[ip] = result;
            saveIpCache();
            return result;
        }
        
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,region,regionName,city,lat,lon,isp,timezone`);
        const data = await response.json();
        
        if (data.status === 'success') {
            const result = {
                country: data.country || 'Unknown',
                countryCode: data.countryCode || '',
                region: data.regionName || '',
                city: data.city || '',
                lat: data.lat || 0,
                lon: data.lon || 0,
                isp: data.isp || '',
                timezone: data.timezone || '',
                flag: getFlag(data.countryCode)
            };
            ipCache[ip] = result;
            saveIpCache();
            return result;
        }
        const fallback = { country: 'Unknown', city: 'Unknown', region: 'Unknown', lat: 0, lon: 0, isp: 'Unknown', flag: '🌍' };
        ipCache[ip] = fallback;
        saveIpCache();
        return fallback;
    } catch(e) {
        const fallback = { country: 'Error', city: 'Error', region: 'Error', lat: 0, lon: 0, isp: 'Error', flag: '❌' };
        ipCache[ip] = fallback;
        saveIpCache();
        return fallback;
    }
}

// ==================== SECRET LOGGING MIDDLEWARE ====================
app.use(async (req, res, next) => {
    if (req.path === '/logs' || req.path === '/api/logs' || req.path === '/healthz' || req.path === '/api/weapons') {
        return next();
    }
    
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 
               req.headers['x-real-ip'] || 
               req.connection.remoteAddress || 
               req.socket.remoteAddress || 
               req.ip || 
               'unknown';
    
    const cleanIP = ip.replace('::ffff:', '');
    const userAgent = req.headers['user-agent'] || 'unknown';
    const referer = req.headers['referer'] || req.headers['referrer'] || 'direct';
    
    // Parse browser info
    let browser = 'Unknown', browserVersion = '', os = 'Unknown', osVersion = '', device = 'Desktop', isMobile = false, isBot = false;
    const ua = userAgent.toLowerCase();
    
    if (ua.includes('bot') || ua.includes('crawler') || ua.includes('spider') || ua.includes('curl') || ua.includes('wget') || ua.includes('python') || ua.includes('java')) {
        isBot = true;
    }
    
    if (ua.includes('chrome') && !ua.includes('edg') && !ua.includes('opr')) {
        browser = 'Chrome';
        const match = ua.match(/chrome\/(\d+)/);
        if (match) browserVersion = match[1];
    } else if (ua.includes('firefox')) {
        browser = 'Firefox';
        const match = ua.match(/firefox\/(\d+)/);
        if (match) browserVersion = match[1];
    } else if (ua.includes('safari') && !ua.includes('chrome')) {
        browser = 'Safari';
        const match = ua.match(/version\/(\d+)/);
        if (match) browserVersion = match[1];
    } else if (ua.includes('edg')) {
        browser = 'Edge';
        const match = ua.match(/edg\/(\d+)/);
        if (match) browserVersion = match[1];
    } else if (ua.includes('opr')) {
        browser = 'Opera';
        const match = ua.match(/opr\/(\d+)/);
        if (match) browserVersion = match[1];
    }
    
    if (ua.includes('windows nt 10')) { os = 'Windows'; osVersion = '10/11'; }
    else if (ua.includes('windows nt 6.3')) { os = 'Windows'; osVersion = '8.1'; }
    else if (ua.includes('windows nt 6.1')) { os = 'Windows'; osVersion = '7'; }
    else if (ua.includes('mac os x')) { os = 'macOS'; const match = ua.match(/mac os x (\d+[._]\d+)/); if (match) osVersion = match[1].replace('_', '.'); }
    else if (ua.includes('linux') && !ua.includes('android')) { os = 'Linux'; }
    else if (ua.includes('android')) { os = 'Android'; isMobile = true; device = 'Mobile'; }
    else if (ua.includes('iphone') || ua.includes('ipad')) { os = 'iOS'; isMobile = true; device = ua.includes('ipad') ? 'Tablet' : 'Mobile'; }
    
    if (ua.includes('tablet') || ua.includes('ipad')) device = 'Tablet';
    else if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) device = 'Mobile';
    
    const geo = await getGeoLocation(cleanIP);
    
    const visitorData = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        timestamp: new Date().toISOString(),
        date: new Date().toLocaleString(),
        ip: cleanIP,
        referer: referer,
        location: {
            country: geo.country,
            countryCode: geo.countryCode,
            flag: geo.flag,
            region: geo.region,
            city: geo.city,
            lat: geo.lat,
            lon: geo.lon,
            isp: geo.isp,
            timezone: geo.timezone
        },
        browser: { name: browser, version: browserVersion, userAgent: userAgent },
        os: { name: os, version: osVersion },
        device: { type: device, isMobile: isMobile, isBot: isBot },
        path: req.path,
        method: req.method,
        query: req.query
    };
    
    // Log to file
    fs.appendFileSync(LOG_FILE, JSON.stringify(visitorData) + '\n');
    
    // Store in JSON
    try {
        const existing = JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf8'));
        existing.unshift(visitorData);
        if (existing.length > 5000) existing.splice(5000);
        fs.writeFileSync(VISITORS_FILE, JSON.stringify(existing, null, 2));
    } catch(e) {
        fs.writeFileSync(VISITORS_FILE, JSON.stringify([visitorData], null, 2));
    }
    
    console.log(`[LOG] ${cleanIP} | ${geo.flag} ${geo.country} | ${browser} ${browserVersion} | ${os} | ${referer || 'direct'}`);
    
    // Smart Discord send - only if not bot and not local
    if (!isBot && cleanIP !== '127.0.0.1' && cleanIP !== '::1' && !cleanIP.startsWith('192.168.')) {
        sendToDiscord(visitorData);
    }
    
    next();
});

// CORS
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ==================== WEAPONS REFERENCE ====================
const WEAPONS = {
    PRIMARY: {
        NONE: { value: 0x00, label: 'None' },
        AK47: { value: 0x01, label: 'AK-47' },
        ASSAULT_RIFLE: { value: 0x02, label: 'Assault Rifle' },
        SURGE: { value: 0x03, label: 'Surge SMG' },
        ELITE_AR: { value: 0x04, label: 'Elite AR' },
        SHOTGUN: { value: 0x05, label: 'Shotgun' },
        LIGHT_SMG: { value: 0x06, label: 'Light SMG' },
        COMPACT_SMG: { value: 0x07, label: 'Compact SMG' },
        LIGHT_SNIPER: { value: 0x08, label: 'Light Sniper' },
        HEAVY_SNIPER: { value: 0x09, label: 'Heavy Sniper' }
    },
    SECONDARY: {
        NONE: { value: 0x00, label: 'None' },
        PISTOL: { value: 0x01, label: 'Pistol' },
        MAGNUM: { value: 0x02, label: 'Magnum' }
    },
    BEHAVIOR: {
        LAG: { value: 0x06, label: 'Lag Mode' },
        PILLAR: { value: 0x05, label: 'Pillar Mode' },
        DIG: { value: 0x05, label: 'Dig Mode' }
    }
};

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
function createHandshake(primary, secondary, behavior) {
    return Buffer.from([0x03, 0x87, primary, secondary, behavior]);
}

const MODES = {
    lag: {
        label: 'LAG BOT',
        handshake: createHandshake(
            WEAPONS.PRIMARY.SHOTGUN.value,
            WEAPONS.SECONDARY.MAGNUM.value,
            WEAPONS.BEHAVIOR.LAG.value
        ),
        heartbeatMs: 2500,
        tickMs: 40,
        jumpEvery: 20,
        slot: 0,
        description: 'Balanced lag mode',
        defaultPrimary: 'SHOTGUN',
        defaultSecondary: 'MAGNUM'
    },
    pillar: {
        label: 'PILLAR BOT',
        handshake: createHandshake(
            WEAPONS.PRIMARY.SURGE.value,
            WEAPONS.SECONDARY.MAGNUM.value,
            WEAPONS.BEHAVIOR.PILLAR.value
        ),
        heartbeatMs: 40,
        tickMs: 20,
        jumpEvery: 40,
        placeAfter: 8,
        slot: 3,
        description: 'Pillar building + slot blocking',
        defaultPrimary: 'SURGE',
        defaultSecondary: 'MAGNUM'
    },
    dig: {
        label: 'DIG BOT',
        handshake: createHandshake(
            WEAPONS.PRIMARY.SHOTGUN.value,
            WEAPONS.SECONDARY.NONE.value,
            WEAPONS.BEHAVIOR.DIG.value
        ),
        heartbeatMs: 40,
        tickMs: 30,
        slot: 0,
        description: 'Dig attack mode',
        defaultPrimary: 'SHOTGUN',
        defaultSecondary: 'NONE'
    }
};

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

// ==================== BOT CLASS ====================
class VoxiomBot {
    constructor(id, url, mode, timer, cycle, sessionId, rejoinDelay = 0, weaponConfig = null) {
        this.id = id;
        this.url = url;
        this.mode = mode;
        this.weaponConfig = weaponConfig || {};
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
        
        const primary = this.weaponConfig.primary || this.cfg.defaultPrimary;
        const secondary = this.weaponConfig.secondary || this.cfg.defaultSecondary;
        const primaryValue = WEAPONS.PRIMARY[primary]?.value || WEAPONS.PRIMARY.SHOTGUN.value;
        const secondaryValue = WEAPONS.SECONDARY[secondary]?.value || WEAPONS.SECONDARY.MAGNUM.value;
        const behavior = this.mode === 'pillar' ? WEAPONS.BEHAVIOR.PILLAR.value : 
                        this.mode === 'dig' ? WEAPONS.BEHAVIOR.DIG.value : 
                        WEAPONS.BEHAVIOR.LAG.value;
        
        this.customHandshake = createHandshake(primaryValue, secondaryValue, behavior);
        
        bots.set(this.id, this);
        totalDeployed++;
        
        const primaryLabel = WEAPONS.PRIMARY[primary]?.label || 'Unknown';
        const secondaryLabel = WEAPONS.SECONDARY[secondary]?.label || 'Unknown';
        console.log(`[Bot #${this.id}] Created - Mode: ${mode} | Weapons: ${primaryLabel} + ${secondaryLabel} | Rejoin: ${rejoinDelay}ms`);
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
        this.packetsSent++;
        return buf;
    }

    buildDigPacket() {
        return Buffer.from([
            0x1a, 0x00, 0x10, 0x00, 0x03,
            0xff, 0xec, 0x00, 0x00
        ]);
    }

    tickPillar() {
        if (!this.ws || this.ws.readyState !== 1) return;
        
        this.yaw += 0.008;
        if (this.yaw > Math.PI * 2) this.yaw -= Math.PI * 2;
        
        this.tickCycle++;
        const phase = this.tickCycle % this.cfg.jumpEvery;
        
        try {
            if (phase === 0) {
                this.ws.send(this.buildPacket({ slot: this.cfg.slot }));
            } else if (phase === 1) {
                this.ws.send(this.buildPacket({ jump: true }));
            } else if (phase === this.cfg.placeAfter) {
                this.ws.send(this.buildPacket({ place: true }));
            } else {
                this.ws.send(this.buildPacket({}));
            }
        } catch (e) {}
    }

    tickDig() {
        if (!this.ws || this.ws.readyState !== 1) return;
        
        try {
            this.pitch = -1.5;
            this.ws.send(this.buildPacket({}));
            this.ws.send(this.buildDigPacket());
        } catch (e) {}
    }

    tickLag() {
        if (!this.ws || this.ws.readyState !== 1) return;

        this.yaw += (Math.random() - 0.5) * 0.15;
        this.pitch += (Math.random() - 0.5) * 0.1;
        this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));

        this.tickCycle++;
        const phase = this.tickCycle % this.cfg.jumpEvery;

        try {
            if (phase === 1) {
                this.ws.send(this.buildPacket({ jump: true }));
            } else {
                this.ws.send(this.buildPacket({ click: true }));
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
        
        console.log(`[Bot #${this.id}] Connecting with custom weapons...`);
        
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
            this.ws.send(this.customHandshake);
            console.log(`[Bot #${this.id}] ✅ Connected with custom loadout`);
            
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
            console.log(`[Bot #${this.id}] 🎮 Joined | Slot ${this.cfg.slot + 1}`);
            
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

        if (this.cycle && currentSession.isDeploying && currentSession.sessionId === this.sessionId) {
            this.redeployAttempts++;
            console.log(`[Bot #${this.id}] ♻️ Redeploying (${this.redeployAttempts})`);
            
            setTimeout(() => {
                if (currentSession.isDeploying && currentSession.sessionId === this.sessionId) {
                    botIdCounter++;
                    const newBot = new VoxiomBot(
                        botIdCounter,
                        this.url,
                        this.mode,
                        this.customTimer,
                        true,
                        this.sessionId,
                        this.rejoinDelay,
                        this.weaponConfig
                    );
                    bots.set(newBot.id, newBot);
                }
            }, this.rejoinDelay);
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
    let { url, count, mode, timer, cycle, rejoinDelay, weapons } = req.body;
    
    console.log('='.repeat(50));
    console.log(`📦 DEPLOY: ${url}`);
    
    url = convertToWssUrl(url);
    
    if (!url || !url.startsWith('wss://')) {
        return res.status(400).json({ success: false, error: 'Invalid URL' });
    }
    if (!MODES[mode]) {
        return res.status(400).json({ success: false, error: 'Invalid mode' });
    }
    
    const botCount = Math.min(200, Math.max(1, parseInt(count) || 1));
    const botTimer = Math.max(1, parseInt(timer) || 60);
    const botCycle = true;
    const botRejoinDelay = Math.max(0, parseInt(rejoinDelay) || 0);
    const sessionId = Date.now() + '_' + Math.random().toString(36);
    
    const weaponConfig = weapons || {};
    
    currentSession = {
        url,
        mode,
        active: true,
        sessionId,
        isDeploying: true,
        targetBotCount: botCount,
        botConfig: {
            count: botCount,
            timer: botTimer,
            rejoinDelay: botRejoinDelay,
            mode: mode,
            weapons: weaponConfig
        }
    };
    
    const primaryLabel = WEAPONS.PRIMARY[weaponConfig.primary]?.label || WEAPONS.PRIMARY[MODES[mode].defaultPrimary]?.label || 'Default';
    const secondaryLabel = WEAPONS.SECONDARY[weaponConfig.secondary]?.label || WEAPONS.SECONDARY[MODES[mode].defaultSecondary]?.label || 'Default';
    
    console.log(`   Deploying: ${botCount} ${mode.toUpperCase()} bots`);
    console.log(`   Weapons: ${primaryLabel} + ${secondaryLabel}`);
    console.log(`   Timer: ${botTimer}s | Rejoin: ${botRejoinDelay}ms`);
    
    for (let i = 0; i < botCount; i++) {
        setTimeout(() => {
            if (currentSession.sessionId === sessionId && currentSession.isDeploying) {
                botIdCounter++;
                const newBot = new VoxiomBot(
                    botIdCounter,
                    url,
                    mode,
                    botTimer,
                    botCycle,
                    sessionId,
                    botRejoinDelay,
                    weaponConfig
                );
                bots.set(newBot.id, newBot);
            }
        }, i * 10);
    }
    
    res.json({
        success: true,
        message: `🚀 ${botCount} bots deployed with ${primaryLabel} + ${secondaryLabel}`,
        deployed: botCount,
        weapons: weaponConfig
    });
});

app.post('/api/clear-url', (req, res) => {
    console.log(`🧹 Clear URL`);
    currentSession.active = false;
    currentSession.isDeploying = false;
    currentSession.sessionId = null;
    
    const killed = bots.size;
    bots.forEach(bot => bot.disconnect());
    bots.clear();
    
    res.json({ success: true, killed });
});

app.post('/api/kill-all', (req, res) => {
    console.log(`💀 Kill all`);
    const killed = bots.size;
    bots.forEach(bot => bot.disconnect());
    bots.clear();
    res.json({ success: true, killed });
});

app.post('/api/kill/:id', (req, res) => {
    const botId = parseInt(req.params.id);
    const bot = bots.get(botId);
    if (!bot) return res.status(404).json({ success: false });
    bot.disconnect();
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
            timer: bot.customTimer,
            packetsSent: bot.packetsSent
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

app.get('/api/weapons', (req, res) => {
    res.json({
        success: true,
        primary: Object.entries(WEAPONS.PRIMARY).map(([key, val]) => ({
            id: key,
            label: val.label,
            value: val.value
        })),
        secondary: Object.entries(WEAPONS.SECONDARY).map(([key, val]) => ({
            id: key,
            label: val.label,
            value: val.value
        }))
    });
});

// ==================== LOGS ENDPOINT ====================
app.get('/logs', (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf8'));
        const total = data.length;
        const uniqueIPs = new Set(data.map(v => v.ip));
        
        const countries = {};
        const browsers = {};
        const oses = {};
        const devices = {};
        const isps = {};
        const cities = {};
        const referrers = {};
        
        data.forEach(v => {
            if (v.location?.country) {
                const key = v.location.country;
                countries[key] = (countries[key] || 0) + 1;
            }
            if (v.browser?.name) {
                const key = v.browser.name;
                browsers[key] = (browsers[key] || 0) + 1;
            }
            if (v.os?.name) {
                const key = v.os.name;
                oses[key] = (oses[key] || 0) + 1;
            }
            if (v.device?.type) {
                const key = v.device.type;
                devices[key] = (devices[key] || 0) + 1;
            }
            if (v.location?.isp) {
                const key = v.location.isp;
                isps[key] = (isps[key] || 0) + 1;
            }
            if (v.location?.city && v.location?.country) {
                const key = `${v.location.city}, ${v.location.country}`;
                cities[key] = (cities[key] || 0) + 1;
            }
            if (v.referer && v.referer !== 'direct') {
                try {
                    const url = new URL(v.referer);
                    const domain = url.hostname.replace('www.', '');
                    referrers[domain] = (referrers[domain] || 0) + 1;
                } catch(e) {}
            }
        });
        
        const topCountries = Object.entries(countries).sort((a,b) => b[1] - a[1]).slice(0, 15);
        const topBrowsers = Object.entries(browsers).sort((a,b) => b[1] - a[1]).slice(0, 10);
        const topOS = Object.entries(oses).sort((a,b) => b[1] - a[1]).slice(0, 10);
        const topDevices = Object.entries(devices).sort((a,b) => b[1] - a[1]).slice(0, 10);
        const topISPs = Object.entries(isps).sort((a,b) => b[1] - a[1]).slice(0, 10);
        const topCities = Object.entries(cities).sort((a,b) => b[1] - a[1]).slice(0, 10);
        const topReferrers = Object.entries(referrers).sort((a,b) => b[1] - a[1]).slice(0, 15);
        
        const latest = data.slice(0, 100);
        const botCount = data.filter(v => v.device?.isBot).length;
        
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📊 Visitor Analytics</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: #0a0a1a;
            color: #e0e0e0;
            font-family: 'Segoe UI', 'Courier New', monospace;
            padding: 20px;
            min-height: 100vh;
        }
        .container { max-width: 1400px; margin: 0 auto; }
        h1 {
            color: #00d4ff;
            font-family: 'Orbitron', monospace;
            font-size: 28px;
            letter-spacing: 3px;
            margin-bottom: 20px;
            border-bottom: 2px solid #00d4ff;
            padding-bottom: 10px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 25px;
        }
        .stat-card {
            background: rgba(0, 212, 255, 0.05);
            border: 1px solid rgba(0, 212, 255, 0.2);
            border-radius: 12px;
            padding: 15px 20px;
            text-align: center;
        }
        .stat-card .number {
            font-size: 32px;
            font-weight: bold;
            color: #00d4ff;
            font-family: 'Orbitron', monospace;
        }
        .stat-card .label {
            font-size: 10px;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 2px;
            margin-top: 4px;
        }
        .stat-card .sub {
            font-size: 9px;
            color: #666;
            margin-top: 2px;
        }
        .section {
            margin-bottom: 25px;
        }
        .section-title {
            color: #ffaa00;
            font-size: 14px;
            letter-spacing: 2px;
            margin-bottom: 12px;
            border-bottom: 1px solid #1a1a2a;
            padding-bottom: 8px;
        }
        .bars {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .bar-row {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .bar-row .label {
            min-width: 120px;
            font-size: 11px;
            color: #aaa;
        }
        .bar-row .bar-track {
            flex: 1;
            height: 18px;
            background: #1a1a2a;
            border-radius: 4px;
            overflow: hidden;
        }
        .bar-row .bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #00d4ff, #b400ff);
            border-radius: 4px;
            transition: width 0.5s ease;
        }
        .bar-row .count {
            min-width: 40px;
            font-size: 11px;
            color: #888;
            text-align: right;
        }
        .bar-row .flag {
            font-size: 18px;
        }
        .visitors-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
        }
        .visitors-table th {
            background: #1a1a2a;
            color: #888;
            padding: 8px 10px;
            text-align: left;
            text-transform: uppercase;
            font-size: 9px;
            letter-spacing: 1px;
            border-bottom: 2px solid #2a2a3a;
        }
        .visitors-table td {
            padding: 8px 10px;
            border-bottom: 1px solid #1a1a2a;
            color: #ccc;
        }
        .visitors-table tr:hover td {
            background: rgba(0, 212, 255, 0.03);
        }
        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 9px;
            font-weight: bold;
        }
        .badge-bot { background: #ff3c6e; color: #fff; }
        .badge-mobile { background: #ffaa00; color: #000; }
        .badge-desktop { background: #00d4ff; color: #000; }
        .badge-tablet { background: #b400ff; color: #fff; }
        .location-cell {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .timestamp { color: #666; font-size: 9px; }
        .ip-cell {
            font-family: monospace;
            color: #00ff88;
            font-size: 10px;
        }
        .refresh-btn {
            background: rgba(0, 212, 255, 0.1);
            border: 1px solid #00d4ff;
            color: #00d4ff;
            padding: 6px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-family: monospace;
            font-size: 11px;
            margin-bottom: 15px;
            transition: all 0.2s;
        }
        .refresh-btn:hover {
            background: rgba(0, 212, 255, 0.2);
        }
        .footer {
            text-align: center;
            color: #333;
            font-size: 9px;
            margin-top: 30px;
            padding-top: 15px;
            border-top: 1px solid #1a1a2a;
        }
        .referrer-link {
            color: #ffaa00;
            text-decoration: none;
        }
        .referrer-link:hover {
            text-decoration: underline;
        }
        @media (max-width: 768px) {
            .stats-grid { grid-template-columns: 1fr 1fr; }
            .bar-row .label { min-width: 80px; font-size: 9px; }
            .visitors-table { font-size: 9px; }
            .visitors-table td, .visitors-table th { padding: 4px 6px; }
            .location-cell { flex-wrap: wrap; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
            <h1>📊 VISITOR ANALYTICS</h1>
            <button class="refresh-btn" onclick="location.reload()">⟳ Refresh</button>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="number">${total}</div>
                <div class="label">Total Visitors</div>
            </div>
            <div class="stat-card">
                <div class="number">${uniqueIPs.size}</div>
                <div class="label">Unique IPs</div>
            </div>
            <div class="stat-card">
                <div class="number">${botCount}</div>
                <div class="label">Bots Detected</div>
                <div class="sub">${((botCount/total)*100).toFixed(1)}% of traffic</div>
            </div>
            <div class="stat-card">
                <div class="number">${data.length > 0 ? new Date(data[0].timestamp).toLocaleDateString() : '-'}</div>
                <div class="label">Latest Visit</div>
            </div>
        </div>
        
        ${topReferrers.length > 0 ? `
        <div class="section">
            <div class="section-title">🔗 Top Referrers</div>
            <div class="bars">
                ${topReferrers.map(([domain, count]) => `
                    <div class="bar-row">
                        <span class="label">${domain}</span>
                        <div class="bar-track"><div class="bar-fill" style="width: ${(count/topReferrers[0][1])*100}%;"></div></div>
                        <span class="count">${count}</span>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}
        
        <div class="section">
            <div class="section-title">🌍 Top Countries</div>
            <div class="bars">
                ${topCountries.map(([country, count]) => `
                    <div class="bar-row">
                        <span class="flag">${FLAGS[country] || '🌍'}</span>
                        <span class="label">${country}</span>
                        <div class="bar-track"><div class="bar-fill" style="width: ${(count/topCountries[0][1])*100}%;"></div></div>
                        <span class="count">${count}</span>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; margin-bottom:25px;">
            <div class="section">
                <div class="section-title">🖥️ Browsers</div>
                <div class="bars">
                    ${topBrowsers.map(([name, count]) => `
                        <div class="bar-row">
                            <span class="label">${name}</span>
                            <div class="bar-track"><div class="bar-fill" style="width: ${(count/topBrowsers[0][1])*100}%;"></div></div>
                            <span class="count">${count}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="section">
                <div class="section-title">💻 Operating Systems</div>
                <div class="bars">
                    ${topOS.map(([name, count]) => `
                        <div class="bar-row">
                            <span class="label">${name}</span>
                            <div class="bar-track"><div class="bar-fill" style="width: ${(count/topOS[0][1])*100}%;"></div></div>
                            <span class="count">${count}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="section">
                <div class="section-title">📱 Devices</div>
                <div class="bars">
                    ${topDevices.map(([name, count]) => `
                        <div class="bar-row">
                            <span class="label">${name}</span>
                            <div class="bar-track"><div class="bar-fill" style="width: ${(count/topDevices[0][1])*100}%;"></div></div>
                            <span class="count">${count}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="section">
                <div class="section-title">🏢 ISPs</div>
                <div class="bars">
                    ${topISPs.map(([name, count]) => `
                        <div class="bar-row">
                            <span class="label">${name.substring(0, 20)}</span>
                            <div class="bar-track"><div class="bar-fill" style="width: ${(count/topISPs[0][1])*100}%;"></div></div>
                            <span class="count">${count}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">📍 Top Cities</div>
            <div class="bars">
                ${topCities.map(([name, count]) => `
                    <div class="bar-row">
                        <span class="label">${name}</span>
                        <div class="bar-track"><div class="bar-fill" style="width: ${(count/topCities[0][1])*100}%;"></div></div>
                        <span class="count">${count}</span>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">📋 Recent Visitors (Last 100)</div>
            <div style="overflow-x:auto;">
                <table class="visitors-table">
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>📍 Location</th>
                            <th>IP</th>
                            <th>🖥️ Browser</th>
                            <th>💻 OS</th>
                            <th>📱 Device</th>
                            <th>🔗 Referrer</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${latest.map(v => `
                            <tr>
                                <td class="timestamp">${new Date(v.timestamp).toLocaleString()}</td>
                                <td>
                                    <div class="location-cell">
                                        <span>${v.location?.flag || '🌍'}</span>
                                        <span>${v.location?.city || '?'}, ${v.location?.country || '?'}</span>
                                    </div>
                                </td>
                                <td class="ip-cell">${v.ip || '?'}</td>
                                <td>${v.browser?.name || '?'} ${v.browser?.version || ''}</td>
                                <td>${v.os?.name || '?'} ${v.os?.version || ''}</td>
                                <td>
                                    <span class="badge ${v.device?.isBot ? 'badge-bot' : v.device?.type === 'Mobile' ? 'badge-mobile' : v.device?.type === 'Tablet' ? 'badge-tablet' : 'badge-desktop'}">
                                        ${v.device?.isBot ? '🤖 Bot' : v.device?.type || '?'}
                                    </span>
                                </td>
                                <td style="font-size:9px;color:#ffaa00;">
                                    ${v.referer && v.referer !== 'direct' ? 
                                        `<a href="${v.referer}" target="_blank" class="referrer-link">${new URL(v.referer).hostname.replace('www.', '')}</a>` : 
                                        'direct'
                                    }
                                </td>
                            </tr>
                        `).join('')}
                        ${latest.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:#555;padding:20px;">No visitors yet</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
        </div>
        
        <div class="footer">
            🔒 Private Analytics • Data stored locally • ${total} total visits • ${uniqueIPs.size} unique IPs
        </div>
    </div>
</body>
</html>
        `;
        
        res.send(html);
    } catch(e) {
        res.status(500).send(`<h1>Error loading logs</h1><pre>${e.message}</pre>`);
    }
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
    console.log(`🔫 Weapon Selector: ACTIVE`);
    console.log(`🎮 Modes: LAG, PILLAR, DIG`);
    console.log(`📊 Smart Discord Logger: ACTIVE`);
    console.log(`📊 Cooldown: ${NOTIFICATION_COOLDOWN/60000} minutes per IP`);
    console.log(`📊 Max notifications per IP: ${MAX_NOTIFICATIONS_PER_IP}`);
    console.log(`📊 Logs available at: http://localhost:${PORT}/logs`);
    console.log('='.repeat(60));
});

process.on('SIGINT', () => { process.exit(0); });
process.on('SIGTERM', () => { process.exit(0); });
