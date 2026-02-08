import * as THREE from 'three';

// --- CONFIGURATION ---
const CONFIG = {
    GRAVITY: -70,
    JUMP_FORCE: 28,
    GROUND_Y: -2,
    PLAYER_X: -5,
    INITIAL_SPEED: 25,
    MAX_SPEED: 60,
    SPEED_INC: 1.5,
    COLORS: {
        SKY: 0x87CEEB,
        GROUND: 0x2d3436,
        PLAYER: 0x222222,
        BUILDING_DARK: 0x2d3436,
        BUILDING_LIGHT: 0x636e72,
        ACCENT: 0xffd700
    }
};

// --- STATE ---
let scene, camera, renderer;
let playerGroup, playerParts = {};
let obstacles = [];
let particles = [];
let backgroundBuildings = [];
let isPlaying = false;
let score = 0;
let gameSpeed = CONFIG.INITIAL_SPEED;
let clock = new THREE.Clock();

// Physics
let velocityY = 0;
let isGrounded = true;
let isDucking = false;

// Spawn
let spawnTimer = 0;
let nextSpawnDelay = 0;

// UI
const ui = {
    score: document.getElementById('score-display'),
    highScore: document.getElementById('high-score-display'),
    mainMenu: document.getElementById('main-menu'),
    gameOver: document.getElementById('game-over'),
    finalScore: document.getElementById('final-score'),
    mobile: document.getElementById('mobile-controls')
};

let highScore = localStorage.getItem('stickman_highscore') || 0;
if (ui.highScore) ui.highScore.textContent = Math.floor(highScore).toString().padStart(5, '0');

init();
animate();

function init() {
    // 1. Scene Setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.COLORS.SKY);
    scene.fog = new THREE.Fog(CONFIG.COLORS.SKY, 40, 120);

    // 2. Camera
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
    camera.position.set(0, 10, 40);
    camera.lookAt(10, 2, 0);

    // 3. Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    // 4. Lights
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(20, 50, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.left = -50;
    dirLight.shadow.camera.right = 50;
    dirLight.shadow.camera.top = 50;
    dirLight.shadow.camera.bottom = -50;
    scene.add(dirLight);

    // 5. Environment
    createEnvironment();
    createPlayer();
    
    // 6. Controls
    window.addEventListener('resize', onWindowResize);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    document.getElementById('start-btn').addEventListener('click', startGame);
    document.getElementById('restart-btn').addEventListener('click', resetGame);
    
    if ('ontouchstart' in window) {
        ui.mobile.style.display = 'flex';
        const btnJump = document.getElementById('btn-jump');
        const btnDuck = document.getElementById('btn-duck');
        
        btnJump.addEventListener('touchstart', (e) => { e.preventDefault(); jump(); });
        btnDuck.addEventListener('touchstart', (e) => { e.preventDefault(); startDuck(); });
        btnDuck.addEventListener('touchend', (e) => { e.preventDefault(); endDuck(); });
    }
}

function createEnvironment() {
    // Ground
    const groundGeo = new THREE.PlaneGeometry(1000, 100);
    const groundMat = new THREE.MeshPhongMaterial({ color: CONFIG.COLORS.GROUND });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = CONFIG.GROUND_Y;
    ground.receiveShadow = true;
    scene.add(ground);

    // Parallax City Background
    for (let i = 0; i < 30; i++) {
        createBackgroundBuilding(i * 15 - 100);
    }
}

function createBackgroundBuilding(xOffset) {
    const width = 10 + Math.random() * 15;
    const height = 20 + Math.random() * 40;
    const depth = 10 + Math.random() * 10;
    
    const geo = new THREE.BoxGeometry(width, height, depth);
    const mat = new THREE.MeshLambertMaterial({ color: 0x555566 });
    const mesh = new THREE.Mesh(geo, mat);
    
    // Position far back
    mesh.position.set(xOffset, height/2 + CONFIG.GROUND_Y, -30 - Math.random() * 20);
    scene.add(mesh);
    backgroundBuildings.push(mesh);
}

function createPlayer() {
    playerGroup = new THREE.Group();
    playerGroup.position.set(CONFIG.PLAYER_X, CONFIG.GROUND_Y, 0);
    playerGroup.rotation.y = Math.PI / 2; // Face forward (Right/+X)
    
    const mat = new THREE.MeshToonMaterial({ color: CONFIG.COLORS.PLAYER });

    // Rigging
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.5), mat);
    torso.position.y = 2.4;
    torso.castShadow = true;
    playerGroup.add(torso);
    playerParts.torso = torso;

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), mat);
    head.position.y = 3.6;
    head.castShadow = true;
    playerGroup.add(head);
    playerParts.head = head;
    
    // Headband
    const headband = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.1, 0.75), new THREE.MeshBasicMaterial({ color: CONFIG.COLORS.ACCENT }));
    headband.position.y = 3.7;
    playerGroup.add(headband);
    playerParts.headband = headband; // FIX: Assign headband part

    // Limbs Factory
    const createLimb = (x, y, isArm) => {
        const w = 0.3, h = isArm ? 1.2 : 1.5, d = 0.3;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.y = -h/2;
        mesh.castShadow = true;
        
        const pivot = new THREE.Group();
        pivot.position.set(x, y, 0);
        pivot.add(mesh);
        playerGroup.add(pivot);
        return pivot;
    };

    playerParts.lLeg = createLimb(-0.3, 1.6, false);
    playerParts.rLeg = createLimb(0.3, 1.6, false);
    playerParts.lArm = createLimb(-0.55, 3.0, true);
    playerParts.rArm = createLimb(0.55, 3.0, true);

    scene.add(playerGroup);
}

