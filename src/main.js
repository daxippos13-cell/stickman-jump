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
        BIRD: 0xe67e22,
        STICKMAN_SHIRT: 0x0984e3,
        STICKMAN_PANTS: 0x2d3436,
        STICKMAN_HEAD: 0xffdbac
    }
};

// --- ROBUST ANTI-CHEAT SCORE VAULT (NO FLOAT XOR BUG) ---
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
        // Generous plausibility ceiling: max 25 points per second + 300 base buffer
        if (this._val > (elapsedSec * 25 + 300)) {
            console.warn("SECURITY ALERT: Impossible velocity detected.");
            return false;
        }
        return true;
    },
    generateToken(playerName) {
        if (!this.verify()) return null;
        const scoreVal = Math.floor(this._val);
        const payload = `${playerName}:${scoreVal}:${this._runId}:${this._startTime}`;
        let hash = 0;
        for (let i = 0; i < payload.length; i++) {
            hash = ((hash << 5) - hash) + payload.charCodeAt(i);
            hash |= 0;
        }
        return btoa(`${payload}:${Math.abs(hash).toString(16)}`);
    }
};

// --- ONLINE LEADERBOARD CLIENT (WITH COOKIE & RECORD-UPDATE LOGIC) ---
const LEADERBOARD_API_URL = "https://jsonblob.com/api/jsonBlob/019fbeb5-5f06-73a9-ab6e-7e94c29fe6c8";

const LeaderboardClient = {
    async fetchLeaderboard() {
        try {
            const response = await fetch(LEADERBOARD_API_URL, { cache: "no-store" });
            if (!response.ok) throw new Error("Network response was not ok");
            const data = await response.json();
            const list = data.leaderboard || [];
            return list.sort((a, b) => b.score - a.score).slice(0, 15);
        } catch (err) {
            console.error("Error fetching leaderboard:", err);
            return [];
        }
    },

    async submitScore(playerName, token) {
        if (!ScoreVault.verify() || !token) {
            throw new Error("SECURITY CHECKSUM FAILED: ANOMALOUS VELOCITY");
        }
        try {
            const response = await fetch(LEADERBOARD_API_URL, { cache: "no-store" });
            let data = { leaderboard: [] };
            if (response.ok) {
                data = await response.json();
            }
            const list = data.leaderboard || [];
            
            const scoreVal = ScoreVault.get();
            if (scoreVal <= 0) throw new Error("SCORE TOO LOW");

            const cleanName = (playerName || "RUNNER").toUpperCase().substring(0, 12);
            const todayStr = new Date().toISOString().split('T')[0];

            // Check if user already exists on the leaderboard
            const existingIndex = list.findIndex(item => (item.name || "").toUpperCase() === cleanName);

            let statusMsg = "✅ NEW SCORE RECORDED!";
            if (existingIndex !== -1) {
                const oldRecord = list[existingIndex].score || 0;
                if (scoreVal > oldRecord) {
                    list[existingIndex].score = scoreVal;
                    list[existingIndex].date = todayStr;
                    list[existingIndex].hash = token;
                    statusMsg = `✅ RECORD UPDATED! (BEAT OLD ${oldRecord})`;
                } else {
                    statusMsg = `ℹ️ ONLINE RECORD (${oldRecord}) IS HIGHER`;
                    return { updated: false, msg: statusMsg };
                }
            } else {
                list.push({
                    name: cleanName,
                    score: scoreVal,
                    date: todayStr,
                    hash: token
                });
            }

            const updatedList = list.sort((a, b) => b.score - a.score).slice(0, 25);

            const putResponse = await fetch(LEADERBOARD_API_URL, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leaderboard: updatedList })
            });
            if (!putResponse.ok) throw new Error("Failed to save to Server");
            return { updated: true, msg: statusMsg };
        } catch (err) {
            console.error("Score submission error:", err);
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
    playerNameInput: document.getElementById('player-name-input'),
    submitScoreBtn: document.getElementById('submit-score-btn'),
    submitStatus: document.getElementById('submit-status')
};

let highScore = localStorage.getItem('stickman_resonance_v2') || 0;
if (ui.highScore) ui.highScore.textContent = Math.floor(highScore).toString().padStart(5, '0');

// Load stored callsign/cookie
const storedCallsign = localStorage.getItem('stickman_callsign') || "";
if (ui.playerNameInput && storedCallsign) {
    ui.playerNameInput.value = storedCallsign;
}

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
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);

    const hemi = new THREE.HemisphereLight(CONFIG.COLORS.SKY, CONFIG.COLORS.GROUND, 0.5);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
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
    setupLeaderboardUI();
    
    window.addEventListener('resize', onWindowResize);
    onWindowResize();
}

