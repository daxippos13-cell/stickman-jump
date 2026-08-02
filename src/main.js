import * as THREE from 'three';

// --- DINO-STYLE DAYTIME WORLD CONFIGURATION ---
const CONFIG = {
    GRAVITY: -80,
    JUMP_FORCE: 32,
    DOUBLE_JUMP_MULT: 0.8,
    GROUND_Y: -2,
    PLAYER_X: -8,
    INITIAL_SPEED: 30,
    MAX_SPEED: 80,
    SPEED_INC: 2.0,
    COLORS: {
        SKY: 0xe8f4f8,
        GROUND: 0xf3e5ab,
        TRACK_LINE: 0xd4c483,
        CACTUS: 0x27ae60,
        CACTUS_DARK: 0x1e8449,
        BARRICADE_POST: 0x636e72,
        BARRICADE_ORANGE: 0xe17055,
        BARRICADE_WHITE: 0xffffff,
        STICKMAN_SHIRT: 0x0984e3,
        STICKMAN_PANTS: 0x2d3436,
        STICKMAN_HEAD: 0xffdbac
    }
};

// --- PROFANITY & BAD WORD FILTER ---
const BAD_WORDS = [
    "FUCK", "SHIT", "BITCH", "CUNT", "DICK", "COCK", "PUSSY", "ASSHOLE", "NIGG", "FAG", 
    "SLUT", "WHORE", "RETARD", "BASTARD", "WANKER", "TWAT", "PISS", "PENIS", "VAGINA", 
    "BOOBS", "PORN", "SEX", "HITLER", "NAZI", "KYS", "FUK", "FUC", "SH1T", "B1TCH", 
    "D1CK", "A55", "ASS"
];

function containsBadWord(name) {
    const upper = (name || "").toUpperCase().replace(/[^A-Z0-9]/g, '');
    return BAD_WORDS.some(bad => upper.includes(bad));
}

