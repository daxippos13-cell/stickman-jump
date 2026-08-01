import * as THREE from 'three';

// --- DIVINE CONFIGURATION ---
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
        VOID: 0x05050a,
        NEON_BLUE: 0x00f3ff,
        NEON_RED: 0xff003c,
        NEON_GOLD: 0xffcc00,
        GRID: 0x1a1a2e,
        BUILDING: 0x0a0a12
    }
};

// --- MACHINE STATE ---
let scene, camera, renderer, clock;
let playerGroup, playerParts = {}, playerTrail = [];
let obstacles = [], particles = [], backgroundBuildings = [];
let isPlaying = false, score = 0, gameSpeed = CONFIG.INITIAL_SPEED;

// Physics & Input
let velocityY = 0, jumpCount = 0, isGrounded = true, isDucking = false;
let spawnTimer = 0, nextSpawnDelay = 1.0;

// Audio (Procedural placeholders)
let audioCtx, masterGain;

const ui = {
    score: document.getElementById('score-display'),
    highScore: document.getElementById('high-score-display'),
    mainMenu: document.getElementById('main-menu'),
    gameOver: document.getElementById('game-over'),
    finalScore: document.getElementById('final-score'),
    mobile: document.getElementById('mobile-controls')
};

let highScore = localStorage.getItem('stickman_resonance_v2') || 0;
if (ui.highScore) ui.highScore.textContent = Math.floor(highScore).toString().padStart(5, '0');

init();
animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.COLORS.VOID);
    scene.fog = new THREE.FogExp2(CONFIG.COLORS.VOID, 0.015);

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

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambient);

    const hemi = new THREE.HemisphereLight(CONFIG.COLORS.NEON_BLUE, CONFIG.COLORS.NEON_RED, 0.5);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(50, 100, 50);
    sun.castShadow = true;
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);

    createGrid();
    createPlayer();
    setupControls();
    
    window.addEventListener('resize', onWindowResize);
}

function createGrid() {
    const size = 1000;
    const divisions = 100;
    const grid = new THREE.GridHelper(size, divisions, CONFIG.COLORS.NEON_BLUE, CONFIG.COLORS.GRID);
    grid.position.y = CONFIG.GROUND_Y;
    scene.add(grid);
    scene.grid = grid;

    const planeGeo = new THREE.PlaneGeometry(size, size);
    const planeMat = new THREE.MeshPhongMaterial({ color: 0x000000 });
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = CONFIG.GROUND_Y - 0.05;
    plane.receiveShadow = true;
    scene.add(plane);
}

function createPlayer() {
    playerGroup = new THREE.Group();
    playerGroup.position.set(CONFIG.PLAYER_X, CONFIG.GROUND_Y, 0);
    playerGroup.rotation.y = Math.PI / 2;

    const mat = new THREE.MeshStandardMaterial({ 
        color: 0x111111, 
        roughness: 0.1, 
        metalness: 0.8,
        emissive: CONFIG.COLORS.NEON_BLUE,
        emissiveIntensity: 0.2
    });

    const glowMat = new THREE.MeshBasicMaterial({ color: CONFIG.COLORS.NEON_BLUE });

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.6), mat);
    torso.position.y = 2.5;
    torso.castShadow = true;
    playerGroup.add(torso);
    playerParts.torso = torso;

    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), mat);
    head.position.y = 3.8;
    head.castShadow = true;
    playerGroup.add(head);
    playerParts.head = head;

    // Visor
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.2, 0.85), glowMat);
    visor.position.y = 3.9;
    playerGroup.add(visor);
    playerParts.visor = visor;

    const createLimb = (x, y, isArm) => {
        const w = 0.35, h = isArm ? 1.4 : 1.8, d = 0.35;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
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
        if (!isPlaying && (e.code === 'Space' || e.code === 'Enter')) startGame();
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
    g.gain.setValueAtTime(0.2, audioCtx.currentTime);
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
    
    score = 0;
    gameSpeed = CONFIG.INITIAL_SPEED;
    obstacles.forEach(o => scene.remove(o.group));
    obstacles = [];
    
    backgroundBuildings.forEach(b => scene.remove(b));
    backgroundBuildings = [];
    for(let i=0; i<40; i++) spawnBackgroundBuilding(i * 20 - 100);

    playerGroup.position.y = CONFIG.GROUND_Y;
    velocityY = 0;
    jumpCount = 0;
    isGrounded = true;
    isDucking = false;
    spawnTimer = 0;
    nextSpawnDelay = 1.0;
    isPlaying = true;
    clock.start();
    
    playBeep(440, 'square', 0.1);
    setTimeout(() => playBeep(880, 'square', 0.2), 100);
}