// --- GAME LOGIC ---

function startGame() {
    ui.mainMenu.classList.add('hidden');
    ui.gameOver.classList.add('hidden');
    
    // Reset State
    score = 0;
    gameSpeed = CONFIG.INITIAL_SPEED;
    
    // Correctly remove old obstacles
    obstacles.forEach(o => scene.remove(o.group));
    obstacles = [];
    
    playerGroup.position.y = CONFIG.GROUND_Y;
    velocityY = 0;
    isGrounded = true;
    isDucking = false;
    spawnTimer = 0;
    nextSpawnDelay = 1;
    isPlaying = true;
    clock.start();
}

function resetGame() {
    startGame();
}

function gameOver() {
    isPlaying = false;
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('stickman_highscore', highScore);
        if (ui.highScore) ui.highScore.textContent = Math.floor(highScore).toString().padStart(5, '0');
    }
    ui.finalScore.textContent = Math.floor(score);
    ui.gameOver.classList.remove('hidden');
}

// Controls
function handleKeyDown(e) {
    if (!isPlaying) return;
    if (e.code === 'Space' || e.code === 'ArrowUp') jump();
    if (e.code === 'ArrowDown') startDuck();
}

function handleKeyUp(e) {
    if (e.code === 'ArrowDown') endDuck();
}

function jump() {
    if (isGrounded && !isDucking) {
        velocityY = CONFIG.JUMP_FORCE;
        isGrounded = false;
        createDust(playerGroup.position.x, playerGroup.position.y, 5);
    }
}

function startDuck() {
    if (isGrounded && !isDucking) {
        isDucking = true;
        playerParts.torso.scale.y = 0.5;
        playerParts.torso.position.y = 2.0;
        playerParts.head.position.y = 2.8;
        createDust(playerGroup.position.x, playerGroup.position.y, 3);
    }
}

function endDuck() {
    if (isDucking) {
        isDucking = false;
        playerParts.torso.scale.y = 1;
        playerParts.torso.position.y = 2.4;
        playerParts.head.position.y = 3.6;
    }
}

function createDust(x, y, count) {
    for(let i=0; i<count; i++) {
        const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
        const mat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.8 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x + (Math.random() - 0.5), y + 0.5, (Math.random() - 0.5));
        scene.add(mesh);
        particles.push({ mesh, life: 1.0, vel: new THREE.Vector3((Math.random()-0.5)*5, Math.random()*5, (Math.random()-0.5)) });
    }
}