// --- PERMANENT ACCOUNT MANAGER (WITH SAFE LOCALSTORAGE & UUID LINKING) ---
const AccountManager = {
    getUUID() {
        try {
            let uuid = localStorage.getItem('stickman_acc_uuid');
            if (!uuid) {
                uuid = 'acc_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
                localStorage.setItem('stickman_acc_uuid', uuid);
            }
            return uuid;
        } catch (e) {
            return 'acc_anon_' + Math.random().toString(36).substring(2, 8);
        }
    },
    getName() {
        try {
            let name = localStorage.getItem('stickman_callsign');
            if (!name) {
                name = 'RUNNER_' + this.getUUID().substring(4, 8).toUpperCase();
                localStorage.setItem('stickman_callsign', name);
            }
            return name;
        } catch (e) {
            return 'RUNNER';
        }
    },
    setName(newName) {
        const clean = (newName || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').substring(0, 12);
        if (!clean) throw new Error("NAME CANNOT BE EMPTY");
        if (containsBadWord(clean)) {
            throw new Error("PROFANITY DETECTED: CHOOSE A CLEAN NAME!");
        }
        try {
            localStorage.setItem('stickman_callsign', clean);
        } catch (e) {}
        return clean;
    }
};

// --- ROBUST ANTI-CHEAT SCORE VAULT ---
const ScoreVault = {
    _val: 0,
    _token: '',
    _startTime: 0,
    _runId: '',
    reset() {
        this._val = 0;
        this._startTime = Date.now();
        this._runId = Math.random().toString(36).substring(2, 10);
        this._updateToken();
    },
    add(val) {
        if (this.verify()) {
            this._val += val;
            this._updateToken();
        }
    },
    get() {
        if (!this.verify()) return 0;
        return Math.floor(this._val);
    },
    _updateToken() {
        const intVal = Math.floor(this._val * 10);
        this._token = `sec_${intVal ^ 0x5a5a5a5a}_${this._runId}`;
    },
    verify() {
        const expectedInt = Math.floor(this._val * 10);
        if (this._token !== `sec_${expectedInt ^ 0x5a5a5a5a}_${this._runId}`) {
            console.warn("SECURITY ALERT: Score memory tamper detected.");
            return false;
        }
        const elapsedSec = (Date.now() - this._startTime) / 1000;
        if (this._val > (elapsedSec * 25 + 300)) {
            console.warn("SECURITY ALERT: Impossible velocity detected.");
            return false;
        }
        return true;
    },
    generateToken() {
        if (!this.verify()) return null;
        const scoreVal = Math.floor(this._val);
        const myUUID = AccountManager.getUUID();
        const payload = `${myUUID}:${scoreVal}:${this._runId}:${this._startTime}`;
        let hash = 0;
        for (let i = 0; i < payload.length; i++) {
            hash = ((hash << 5) - hash) + payload.charCodeAt(i);
            hash |= 0;
        }
        return btoa(`${payload}:${Math.abs(hash).toString(16)}`);
    }
};

// --- ONLINE LEADERBOARD & ACCOUNT SYNC CLIENT (100% PERMANENT / CLOUDFLARE SSL) ---
const LEADERBOARD_API_URL = "https://api.restful-api.dev/objects/ff8081819f7e10ae019fc3a134d163da";

const LeaderboardClient = {
    async fetchLeaderboard() {
        try {
            const response = await fetch(LEADERBOARD_API_URL, { 
                cache: "no-store",
                headers: { "Accept": "application/json" }
            });
            if (!response.ok) throw new Error("Network response was not ok");
            const res = await response.json();
            const list = (res && res.data && res.data.leaderboard) ? res.data.leaderboard : [];
            return list.sort((a, b) => b.score - a.score).slice(0, 20);
        } catch (err) {
            console.warn("Leaderboard offline fallback:", err);
            return [];
        }
    },

    // Auto-sync score to global leaderboard: recognizes user by UUID OR Username!
    async syncScore(scoreVal, token) {
        if (!ScoreVault.verify() || !token) return { updated: false, msg: "SECURITY ERROR" };
        try {
            const response = await fetch(LEADERBOARD_API_URL, { 
                cache: "no-store",
                headers: { "Accept": "application/json" }
            });
            let res = { data: { leaderboard: [] } };
            if (response.ok) {
                res = await response.json();
            }
            const list = (res && res.data && res.data.leaderboard) ? res.data.leaderboard : [];
            const myUUID = AccountManager.getUUID();
            const myName = AccountManager.getName();
            const todayStr = new Date().toISOString().split('T')[0];

            // 1. Find existing account entry by UUID OR exact Username match
            const existingIndex = list.findIndex(item => 
                (item.uuid && item.uuid === myUUID) || 
                ((item.name || "").toUpperCase() === myName.toUpperCase())
            );

            let statusMsg = "✅ NEW ACCOUNT & RECORD SAVED!";
            if (existingIndex !== -1) {
                const oldRecord = list[existingIndex].score || 0;
                list[existingIndex].uuid = myUUID; // ensure permanent UUID link
                list[existingIndex].name = myName; // keep name updated
                
                if (scoreVal > oldRecord) {
                    list[existingIndex].score = scoreVal;
                    list[existingIndex].date = todayStr;
                    list[existingIndex].hash = token;
                    statusMsg = `🏆 RECORD AUTO-UPDATED! (BEAT OLD ${oldRecord})`;
                } else {
                    statusMsg = `ℹ️ ONLINE HIGH SCORE (${oldRecord}) IS HIGHER`;
                    return { updated: false, msg: statusMsg };
                }
            } else {
                list.push({
                    uuid: myUUID,
                    name: myName,
                    score: scoreVal,
                    date: todayStr,
                    hash: token
                });
            }

            const updatedList = list.sort((a, b) => b.score - a.score).slice(0, 30);

            const putResponse = await fetch(LEADERBOARD_API_URL, {
                method: "PUT",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({
                    name: "Stickman Leaderboard",
                    data: { leaderboard: updatedList }
                })
            });
            if (!putResponse.ok) throw new Error("Failed to save to Server");
            return { updated: true, msg: statusMsg };
        } catch (err) {
            console.warn("Score auto-sync offline mode:", err);
            try { localStorage.setItem('stickman_resonance_v2', scoreVal); } catch(e){}
            return { updated: true, msg: "✅ SAVED LOCALLY (OFFLINE MODE)" };
        }
    },

    // Validate and rename account (enforce profanity filter + uniqueness across all accounts!)
    async renameAccount(newName) {
        const cleanName = AccountManager.setName(newName);
        const myUUID = AccountManager.getUUID();
        try {
            const response = await fetch(LEADERBOARD_API_URL, { 
                cache: "no-store",
                headers: { "Accept": "application/json" }
            });
            let res = { data: { leaderboard: [] } };
            if (response.ok) {
                res = await response.json();
            }
            const list = (res && res.data && res.data.leaderboard) ? res.data.leaderboard : [];

            // Enforce Name Uniqueness! Another account cannot have the exact same name
            const duplicate = list.find(item => 
                (item.name || "").toUpperCase() === cleanName && 
                item.uuid && item.uuid !== myUUID
            );
            if (duplicate) {
                throw new Error("NAME ALREADY TAKEN BY ANOTHER RUNNER!");
            }

            // Update my entry on the leaderboard if it exists
            const myIndex = list.findIndex(item => 
                (item.uuid && item.uuid === myUUID) || 
                ((item.name || "").toUpperCase() === cleanName)
            );
            if (myIndex !== -1) {
                list[myIndex].uuid = myUUID;
                list[myIndex].name = cleanName;
                await fetch(LEADERBOARD_API_URL, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json", "Accept": "application/json" },
                    body: JSON.stringify({
                        name: "Stickman Leaderboard",
                        data: { leaderboard: list }
                    })
                });
            }
            return cleanName;
        } catch (err) {
            throw err;
        }
    },

    // Admin Tool: Remove all fake/seed bot accounts
    async removeAllBots() {
        const BOT_NAMES = ["NEON_PHANTOM", "GRID_RUNNER", "CYBER_NINJA", "SYNTH_WAVE", "ZERO_COOL"];
        try {
            const response = await fetch(LEADERBOARD_API_URL, { cache: "no-store", headers: { "Accept": "application/json" } });
            let res = { data: { leaderboard: [] } };
            if (response.ok) res = await response.json();
            const list = (res && res.data && res.data.leaderboard) ? res.data.leaderboard : [];
            const cleanList = list.filter(item => 
                item.hash !== "seed" && 
                !BOT_NAMES.includes((item.name || "").toUpperCase())
            );
            await fetch(LEADERBOARD_API_URL, {
                method: "PUT",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({
                    name: "Stickman Leaderboard",
                    data: { leaderboard: cleanList }
                })
            });
            return cleanList;
        } catch (err) {
            throw err;
        }
    },

    // Admin Tool: Delete a specific player by UUID or Name
    async deleteScore(targetId) {
        try {
            const response = await fetch(LEADERBOARD_API_URL, { cache: "no-store", headers: { "Accept": "application/json" } });
            let res = { data: { leaderboard: [] } };
            if (response.ok) res = await response.json();
            const list = (res && res.data && res.data.leaderboard) ? res.data.leaderboard : [];
            const cleanList = list.filter(item => 
                item.uuid !== targetId && 
                (item.name || "").toUpperCase() !== (targetId || "").toUpperCase()
            );
            await fetch(LEADERBOARD_API_URL, {
                method: "PUT",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({
                    name: "Stickman Leaderboard",
                    data: { leaderboard: cleanList }
                })
            });
            return cleanList;
        } catch (err) {
            throw err;
        }
    },

    // Admin Tool: Wipe the entire leaderboard clean
    async wipeLeaderboard() {
        try {
            await fetch(LEADERBOARD_API_URL, {
                method: "PUT",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({
                    name: "Stickman Leaderboard",
                    data: { leaderboard: [] }
                })
            });
            return [];
        } catch (err) {
            throw err;
        }
    }
};