function resetGame() { startGame(); }

function gameOver() {
    isPlaying = false;
    playBeep(110, 'sawtooth', 0.5);
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('stickman_resonance_v2', highScore);
        if (ui.highScore) ui.highScore.textContent = Math.floor(highScore).toString().padStart(5, '0');
    }
    ui.finalScore.textContent = Math.floor(score);
    ui.gameOver.classList.remove('hidden');
}

function jump() {
    if (isGrounded) {
        velocityY = CONFIG.JUMP_FORCE;
        isGrounded = false;
        jumpCount = 1;
        createImpact(playerGroup.position.x, CONFIG.GROUND_Y, CONFIG.COLORS.NEON_BLUE);
        playBeep(600, 'sine', 0.1);
    } else if (jumpCount < 2) {
        velocityY = CONFIG.JUMP_FORCE * CONFIG.DOUBLE_JUMP_MULT;
        jumpCount = 2;
        createImpact(playerGroup.position.x, playerGroup.position.y, CONFIG.COLORS.NEON_GOLD);
        playBeep(900, 'sine', 0.1);
    }
}

function startDuck() {
    if (!isDucking) {
        isDucking = true;
        if (isGrounded) playBeep(300, 'sine', 0.1);
    }
}

function endDuck() { isDucking = false; }

function createImpact(x, y, color) {
    for(let i=0; i<12; i++) {
        const p = new THREE.Mesh(
            new THREE.BoxGeometry(0.3, 0.3, 0.3),
            new THREE.MeshBasicMaterial({ color: color })
        );
        p.position.set(x, y + 0.5, (Math.random()-0.5) * 2);
        scene.add(p);
        particles.push({
            mesh: p,
            life: 1.0,
            vel: new THREE.Vector3((Math.random()-0.5)*15, Math.random()*15, (Math.random()-0.5)*10)
        });
    }
}

function spawnBackgroundBuilding(x) {
    const h = 15 + Math.random() * 50;
    const w = 8 + Math.random() * 12;
    const d = 10 + Math.random() * 15;
    
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({ 
        color: CONFIG.COLORS.BUILDING,
        emissive: Math.random() > 0.7 ? CONFIG.COLORS.NEON_BLUE : CONFIG.COLORS.NEON_RED,
        emissiveIntensity: 0.1
    });
    const b = new THREE.Mesh(geo, mat);
    b.position.set(x, h/2 + CONFIG.GROUND_Y, -40 - Math.random() * 30);
    scene.add(b);
    backgroundBuildings.push(b);
}

function spawnObstacle() {
    const group = new THREE.Group();
    group.position.set(120, CONFIG.GROUND_Y, 0);
    
    const isAir = Math.random() > 0.6;
    let collider;

    if (isAir) {
        // High laser barrier
        const geo = new THREE.BoxGeometry(1, 1, 15);
        const mat = new THREE.MeshBasicMaterial({ color: CONFIG.COLORS.NEON_RED });
        const laser = new THREE.Mesh(geo, mat);
        laser.position.y = 5.5;
        group.add(laser);
        
        const glow = new THREE.PointLight(CONFIG.COLORS.NEON_RED, 20, 20);
        glow.position.y = 5.5;
        group.add(glow);
        
        collider = { type: 'duck', x: 120, w: 2, yLow: 5.0 };
    } else {
        // Ground spike/block
        const h = 2 + Math.random() * 3;
        const w = 2 + Math.random() * 2;
        const geo = new THREE.BoxGeometry(w, h, 4);
        const mat = new THREE.MeshStandardMaterial({ 
            color: 0x222222, 
            emissive: CONFIG.COLORS.NEON_RED,
            emissiveIntensity: 0.5
        });
        const block = new THREE.Mesh(geo, mat);
        block.position.y = h/2;
        block.castShadow = true;
        group.add(block);
        
        collider = { type: 'jump', x: 120, w: w, h: h };
    }

    scene.add(group);
    obstacles.push({ group, collider });
}