function spawnObstacle() {
    const type = Math.random();
    let mesh, collider;
    
    const group = new THREE.Group();
    group.position.set(100, CONFIG.GROUND_Y, 0); // Spawn far right

    if (type > 0.4) {
        // CACTUS (Jump over)
        const h = 2 + Math.random() * 1.5; 
        const w = 0.8 + Math.random() * 0.4; 
        
        const mat = new THREE.MeshToonMaterial({ color: 0x2ecc71 });
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(w, w, h, 8), mat);
        trunk.position.y = h/2;
        trunk.castShadow = true;
        group.add(trunk);

        if (h > 2.5) {
            const armH = h * 0.4;
            const armW = w * 0.8;
            const rArm = new THREE.Mesh(new THREE.CylinderGeometry(armW, armW, armH, 8), mat);
            rArm.position.set(w, h*0.6, 0);
            rArm.rotation.z = -Math.PI/4;
            trunk.add(rArm);
            const lArm = new THREE.Mesh(new THREE.CylinderGeometry(armW, armW, armH, 8), mat);
            lArm.position.set(-w, h*0.4, 0);
            lArm.rotation.z = Math.PI/4;
            trunk.add(lArm);
        }

        collider = { type: 'jump', w: w*2, h: h };
        mesh = trunk;
    } else {
        // BARRIER (Duck under)
        const w = 1.0; 
        const laneWidth = 12; 

        const poleMat = new THREE.MeshStandardMaterial({color: 0x555555});
        const pole1 = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 6), poleMat);
        pole1.position.set(0, 3, -laneWidth/3);
        group.add(pole1);
        const pole2 = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 6), poleMat);
        pole2.position.set(0, 3, laneWidth/3);
        group.add(pole2);
        
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, laneWidth), new THREE.MeshPhongMaterial({color: 0xffaa00}));
        bar.position.y = 4.0; // Lowered bar so it's impossible to stand under
        group.add(bar);
        
        mesh = bar; 
        collider = { type: 'duck', w, yLow: 3.5 }; // Barrier bottom is at 3.5
    }

    scene.add(group);
    obstacles.push({ group, collider });
}

function updatePhysics(dt) {
    if (!isPlaying) return;

    // Player Physics
    if (!isGrounded && !isDucking) {
        velocityY += CONFIG.GRAVITY * dt;
        playerGroup.position.y += velocityY * dt;

        if (playerGroup.position.y <= CONFIG.GROUND_Y) {
            playerGroup.position.y = CONFIG.GROUND_Y;
            velocityY = 0;
            isGrounded = true;
            createDust(playerGroup.position.x, CONFIG.GROUND_Y, 8);
        }
    } else if (isDucking) {
        playerGroup.position.y = CONFIG.GROUND_Y;
        velocityY = 0;
    }

    const moveDist = gameSpeed * dt;
    
    backgroundBuildings.forEach(b => {
        b.position.x -= moveDist * 0.2;
        if (b.position.x < -50) b.position.x += 450;
    });

    for (let i = obstacles.length - 1; i >= 0; i--) {
        const obs = obstacles[i];
        obs.group.position.x -= moveDist;

        if (obs.group.position.x < -20) {
            scene.remove(obs.group);
            obstacles.splice(i, 1);
            continue;
        }

        // Collision Logic
        const pX = playerGroup.position.x;
        const oX = obs.group.position.x;
        const dx = Math.abs(pX - oX);
        
        // Horizontal hit check
        if (dx < (obs.collider.w / 2 + 0.4)) {
            const feetY = playerGroup.position.y - CONFIG.GROUND_Y; 
            
            if (obs.collider.type === 'jump') {
                if (feetY < obs.collider.h) {
                    gameOver();
                }
            } else if (obs.collider.type === 'duck') {
                // Standing head top is ~4.3
                // Siu slide head top is ~2.2 (very low)
                const headY = feetY + (isDucking ? 2.2 : 4.3);
                
                // If head top is higher than barrier bottom, YOU DIE
                if (headY > obs.collider.yLow) {
                    gameOver();
                }
            }
        }
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt * 2;
        p.mesh.position.addScaledVector(p.vel, dt);
        p.mesh.scale.setScalar(p.life);
        
        if (p.life <= 0) {
            scene.remove(p.mesh);
            particles.splice(i, 1);
        }
    }
}