// --- MACHINE STATE ---
let scene, camera, renderer, clock;
let playerGroup, playerParts = {}, playerTrail = [];
let obstacles = [], particles = [], backgroundElements = [];
let isPlaying = false, gameSpeed = CONFIG.INITIAL_SPEED;

// Physics & Input
let velocityY = 0, jumpCount = 0, isGrounded = true, isDucking = false;
let spawnTimer = 0, nextSpawnDelay = 1.0;

// Audio
let audioCtx, masterGain;

const ui = {
    score: document.getElementById('score-display'),
    highScore: document.getElementById('high-score-display'),
    mainMenu: document.getElementById('main-menu'),
    gameOver: document.getElementById('game-over'),
    finalScore: document.getElementById('final-score'),
    mobile: document.getElementById('mobile-controls'),
    leaderboardModal: document.getElementById('leaderboard-modal'),
    leaderboardList: document.getElementById('leaderboard-list'),
    leaderboardLoading: document.getElementById('leaderboard-loading'),
    renameModal: document.getElementById('rename-modal'),
    newNameInput: document.getElementById('new-name-input'),
    renameStatus: document.getElementById('rename-status'),
    menuAccountName: document.getElementById('menu-account-name'),
    gameoverAccountName: document.getElementById('gameover-account-name'),
    syncStatus: document.getElementById('sync-status')
};

let highScore = 0;
try {
    highScore = localStorage.getItem('stickman_resonance_v2') || 0;
} catch (e) {}
if (ui.highScore) ui.highScore.textContent = Math.floor(highScore).toString().padStart(5, '0');

function updateAccountBadgeUI() {
    const name = AccountManager.getName();
    if (ui.menuAccountName) ui.menuAccountName.textContent = name;
    if (ui.gameoverAccountName) ui.gameoverAccountName.textContent = name;
}
updateAccountBadgeUI();

init();
animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.COLORS.SKY);
    scene.fog = new THREE.FogExp2(CONFIG.COLORS.SKY, 0.008);

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 8, 35);
    camera.lookAt(10, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    document.body.appendChild(renderer.domElement);

    clock = new THREE.Clock();

    // Bright Daytime Outdoor Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambient);

    const hemi = new THREE.HemisphereLight(CONFIG.COLORS.SKY, CONFIG.COLORS.GROUND, 0.55);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(40, 80, 50);
    sun.castShadow = true;
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);

    createDesertTrack();
    createPlayer();
    setupControls();
    setupLeaderboardAndAccountUI();
    
    window.addEventListener('resize', onWindowResize);
    onWindowResize();
}

function createDesertTrack() {
    const size = 1000;
    const planeGeo = new THREE.PlaneGeometry(size, size);
    const planeMat = new THREE.MeshStandardMaterial({ 
        color: CONFIG.COLORS.GROUND,
        roughness: 0.9,
        metalness: 0.0
    });
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = CONFIG.GROUND_Y - 0.05;
    plane.receiveShadow = true;
    scene.add(plane);

    const grid = new THREE.GridHelper(size, 80, CONFIG.COLORS.TRACK_LINE, CONFIG.COLORS.TRACK_LINE);
    grid.position.y = CONFIG.GROUND_Y;
    scene.add(grid);
    scene.grid = grid;
}