function updateTrail(dt) {
    if (!isPlaying) return;
    
    // Create new trail segment
    if (Math.random() > 0.5) {
        const trailGeo = new THREE.BoxGeometry(0.8, 1.8, 0.6);
        const trailMat = new THREE.MeshBasicMaterial({ 
            color: CONFIG.COLORS.NEON_BLUE, 
            transparent: true, 
            opacity: 0.2 
        });
        const segment = new THREE.Mesh(trailGeo, trailMat);
        segment.position.copy(playerGroup.position);
        segment.position.y += 2.5; // Torso height
        segment.rotation.copy(playerGroup.rotation);
        scene.add(segment);
        playerTrail.push({ mesh: segment, life: 0.5 });
    }

    for (let i = playerTrail.length - 1; i >= 0; i--) {
        const t = playerTrail[i];
        t.life -= dt;
        t.mesh.scale.multiplyScalar(0.95);
        t.mesh.position.x -= gameSpeed * dt * 0.5; // Slight lag
        if (t.life <= 0) {
            scene.remove(t.mesh);
            playerTrail.splice(i, 1);
        }
    }
}

let musicTimer = 0;
function updateMusic(dt) {
    if (!isPlaying) return;
    musicTimer += dt * (gameSpeed / 30);
    if (musicTimer > 0.5) {
        musicTimer = 0;
        playBeep(110, 'sawtooth', 0.1); // Bass pulse
        if (Math.random() > 0.7) playBeep(220, 'square', 0.05); // Snare-like
    }
}

function update(dt) {
    if (!isPlaying) return;
    updateTrail(dt);
    updateMusic(dt);
    if (!isPlaying) return;

    // Physics
    if (!isGrounded) {
        velocityY += CONFIG.GRAVITY * dt;
        playerGroup.position.y += velocityY * dt;
        if (playerGroup.position.y <= CONFIG.GROUND_Y) {
            playerGroup.position.y = CONFIG.GROUND_Y;
            velocityY = 0;
            isGrounded = true;
            jumpCount = 0;
            playBeep(200, 'sine', 0.05);
        }
    }

    const moveDist = gameSpeed * dt;
    scene.grid.position.x = (scene.grid.position.x - moveDist) % 10;

    backgroundBuildings.forEach(b => {
        b.position.x -= moveDist * 0.3;
        if (b.position.x < -100) b.position.x += 800;
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

        // Collision Check
        const dx = Math.abs(playerGroup.position.x - o.collider.x);
        if (dx < (o.collider.w / 2 + 0.5)) {
            const py = playerGroup.position.y - CONFIG.GROUND_Y;
            if (o.collider.type === 'jump') {
                if (py < o.collider.h - 0.2) gameOver();
            } else {
                const headY = py + (isDucking ? 2.0 : 4.0);
                if (headY > o.collider.yLow) gameOver();
            }
        }
    }

    // Particles
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
    score += moveDist * 0.1;
    ui.score.textContent = Math.floor(score).toString().padStart(5, '0');

    spawnTimer += dt;
    if (spawnTimer > nextSpawnDelay) {
        spawnObstacle();
        spawnTimer = 0;
        nextSpawnDelay = Math.max(0.8, 2.5 - (gameSpeed / 40));
    }
}

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

    update(dt);

    // Dynamic Animations
    if (isPlaying) {
        const s = t * (gameSpeed * 0.5);
        if (isGrounded) {
            if (isDucking) {
                // Slide Pose
                playerParts.torso.position.y = 1.2;
                playerParts.head.position.y = 2.2;
                playerParts.visor.position.y = 2.3;
                playerParts.lLeg.rotation.x = -Math.PI/2.2;
                playerParts.rLeg.rotation.x = -Math.PI/2.5;
                playerParts.lArm.rotation.x = Math.PI/4;
                playerParts.rArm.rotation.x = Math.PI/4;
                playerGroup.rotation.z = 0.1;
            } else {
                // Run Cycle
                playerParts.torso.position.y = 2.5 + Math.sin(s*2) * 0.1;
                playerParts.head.position.y = 3.8 + Math.sin(s*2) * 0.15;
                playerParts.visor.position.y = 3.9 + Math.sin(s*2) * 0.15;
                playerParts.lLeg.rotation.x = Math.sin(s) * 1.2;
                playerParts.rLeg.rotation.x = Math.sin(s + Math.PI) * 1.2;
                playerParts.lArm.rotation.x = Math.sin(s + Math.PI) * 1.0;
                playerParts.rArm.rotation.x = Math.sin(s) * 1.0;
                playerGroup.rotation.z = 0;
            }
        } else {
            // Air / Jump
            playerParts.lLeg.rotation.x = -0.5;
            playerParts.rLeg.rotation.x = 0.2;
            playerParts.lArm.rotation.x = -2.0;
            playerParts.rArm.rotation.x = -2.0;
            playerGroup.rotation.z = velocityY * 0.01;
        }
        
        // Dynamic Camera Tilt
        camera.rotation.z = Math.sin(t * 0.5) * 0.02;
        camera.position.y = 8 + Math.sin(t) * 0.5;
    }

    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