function animate() {
    requestAnimationFrame(animate);

    const dt = Math.min(clock.getDelta(), 0.1);
    const time = clock.getElapsedTime();

    if (isPlaying) {
        spawnTimer += dt;
        if (spawnTimer > nextSpawnDelay) {
            spawnObstacle();
            spawnTimer = 0;
            nextSpawnDelay = Math.max(1.0, 3.0 - (gameSpeed / 50));
        }

        updatePhysics(dt);
        updateParticles(dt);

        if (gameSpeed < CONFIG.MAX_SPEED) gameSpeed += CONFIG.SPEED_INC * dt;
        score += gameSpeed * dt * 0.1;
        ui.score.textContent = Math.floor(score).toString().padStart(5, '0');
        
        if (isGrounded && !isDucking && Math.sin(time * 20) > 0.95) {
             createDust(playerGroup.position.x - 0.5, CONFIG.GROUND_Y, 1);
        }

        // Siuuu Slide Particles
        if (isDucking) {
            createDust(playerGroup.position.x - 1, CONFIG.GROUND_Y, 2);
        }

        // Dynamic Camera
        const targetCamX = 5 + (gameSpeed * 0.1); 
        camera.position.x += (targetCamX - camera.position.x) * dt;
        camera.lookAt(playerGroup.position.x + 15, 2, 0);
    }

    // Animation System
    if (isPlaying) {
        if (isDucking) {
            // SIU SLIDE POSE
            playerGroup.rotation.z = 0; // Upright
            playerGroup.rotation.y = Math.PI / 2; // Facing forward

            // Lower Body
            playerParts.torso.position.y = 1.0; 
            playerParts.head.position.y = 2.2; 
            playerParts.headband.position.y = 2.3;

            // Legs (Kneeling/Drifting)
            playerParts.lLeg.position.y = 0.5;
            playerParts.rLeg.position.y = 0.5;
            playerParts.lLeg.rotation.x = -1.5; // Dragging behind
            playerParts.rLeg.rotation.x = -1.5;

            // Arms (Siu Chop - Down and firm)
            playerParts.lArm.position.y = 1.6; // Adjust shoulder height
            playerParts.rArm.position.y = 1.6;
            playerParts.lArm.rotation.x = 0.6; 
            playerParts.rArm.rotation.x = 0.6;

        } else {
            // RESTORE STANDING POSE
            playerGroup.rotation.z = 0;
            playerGroup.rotation.y = Math.PI / 2;

            // Restore Offsets
            playerParts.torso.position.y = 2.4;
            playerParts.head.position.y = 3.6;
            playerParts.headband.position.y = 3.7;
            
            playerParts.lLeg.position.y = 1.6;
            playerParts.rLeg.position.y = 1.6;
            playerParts.lArm.position.y = 3.0;
            playerParts.rArm.position.y = 3.0;

            if (!isGrounded) {
                // JUMP POSE
                playerParts.lLeg.rotation.x = -0.5;
                playerParts.rLeg.rotation.x = 0.5;
                playerParts.lArm.rotation.x = -2.5;
                playerParts.rArm.rotation.x = -2.5;
            } else {
                // RUN CYCLE
                const s = time * 20;
                playerParts.lLeg.rotation.x = Math.sin(s) * 1.0;
                playerParts.rLeg.rotation.x = Math.sin(s + Math.PI) * 1.0;
                playerParts.lArm.rotation.x = Math.sin(s + Math.PI) * 1.0;
                playerParts.rArm.rotation.x = Math.sin(s) * 1.0;
            }
        }
    }

    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