function createPlayer() {
    playerGroup = new THREE.Group();
    playerGroup.position.set(CONFIG.PLAYER_X, CONFIG.GROUND_Y, 0);
    playerGroup.rotation.y = Math.PI / 2;

    const shirtMat = new THREE.MeshStandardMaterial({ color: CONFIG.COLORS.STICKMAN_SHIRT, roughness: 0.5 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: CONFIG.COLORS.STICKMAN_PANTS, roughness: 0.7 });
    const headMat = new THREE.MeshStandardMaterial({ color: CONFIG.COLORS.STICKMAN_HEAD, roughness: 0.4 });

    // Torso (Shirt)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.6), shirtMat);
    torso.position.y = 2.5;
    torso.castShadow = true;
    playerGroup.add(torso);
    playerParts.torso = torso;

    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.85), headMat);
    head.position.y = 3.9;
    head.castShadow = true;
    playerGroup.add(head);
    playerParts.head = head;

    const createLimb = (x, y, isArm) => {
        const w = 0.35, h = isArm ? 1.4 : 1.8, d = 0.35;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), isArm ? shirtMat : pantsMat);
        mesh.position.y = -h/2;
        mesh.castShadow = true;
        const pivot = new THREE.Group();
        pivot.position.set(x, y, 0);
        pivot.add(mesh);
        playerGroup.add(pivot);
        return pivot;
    };

    playerParts.lLeg = createLimb(-0.3, 1.8, false);
    playerParts.rLeg = createLimb(0.3, 1.8, false);
    playerParts.lArm = createLimb(-0.6, 3.2, true);
    playerParts.rArm = createLimb(0.6, 3.2, true);

    scene.add(playerGroup);
}

// --- MUTUALLY EXCLUSIVE JUMP & SLIDE CONTROLS ---
function jump() {
    // Cannot jump while sliding/ducking!
    if (isDucking) return;

    if (isGrounded) {
        velocityY = CONFIG.JUMP_FORCE;
        isGrounded = false;
        jumpCount = 1;
        createImpact(playerGroup.position.x, CONFIG.GROUND_Y, 0xbdc3c7);
        playBeep(640, 'sine', 0.1);
    } else if (jumpCount < 2) {
        velocityY = CONFIG.JUMP_FORCE * CONFIG.DOUBLE_JUMP_MULT;
        jumpCount = 2;
        createImpact(playerGroup.position.x, playerGroup.position.y, 0x0984e3);
        playBeep(880, 'sine', 0.1);
    }
}

function startDuck() {
    // If in the air and pressing duck/down, perform a fast-fall to the floor! Do not slide mid-air.
    if (!isGrounded) {
        velocityY = -CONFIG.JUMP_FORCE * 1.5;
        return;
    }
    // Only duck/slide when grounded on the floor!
    if (!isDucking && isGrounded) {
        isDucking = true;
        playBeep(350, 'sine', 0.08);
    }
}

function endDuck() { 
    isDucking = false; 
}

function setupControls() {
    document.addEventListener('keydown', (e) => {
        if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
            e.preventDefault();
        }
        if (!isPlaying && (e.code === 'Space' || e.code === 'Enter')) {
            const modalsHidden = ui.leaderboardModal.classList.contains('hidden') && ui.renameModal.classList.contains('hidden');
            if (modalsHidden && document.activeElement !== ui.newNameInput) {
                startGame();
            }
        }
        if (isPlaying) {
            if (e.code === 'Space' || e.code === 'ArrowUp') jump();
            if (e.code === 'ArrowDown') startDuck();
        }
    });
    document.addEventListener('keyup', (e) => {
        if (e.code === 'ArrowDown') endDuck();
    });

    document.getElementById('start-btn').onclick = startGame;
    document.getElementById('restart-btn').onclick = resetGame;

    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        ui.mobile.style.display = 'flex';
        const btnJump = document.getElementById('btn-jump');
        const btnDuck = document.getElementById('btn-duck');
        if (btnJump) {
            btnJump.addEventListener('touchstart', (e) => { e.preventDefault(); jump(); }, { passive: false });
            btnJump.addEventListener('pointerdown', (e) => { e.preventDefault(); jump(); });
        }
        if (btnDuck) {
            btnDuck.addEventListener('touchstart', (e) => { e.preventDefault(); startDuck(); }, { passive: false });
            btnDuck.addEventListener('touchend', (e) => { e.preventDefault(); endDuck(); }, { passive: false });
            btnDuck.addEventListener('pointerdown', (e) => { e.preventDefault(); startDuck(); });
            btnDuck.addEventListener('pointerup', (e) => { e.preventDefault(); endDuck(); });
        }
    }
}