function createDesertTrack() {
    // Ground plane (Desert sand)
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

    // Track markings
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

function setupControls() {
    document.addEventListener('keydown', (e) => {
        if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
            e.preventDefault();
        }
        if (!isPlaying && (e.code === 'Space' || e.code === 'Enter')) {
            if (ui.leaderboardModal.classList.contains('hidden') && document.activeElement !== ui.playerNameInput) {
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

function setupLeaderboardUI() {
    const openModal = async () => {
        ui.leaderboardModal.classList.remove('hidden');
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
            ui.leaderboardList.appendChild(row);
        });
    };

    document.getElementById('menu-leaderboard-btn').onclick = openModal;
    document.getElementById('view-leaderboard-btn').onclick = openModal;
    document.getElementById('close-leaderboard-btn').onclick = () => {
        ui.leaderboardModal.classList.add('hidden');
    };

    ui.submitScoreBtn.onclick = async () => {
        const name = (ui.playerNameInput.value || "").trim() || "RUNNER";
        localStorage.setItem('stickman_callsign', name);

        const token = ScoreVault.generateToken(name);
        ui.submitStatus.classList.remove('hidden', 'success', 'error');
        ui.submitStatus.textContent = "SAVING TO LEADERBOARD...";
        ui.submitScoreBtn.disabled = true;

        try {
            const res = await LeaderboardClient.submitScore(name, token);
            ui.submitStatus.className = "success";
            ui.submitStatus.textContent = res.msg || "✅ SCORE SAVED!";
            setTimeout(() => {
                openModal();
            }, 1000);
        } catch (err) {
            ui.submitStatus.className = "error";
            ui.submitStatus.textContent = `🚨 DENIED: ${err.message}`;
            console.error(err);
        } finally {
            ui.submitScoreBtn.disabled = false;
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
    ui.submitStatus.classList.add('hidden');
    ui.submitStatus.textContent = '';
    
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
    playBeep(180, 'sawtooth', 0.4);
    const currentScore = ScoreVault.get();
    if (currentScore > highScore) {
        highScore = currentScore;
        localStorage.setItem('stickman_resonance_v2', highScore);
        if (ui.highScore) ui.highScore.textContent = Math.floor(highScore).toString().padStart(5, '0');
    }
    ui.finalScore.textContent = Math.floor(currentScore);
    ui.gameOver.classList.remove('hidden');
    if (ui.playerNameInput) ui.playerNameInput.focus();
}

function jump() {
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
    if (!isDucking) {
        isDucking = true;
        if (isGrounded) playBeep(350, 'sine', 0.08);
    }
}

function endDuck() { isDucking = false; }

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

// 3D Desert Rocks/Clouds/Hills in the background
function spawnBackgroundScenery(x) {
    const isCloud = Math.random() > 0.5;
    if (isCloud) {
        // Bright Cloud
        const w = 12 + Math.random() * 15;
        const geo = new THREE.BoxGeometry(w, 4, 6);
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0 });
        const c = new THREE.Mesh(geo, mat);
        c.position.set(x, 18 + Math.random() * 15, -45 - Math.random() * 20);
        scene.add(c);
        backgroundElements.push(c);
    } else {
        // Distant Desert Mesa/Rock
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

// Dino-Style Obstacles: Cacti (Ground) & Flying Birds (Air)
function spawnObstacle() {
    const group = new THREE.Group();
    group.position.set(120, CONFIG.GROUND_Y, 0);
    
    const isAir = Math.random() > 0.65;
    let collider;

    if (isAir) {
        // 3D Flying Bird / Pterodactyl (requires ducking)
        const wingSpan = 3.5;
        const geo = new THREE.BoxGeometry(wingSpan, 0.6, 1.2);
        const mat = new THREE.MeshStandardMaterial({ color: CONFIG.COLORS.BIRD, roughness: 0.6 });
        const bird = new THREE.Mesh(geo, mat);
        bird.position.y = 5.2;
        bird.castShadow = true;
        group.add(bird);
        
        collider = { type: 'duck', x: 120, w: wingSpan, yLow: 4.8 };
    } else {
        // 3D Cactus or Cactus Cluster (like Chrome Dino!)
        const count = Math.floor(Math.random() * 3) + 1; // 1 to 3 cacti
        const mat = new THREE.MeshStandardMaterial({ color: CONFIG.COLORS.CACTUS, roughness: 0.8 });
        let totalWidth = count * 1.5;
        let maxH = 2.5;

        for (let i = 0; i < count; i++) {
            const h = 2.8 + Math.random() * 1.8;
            if (h > maxH) maxH = h;
            const cactus = new THREE.Mesh(new THREE.BoxGeometry(1.2, h, 1.2), mat);
            cactus.position.set((i - (count-1)/2) * 1.4, h/2, 0);
            cactus.castShadow = true;
            group.add(cactus);
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

        // Accurate Collision Check
        const dx = Math.abs(playerGroup.position.x - o.collider.x);
        if (dx < (o.collider.w / 2 + 0.45)) {
            const py = playerGroup.position.y - CONFIG.GROUND_Y;
            if (o.collider.type === 'jump') {
                if (py < o.collider.h - 0.2) gameOver();
            } else {
                const headY = py + (isDucking ? 2.0 : 4.0);
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
                playerParts.torso.position.y = 1.2;
                playerParts.head.position.y = 2.2;
                playerParts.lLeg.rotation.x = -Math.PI/2.2;
                playerParts.rLeg.rotation.x = -Math.PI/2.5;
                playerParts.lArm.rotation.x = Math.PI/4;
                playerParts.rArm.rotation.x = Math.PI/4;
                playerGroup.rotation.z = 0.1;
            } else {
                playerParts.torso.position.y = 2.5 + Math.sin(s*2) * 0.1;
                playerParts.head.position.y = 3.9 + Math.sin(s*2) * 0.15;
                playerParts.lLeg.rotation.x = Math.sin(s) * 1.2;
                playerParts.rLeg.rotation.x = Math.sin(s + Math.PI) * 1.2;
                playerParts.lArm.rotation.x = Math.sin(s + Math.PI) * 1.0;
                playerParts.rArm.rotation.x = Math.sin(s) * 1.0;
                playerGroup.rotation.z = 0;
            }
        } else {
            playerParts.lLeg.rotation.x = -0.5;
            playerParts.rLeg.rotation.x = 0.2;
            playerParts.lArm.rotation.x = -2.0;
            playerParts.rArm.rotation.x = -2.0;
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