function setupLeaderboardAndAccountUI() {
    let adminMode = false;
    try {
        adminMode = localStorage.getItem('stickman_admin_unlocked') === '1313';
    } catch(e) {}
    const adminPanel = document.getElementById('admin-panel');
    const adminStatus = document.getElementById('admin-status');

    const openLeaderboardModal = async () => {
        ui.leaderboardModal.classList.remove('hidden');
        if (adminPanel) adminPanel.classList.toggle('hidden', !adminMode);
        ui.leaderboardList.innerHTML = '';
        ui.leaderboardLoading.classList.remove('hidden');
        ui.leaderboardLoading.textContent = "LOADING RUNNERS...";

        const entries = await LeaderboardClient.fetchLeaderboard();
        ui.leaderboardLoading.classList.add('hidden');

        if (entries.length === 0) {
            ui.leaderboardList.innerHTML = '<div style="color: #636e72; padding: 20px;">NO RECORDED RUNS YET</div>';
            return;
        }

        entries.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'leaderboard-row' + (index < 3 ? ` rank-${index + 1}` : '');
            
            const rankSpan = document.createElement('span');
            rankSpan.className = 'rank-num';
            rankSpan.textContent = `#${index + 1}`;

            const nameSpan = document.createElement('span');
            nameSpan.className = 'player-name';
            nameSpan.textContent = item.name || 'RUNNER';

            const scoreSpan = document.createElement('span');
            scoreSpan.className = 'player-score';
            scoreSpan.textContent = Math.floor(item.score || 0).toString().padStart(5, '0');

            const dateSpan = document.createElement('span');
            dateSpan.className = 'player-date';
            dateSpan.textContent = item.date || '';

            row.appendChild(rankSpan);
            row.appendChild(nameSpan);
            row.appendChild(scoreSpan);
            row.appendChild(dateSpan);

            if (adminMode) {
                const delBtn = document.createElement('button');
                delBtn.className = 'delete-row-btn';
                delBtn.textContent = '✖';
                delBtn.title = 'Delete Player';
                delBtn.onclick = async (e) => {
                    e.stopPropagation();
                    delBtn.disabled = true;
                    delBtn.textContent = '...';
                    await LeaderboardClient.deleteScore(item.uuid || item.name);
                    openLeaderboardModal();
                };
                row.appendChild(delBtn);
            }

            ui.leaderboardList.appendChild(row);
        });
    };

    document.getElementById('menu-leaderboard-btn').onclick = openLeaderboardModal;
    document.getElementById('view-leaderboard-btn').onclick = openLeaderboardModal;
    document.getElementById('close-leaderboard-btn').onclick = () => {
        ui.leaderboardModal.classList.add('hidden');
    };

    const lbTitle = document.getElementById('leaderboard-title');
    if (lbTitle) {
        let clickCount = 0;
        let clickTimer = null;
        lbTitle.style.cursor = "pointer";
        lbTitle.onclick = () => {
            clickCount++;
            if (clickTimer) clearTimeout(clickTimer);
            clickTimer = setTimeout(() => { clickCount = 0; }, 800);
            if (clickCount >= 3) {
                clickCount = 0;
                const pin = prompt("ENTER DEVELOPER PASSCODE:");
                if (pin === "1313" || pin === "admin13") {
                    adminMode = !adminMode;
                    try { localStorage.setItem('stickman_admin_unlocked', '1313'); } catch(e){}
                    if (adminPanel) adminPanel.classList.toggle('hidden', !adminMode);
                    openLeaderboardModal();
                    alert(adminMode ? "✅ ADMIN MODE ENABLED! Developer controls unlocked." : "🔒 ADMIN MODE DISABLED");
                } else if (pin !== null) {
                    alert("🚨 ACCESS DENIED: INVALID PASSCODE");
                }
            }
        };
    }

    const resetBoardBtn = document.getElementById('admin-reset-board-btn');
    if (resetBoardBtn) {
        resetBoardBtn.onclick = async () => {
            if (!confirm("Are you sure you want to wipe ALL scores from the leaderboard?")) return;
            if (adminStatus) {
                adminStatus.classList.remove('hidden', 'success');
                adminStatus.textContent = "WIPING LEADERBOARD...";
            }
            await LeaderboardClient.wipeLeaderboard();
            if (adminStatus) {
                adminStatus.className = "success";
                adminStatus.textContent = "✅ LEADERBOARD WIPED CLEAN!";
            }
            openLeaderboardModal();
        };
    }

    const openRenameModal = () => {
        ui.renameModal.classList.remove('hidden');
        ui.renameStatus.classList.add('hidden');
        ui.newNameInput.value = AccountManager.getName();
        ui.newNameInput.focus();
    };

    document.getElementById('menu-rename-btn').onclick = openRenameModal;
    document.getElementById('gameover-rename-btn').onclick = openRenameModal;
    document.getElementById('cancel-name-btn').onclick = () => {
        ui.renameModal.classList.add('hidden');
    };

    document.getElementById('save-name-btn').onclick = async () => {
        const inputVal = (ui.newNameInput.value || "").trim();
        ui.renameStatus.classList.remove('hidden', 'success', 'error');
        ui.renameStatus.textContent = "VERIFYING NAME UNIQUENESS & FILTER...";
        try {
            const savedName = await LeaderboardClient.renameAccount(inputVal);
            ui.renameStatus.className = "success";
            ui.renameStatus.textContent = `✅ RENAMED TO: ${savedName}`;
            updateAccountBadgeUI();
            setTimeout(() => {
                ui.renameModal.classList.add('hidden');
            }, 800);
        } catch (err) {
            ui.renameStatus.className = "error";
            ui.renameStatus.textContent = `🚨 ${err.message}`;
        }
    };
}

function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(audioCtx.destination);
}

function playBeep(freq, type, duration) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    g.gain.setValueAtTime(0.25, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.connect(g);
    g.connect(masterGain);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function startGame() {
    initAudio();
    ui.mainMenu.classList.add('hidden');
    ui.gameOver.classList.add('hidden');
    ui.leaderboardModal.classList.add('hidden');
    ui.renameModal.classList.add('hidden');
    
    ScoreVault.reset();
    gameSpeed = CONFIG.INITIAL_SPEED;
    obstacles.forEach(o => scene.remove(o.group));
    obstacles = [];
    
    backgroundElements.forEach(b => scene.remove(b));
    backgroundElements = [];
    for(let i=0; i<30; i++) spawnBackgroundScenery(i * 30 - 100);

    playerGroup.position.y = CONFIG.GROUND_Y;
    velocityY = 0;
    jumpCount = 0;
    isGrounded = true;
    isDucking = false;
    spawnTimer = 0;
    nextSpawnDelay = 1.0;
    isPlaying = true;
    clock.start();
    
    playBeep(520, 'square', 0.1);
    setTimeout(() => playBeep(780, 'square', 0.15), 100);
}

function resetGame() { startGame(); }

function gameOver() {
    isPlaying = false;
    isDucking = false;
    playBeep(180, 'sawtooth', 0.4);
    const currentScore = ScoreVault.get();
    if (currentScore > highScore) {
        highScore = currentScore;
        try {
            localStorage.setItem('stickman_resonance_v2', highScore);
        } catch(e){}
        if (ui.highScore) ui.highScore.textContent = Math.floor(highScore).toString().padStart(5, '0');
    }
    ui.finalScore.textContent = Math.floor(currentScore);
    ui.gameOver.classList.remove('hidden');

    // Automatically sync record to global leaderboard!
    if (ui.syncStatus) {
        ui.syncStatus.className = "";
        ui.syncStatus.textContent = "SYNCING WITH GLOBAL LEADERBOARD...";
        const token = ScoreVault.generateToken();
        LeaderboardClient.syncScore(currentScore, token).then(res => {
            ui.syncStatus.className = res.updated ? "success" : "";
            ui.syncStatus.textContent = res.msg || "SYNC COMPLETE";
        }).catch(err => {
            ui.syncStatus.className = "error";
            ui.syncStatus.textContent = "🚨 SYNC ERROR";
        });
    }
}

function createImpact(x, y, color) {
    for(let i=0; i<10; i++) {
        const p = new THREE.Mesh(
            new THREE.BoxGeometry(0.3, 0.3, 0.3),
            new THREE.MeshBasicMaterial({ color: color })
        );
        p.position.set(x, y + 0.5, (Math.random()-0.5) * 2);
        scene.add(p);
        particles.push({
            mesh: p,
            life: 1.0,
            vel: new THREE.Vector3((Math.random()-0.5)*12, Math.random()*12, (Math.random()-0.5)*8)
        });
    }
}

function spawnBackgroundScenery(x) {
    const isCloud = Math.random() > 0.5;
    if (isCloud) {
        const w = 12 + Math.random() * 15;
        const geo = new THREE.BoxGeometry(w, 4, 6);
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0 });
        const c = new THREE.Mesh(geo, mat);
        c.position.set(x, 18 + Math.random() * 15, -45 - Math.random() * 20);
        scene.add(c);
        backgroundElements.push(c);
    } else {
        const h = 10 + Math.random() * 25;
        const w = 15 + Math.random() * 20;
        const geo = new THREE.BoxGeometry(w, h, 12);
        const mat = new THREE.MeshStandardMaterial({ color: 0xd4a373, roughness: 0.9 });
        const rock = new THREE.Mesh(geo, mat);
        rock.position.set(x, h/2 + CONFIG.GROUND_Y, -50 - Math.random() * 20);
        scene.add(rock);
        backgroundElements.push(rock);
    }
}

// Realistic 3D Saguaro Cactus Helper
function createRealisticCactusMesh(h) {
    const group = new THREE.Group();
    const mainMat = new THREE.MeshStandardMaterial({ color: CONFIG.COLORS.CACTUS, roughness: 0.8 });
    const ribMat = new THREE.MeshStandardMaterial({ color: CONFIG.COLORS.CACTUS_DARK, roughness: 0.9 });

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, h, 8), mainMat);
    trunk.position.y = h / 2;
    trunk.castShadow = true;
    group.add(trunk);

    const armCount = Math.random() > 0.3 ? (Math.random() > 0.5 ? 2 : 1) : 0;
    for (let a = 0; a < armCount; a++) {
        const side = a === 0 ? 1 : -1;
        const armH = 1.0 + Math.random() * 0.8;
        const armY = 1.0 + Math.random() * (h * 0.4);
        
        const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.7, 6), mainMat);
        stub.rotation.z = Math.PI / 2;
        stub.position.set(side * 0.5, armY, 0);
        stub.castShadow = true;
        group.add(stub);

        const upArm = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.28, armH, 6), mainMat);
        upArm.position.set(side * 0.8, armY + armH / 2 - 0.2, 0);
        upArm.castShadow = true;
        group.add(upArm);
    }

    for (let r = 0; r < 2; r++) {
        const rock = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.35), ribMat);
        rock.position.set((Math.random() - 0.5) * 0.8, 0.1, (Math.random() - 0.5) * 0.8);
        group.add(rock);
    }

    return group;
}

// Realistic Obstacles: Saguaro Cacti (Jump) & Subway Surfers Hazard Barricades (Slide / Duck)
function spawnObstacle() {
    const group = new THREE.Group();
    group.position.set(120, CONFIG.GROUND_Y, 0);
    
    const isSlideBarricade = Math.random() > 0.65;
    let collider;

    if (isSlideBarricade) {
        // Subway Surfers-style Hazard Barricade (MUST SLIDE UNDER!)
        const postMat = new THREE.MeshStandardMaterial({ color: CONFIG.COLORS.BARRICADE_POST, roughness: 0.7 });
        const orangeMat = new THREE.MeshStandardMaterial({ color: CONFIG.COLORS.BARRICADE_ORANGE, roughness: 0.5 });
        const whiteMat = new THREE.MeshStandardMaterial({ color: CONFIG.COLORS.BARRICADE_WHITE, roughness: 0.5 });

        const leftPost = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5.2, 0.4), postMat);
        leftPost.position.set(0, 2.6, -1.6);
        leftPost.castShadow = true;
        group.add(leftPost);

        const rightPost = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5.2, 0.4), postMat);
        rightPost.position.set(0, 2.6, 1.6);
        rightPost.castShadow = true;
        group.add(rightPost);

        const bannerW = 3.6, bannerH = 2.0;
        const banner = new THREE.Mesh(new THREE.BoxGeometry(0.4, bannerH, bannerW), orangeMat);
        banner.position.set(0, 4.0, 0);
        banner.castShadow = true;
        group.add(banner);

        for (let s = -1.2; s <= 1.2; s += 0.8) {
            const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.42, bannerH, 0.35), whiteMat);
            stripe.position.set(0, 4.0, s);
            group.add(stripe);
        }
        
        // HITBOX: yLow is set to 3.0! Standing headY=3.9 > 3.0 -> CRASH! Slide headY=2.05 <= 3.0 -> SAFE!
        collider = { type: 'duck', x: 120, w: 2.2, yLow: 3.0 };
    } else {
        const count = Math.floor(Math.random() * 3) + 1; // 1 to 3 cacti
        let totalWidth = count * 1.6;
        let maxH = 2.5;

        for (let i = 0; i < count; i++) {
            const h = 2.8 + Math.random() * 1.6;
            if (h > maxH) maxH = h;
            const cactusMesh = createRealisticCactusMesh(h);
            cactusMesh.position.set((i - (count - 1) / 2) * 1.4, 0, 0);
            group.add(cactusMesh);
        }
        
        collider = { type: 'jump', x: 120, w: totalWidth, h: maxH };
    }

    scene.add(group);
    obstacles.push({ group, collider });
}

function updateTrail(dt) {
    if (!isPlaying) return;
    
    if (Math.random() > 0.6) {
        const trailGeo = new THREE.BoxGeometry(0.8, 1.8, 0.6);
        const trailMat = new THREE.MeshBasicMaterial({ 
            color: CONFIG.COLORS.STICKMAN_SHIRT, 
            transparent: true, 
            opacity: 0.25 
        });
        const segment = new THREE.Mesh(trailGeo, trailMat);
        segment.position.copy(playerGroup.position);
        segment.position.y += 2.5;
        segment.rotation.copy(playerGroup.rotation);
        scene.add(segment);
        playerTrail.push({ mesh: segment, life: 0.3 });
    }

    for (let i = playerTrail.length - 1; i >= 0; i--) {
        const t = playerTrail[i];
        t.life -= dt;
        t.mesh.scale.multiplyScalar(0.9);
        t.mesh.position.x -= gameSpeed * dt * 0.4;
        if (t.life <= 0) {
            scene.remove(t.mesh);
            playerTrail.splice(i, 1);
        }
    }
}

function update(dt) {
    if (!isPlaying) return;
    updateTrail(dt);

    if (!isGrounded) {
        velocityY += CONFIG.GRAVITY * dt;
        playerGroup.position.y += velocityY * dt;
        if (playerGroup.position.y <= CONFIG.GROUND_Y) {
            playerGroup.position.y = CONFIG.GROUND_Y;
            velocityY = 0;
            isGrounded = true;
            jumpCount = 0;
            playBeep(240, 'sine', 0.05);
        }
    }

    const moveDist = gameSpeed * dt;
    scene.grid.position.x = (scene.grid.position.x - moveDist) % 10;

    backgroundElements.forEach(b => {
        b.position.x -= moveDist * 0.3;
        if (b.position.x < -120) b.position.x += 800;
    });

    for (let i = obstacles.length - 1; i >= 0; i--) {
        const o = obstacles[i];
        o.group.position.x -= moveDist;
        o.collider.x = o.group.position.x;

        if (o.group.position.x < -30) {
            scene.remove(o.group);
            obstacles.splice(i, 1);
            continue;
        }

        const dx = Math.abs(playerGroup.position.x - o.collider.x);
        if (dx < (o.collider.w / 2 + 0.45)) {
            const py = playerGroup.position.y - CONFIG.GROUND_Y;
            if (o.collider.type === 'jump') {
                if (py < o.collider.h - 0.2) gameOver();
            } else {
                const headY = py + (isDucking ? 2.05 : 3.9);
                if (headY > o.collider.yLow) gameOver();
            }
        }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt * 1.5;
        p.mesh.position.addScaledVector(p.vel, dt);
        p.mesh.scale.setScalar(p.life);
        p.mesh.rotation.x += dt * 5;
        if (p.life <= 0) {
            scene.remove(p.mesh);
            particles.splice(i, 1);
        }
    }

    gameSpeed = Math.min(CONFIG.MAX_SPEED, gameSpeed + CONFIG.SPEED_INC * dt);
    ScoreVault.add(moveDist * 0.1);
    ui.score.textContent = Math.floor(ScoreVault.get()).toString().padStart(5, '0');

    spawnTimer += dt;
    if (spawnTimer > nextSpawnDelay) {
        spawnObstacle();
        spawnTimer = 0;
        nextSpawnDelay = Math.max(0.7, 2.3 - (gameSpeed / 45));
    }
}

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

    update(dt);

    if (isPlaying) {
        const s = t * (gameSpeed * 0.5);
        if (isGrounded) {
            if (isDucking) {
                // RONALDO SIUUU POWER SLIDE POSE!
                // All parts explicitly positioned & rotated so NOTHING floats!
                playerParts.torso.position.set(0, 1.35, 0);
                playerParts.torso.rotation.set(-0.25, 0, 0);
                
                playerParts.head.position.set(0, 2.05, -0.2);
                playerParts.head.rotation.set(0, 0, 0);
                
                // Arms positioned at lowered shoulder height (1.9) and thrown BACK behind the hips in SIUUU V-shape!
                playerParts.lArm.position.set(-0.6, 1.9, -0.2);
                playerParts.lArm.rotation.set(0.65, 0, -0.55); // +X swings arm backward behind torso, -Z angles outward in V!
                
                playerParts.rArm.position.set(0.6, 1.9, -0.2);
                playerParts.rArm.rotation.set(0.65, 0, 0.55);  // +X swings arm backward behind torso, +Z angles outward in V!
                
                // Legs sliding along the floor
                playerParts.lLeg.position.set(-0.3, 0.8, 0.2);
                playerParts.lLeg.rotation.set(-1.3, 0, 0);
                
                playerParts.rLeg.position.set(0.3, 0.8, 0.2);
                playerParts.rLeg.rotation.set(-1.45, 0, 0);
                
                playerGroup.rotation.z = 0;
            } else {
                // Standard Run Cycle
                playerParts.torso.position.set(0, 2.5 + Math.sin(s*2) * 0.1, 0);
                playerParts.torso.rotation.set(0, 0, 0);
                
                playerParts.head.position.set(0, 3.9 + Math.sin(s*2) * 0.15, 0);
                playerParts.head.rotation.set(0, 0, 0);
                
                playerParts.lArm.position.set(-0.6, 3.2 + Math.sin(s*2) * 0.1, 0);
                playerParts.lArm.rotation.set(Math.sin(s + Math.PI) * 1.0, 0, 0);
                
                playerParts.rArm.position.set(0.6, 3.2 + Math.sin(s*2) * 0.1, 0);
                playerParts.rArm.rotation.set(Math.sin(s) * 1.0, 0, 0);
                
                playerParts.lLeg.position.set(-0.3, 1.8, 0);
                playerParts.lLeg.rotation.set(Math.sin(s) * 1.2, 0, 0);
                
                playerParts.rLeg.position.set(0.3, 1.8, 0);
                playerParts.rLeg.rotation.set(Math.sin(s + Math.PI) * 1.2, 0, 0);
                
                playerGroup.rotation.z = 0;
            }
        } else {
            // Air / Jump Pose
            playerParts.torso.position.set(0, 2.5, 0);
            playerParts.torso.rotation.set(0, 0, 0);
            playerParts.head.position.set(0, 3.9, 0);
            playerParts.head.rotation.set(0, 0, 0);
            
            playerParts.lArm.position.set(-0.6, 3.2, 0);
            playerParts.lArm.rotation.set(-2.0, 0, 0);
            
            playerParts.rArm.position.set(0.6, 3.2, 0);
            playerParts.rArm.rotation.set(-2.0, 0, 0);
            
            playerParts.lLeg.position.set(-0.3, 1.8, 0);
            playerParts.lLeg.rotation.set(-0.5, 0, 0);
            
            playerParts.rLeg.position.set(0.3, 1.8, 0);
            playerParts.rLeg.rotation.set(0.2, 0, 0);
            
            playerGroup.rotation.z = velocityY * 0.01;
        }
        
        camera.rotation.z = Math.sin(t * 0.5) * 0.015;
        camera.position.y = 8 + Math.sin(t) * 0.3;
    }

    renderer.render(scene, camera);
}

function onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    
    if (width < height) {
        camera.fov = 65;
        camera.position.z = 40;
    } else {
        camera.fov = 50;
        camera.position.z = 35;
    }
    
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}
