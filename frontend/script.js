// Game Elements
const gameWindow = document.getElementById('gameWindow');
const office = document.getElementById('office');
const cameraOverlay = document.getElementById('cameraOverlay');
const cameraFeed = document.getElementById('cameraFeed');
const cameraAnimation = document.getElementById('cameraAnimation');
const cameraContainer = document.getElementById('cameraContainer');
const powerUsageImg = document.getElementById('powerUsageImg');
const mainMenu = document.getElementById('mainMenu');
const menuBg = document.getElementById('menuBg');
const menuTitle = document.getElementById('menuTitle');
const camNameTag = document.getElementById('camNameTag');

// UI Elements
const timeDisplay = document.getElementById('timeDisplay');
const powerDisplay = document.getElementById('powerDisplay');
const usageDisplay = document.getElementById('usageDisplay');

// State Variables
let mouseX = 0;
// The office plate is 1600x720 against a 1280x720 frame, so #office is 125% wide
// and `left` travels from 0% (hard right) to -25% (hard left); -12.5% is centred.
const OFFICE_PAN_MIN = -25;
const OFFICE_PAN_MAX = 0;
const DEFAULT_CAMERA_PAN = -12.5;
// Constant-speed pan: percent of #office width per second. 60 crosses the full
// 320px of overflow in a little under half a second.
const OFFICE_PAN_SPEED = 60;
let cameraPan = DEFAULT_CAMERA_PAN;
let isCameraUp = false;
let selectedCamera = '1A';
let currentNight = 1;
let currentRoomId = null;
let currentState = null;

// CCTV pan variables
let cctvState = 'MOVING'; // 'MOVING' or 'WAITING'
let cctvStartTime = Date.now();
let cctvStartPan = -3;
let cctvTargetPan = 3;
let cctvPanX = -3;
// The feed sits centred with 160px of plate hidden on each side, so a ±6%
// (96px) drift stays inside the artwork and never exposes a black edge.
const CCTV_PAN_RANGE = 6;
const CCTV_MOVE_DURATION = 2200; // 2.2 seconds (slightly faster slide)
const CCTV_WAIT_DURATION = 2000; // 2 seconds

function updateCctvPan() {
    if (!isCameraUp) {
        cctvState = 'MOVING';
        cctvStartTime = Date.now();
        cctvStartPan = -CCTV_PAN_RANGE;
        cctvTargetPan = CCTV_PAN_RANGE;
        cctvPanX = cctvStartPan;
        return;
    }

    const now = Date.now();
    const elapsed = now - cctvStartTime;

    if (cctvState === 'MOVING') {
        const progress = Math.min(1, elapsed / CCTV_MOVE_DURATION);
        const easeProgress = 0.5 - Math.cos(progress * Math.PI) / 2;
        cctvPanX = cctvStartPan + (cctvTargetPan - cctvStartPan) * easeProgress;

        if (progress >= 1) {
            cctvState = 'WAITING';
            cctvStartTime = Date.now();
            cctvPanX = cctvTargetPan;
        }
    } else if (cctvState === 'WAITING') {
        cctvPanX = cctvTargetPan;
        if (elapsed >= CCTV_WAIT_DURATION) {
            cctvState = 'MOVING';
            cctvStartTime = Date.now();
            cctvStartPan = cctvTargetPan;
            cctvTargetPan = -cctvTargetPan;
        }
    }

    cameraFeed.style.transform = `translateX(${cctvPanX}%)`;
}

/* --------------------------- Text plate matting ---------------------------
   The extracted text assets lost their alpha channel: each one is exactly two
   flat colours, white text sitting on a solid grey matte. The matte value is
   not consistent across the set — 90,90,90 on most, 83,83,83 on READY,
   180,180,180 on the CAM 4B map label — so it is detected rather than assumed.

   Left alone they render as grey boxes floating over the scene. Key the matte
   back out once per asset and cache the result.

   Detection requires the image to be two colours covering ~all of it, both
   neutral grey, and keys the darker one. Photographs (the animatronic
   portraits, the power gauge) have thousands of colours and are left alone —
   and only elements tagged .text-plate are ever passed in.                  */
const plateCache = new Map();

function keyOutPlateMatte(src) {
    if (plateCache.has(src)) return plateCache.get(src);

    const job = new Promise(resolve => {
        const img = new Image();
        img.onerror = () => resolve(src);
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(img, 0, 0);

                const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const px = image.data;
                const total = px.length / 4;

                const tally = new Map();
                for (let i = 0; i < px.length; i += 4) {
                    if (px[i + 3] < 250) continue;
                    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
                    tally.set(key, (tally.get(key) || 0) + 1);
                }

                const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
                if (top.length !== 2 || (top[0][1] + top[1][1]) / total < 0.98) { resolve(src); return; }

                const isNeutral = key => {
                    const r = key >> 16, g = (key >> 8) & 255, b = key & 255;
                    return Math.abs(r - g) <= 4 && Math.abs(g - b) <= 4;
                };
                if (!isNeutral(top[0][0]) || !isNeutral(top[1][0])) { resolve(src); return; }

                // Text is the lighter of the two; the matte is what's behind it.
                const matte = Math.min(top[0][0] >> 16, top[1][0] >> 16);

                for (let i = 0; i < px.length; i += 4) {
                    if (Math.abs(px[i] - matte) <= 6 &&
                        Math.abs(px[i + 1] - matte) <= 6 &&
                        Math.abs(px[i + 2] - matte) <= 6) {
                        px[i + 3] = 0;
                    }
                }
                ctx.putImageData(image, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            } catch (err) {
                resolve(src);
            }
        };
        img.src = src;
    });

    plateCache.set(src, job);
    return job;
}

// Use this instead of assigning .src directly on any element carrying .text-plate.
function setPlateSrc(el, src) {
    if (!el || !src) return;
    el.dataset.plateSrc = src;
    keyOutPlateMatte(src).then(url => {
        if (el.dataset.plateSrc === src) el.src = url;
    });
}

function initTextPlates() {
    document.querySelectorAll('img.text-plate').forEach(el => {
        setPlateSrc(el, el.getAttribute('src'));
    });
    // Warm the cache for plates that get swapped in mid-game, so the first
    // camera switch or night intro doesn't flash the un-keyed version.
    Object.keys(CAMERA_NAMES).forEach(cam => keyOutPlateMatte(`textures/camera/camera names/${cam}.png`));
    [1, 2, 3, 4, 5, 6, 7].forEach(n => keyOutPlateMatte('textures/main menu/' + getNightIntroFilename(n)));
}

// Camera name lookup
const CAMERA_NAMES = {
    '1A': 'Show Stage',
    '1B': 'Dining Area',
    '1C': 'Pirate Cove',
    '2A': 'West Hall',
    '2B': 'W. Hall Corner',
    '3': 'Supply Closet',
    '4A': 'East Hall',
    '4B': 'E. Hall Corner',
    '5': 'Backstage',
    '6': 'Kitchen',
    '7': 'Restrooms'
};

// Tracking animatronic positions to regenerate a/b randomized variants
let previousLocations = {};
let animatronicVariants = {
    'bonnie_1B': 'a',
    'chica_1B': 'a',
    'chica_4A': 'a',
    'bonnie_5': 'a',
    'chica_7': 'a'
};

// Audio Manager
const audioSources = {
    static: 'audio/garble1.wav',
    garble1: 'audio/garble1.wav',
    garble2: 'audio/garble2.wav',
    garble3: 'audio/garble3.wav',
    windowscare: 'audio/windowscare.wav',
    powerdown: 'audio/powerdown.wav',
    jumpscare: 'audio/XSCREAM.wav',
    doorClick: 'audio/SFXBible_12478.wav',
    lightClick: 'audio/lights on.mp3',
    cam_open: 'audio/cam open.mp3',
    on_cam: 'audio/on_cam.wav',
    Blip3: 'audio/Blip3.mp3',
    put_down: 'audio/put down.wav',
    ambience: 'audio/office ambience.mp3',
    menuAmbience: 'audio/main menu ambience.mp3',
    error: 'audio/error.wav',
    musicBox: 'audio/music box.wav',
    win: 'audio/win.mp3',
    run: 'audio/run.wav',
    knock2: 'audio/knock2.wav',
    randomsound1: 'audio/randomsound1.mp3',
    randomsound2: 'audio/randomsound2.wav',
    freddyLaugh1: 'audio/Laugh_Giggle_Girl_1d.wav',
    freddyLaugh2: 'audio/Laugh_Giggle_Girl_2d.wav',
    freddyLaugh3: 'audio/Laugh_Giggle_Girl_8d.wav',
    mainMenu2: 'audio/main_menu1.wav',
    oven1: 'audio/OVEN-DRAWE_GEN-HDF18122.wav',
    oven2: 'audio/OVEN-DRA_1_GEN-HDF18119.wav',
    oven3: 'audio/OVEN-DRA_2_GEN-HDF18120.wav',
    oven4: 'audio/OVEN-DRA_7_GEN-HDF18121.wav'
};

const audio = {};
let audioUnlocked = false;

function ensureAudio(name) {
    if (audio[name]) return audio[name];

    const src = audioSources[name];
    if (!src) return null;

    const sound = new Audio(src);
    sound.preload = 'auto';
    sound.volume = 0.5;
    audio[name] = sound;

    if (name === 'ambience' || name === 'on_cam') {
        sound.loop = true;
        sound.volume = 0.3;
    }

    if (name === 'menuAmbience') {
        sound.loop = false;
        sound.volume = 0.3;
        sound.addEventListener('ended', () => {
            sound.currentTime = 0;
            sound.play().catch(() => { });
            const menu2 = ensureAudio('mainMenu2');
            if (menu2) {
                menu2.currentTime = 0;
                menu2.play().catch(() => { });
            }
        });
    }

    return sound;
}

function stopSound(name) {
    const sound = audio[name];
    if (sound) {
        sound.pause();
        sound.currentTime = 0;
    }
}

function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    startMenuMusic();
}

function playSound(name) {
    const sound = ensureAudio(name);
    if (!sound || typeof sound.play !== 'function') return;

    try {
        sound.currentTime = 0;
        sound.volume = (name === 'ambience' || name === 'menuAmbience') ? 0.3 : 0.5;
        sound.play().catch(() => { });
    } catch (error) {
        console.warn('Audio play failed:', name, error);
    }
}

window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

// Measure against the letterboxed game frame, not the viewport: on any window
// that isn't exactly 16:9 there are black bars, and dividing by innerWidth put
// the pan trigger zones in the wrong place (and never let you reach the edges).
document.addEventListener('mousemove', (e) => {
    const rect = gameWindow.getBoundingClientRect();
    if (!rect.width) return;
    mouseX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
});

function checkVariants(state) {
    if (!state || !state.animatronics) return;
    for (const [name, data] of Object.entries(state.animatronics)) {
        const loc = data.location;
        if (previousLocations[name] !== loc) {
            const roll = Math.random() < 0.5 ? 'a' : 'b';
            if (name === 'bonnie' && loc === '1B') animatronicVariants['bonnie_1B'] = roll;
            if (name === 'chica' && loc === '1B') animatronicVariants['chica_1B'] = roll;
            if (name === 'chica' && loc === '4A') animatronicVariants['chica_4A'] = roll;
            if (name === 'bonnie' && loc === '5') animatronicVariants['bonnie_5'] = roll;
            if (name === 'chica' && loc === '7') animatronicVariants['chica_7'] = roll;
            previousLocations[name] = loc;
        }
    }
}

function updateOfficeTexture(state) {
    if (!state || !state.animatronics) return;
    const a = state.animatronics;

    if (state.power <= 0) {
        office.style.backgroundImage = "url('textures/office/power out.png')";
    } else if (state.lights.left) {
        if (a.bonnie.location === 'office_door_left') {
            office.style.backgroundImage = "url('textures/office/bonnie visible.png')";
        } else {
            office.style.backgroundImage = "url('textures/office/left light open.png')";
        }
    } else if (state.lights.right) {
        if (a.chica.location === 'office_door_right') {
            office.style.backgroundImage = "url('textures/office/chica visible.png')";
        } else {
            office.style.backgroundImage = "url('textures/office/right light open.png')";
        }
    } else {
        office.style.backgroundImage = "url('textures/office/default.png')";
    }
}

function updateDoorTexture(doorEl, side, isOpen) {
    if (!doorEl) return;
    const closedTexture = side === 'left' ? 'textures/doors/left/100.png' : 'textures/doors/right/104.png';
    const openTexture = side === 'left' ? 'textures/doors/left/101.png' : 'textures/doors/right/106.png';
    doorEl.style.backgroundImage = `url('${isOpen ? openTexture : closedTexture}')`;
}

function updateDoorTextureAnimated(doorEl, side, isClosed) {
    if (!doorEl) return;
    const leftClosingFrames = [
        'textures/doors/left/86.png',
        'textures/doors/left/87.png',
        'textures/doors/left/88.png',
        'textures/doors/left/89.png',
        'textures/doors/left/91.png',
        'textures/doors/left/92.png',
        'textures/doors/left/93.png',
        'textures/doors/left/94.png',
        'textures/doors/left/95.png',
        'textures/doors/left/96.png',
        'textures/doors/left/97.png',
        'textures/doors/left/98.png',
        'textures/doors/left/99.png',
        'textures/doors/left/100.png'
    ];
    const rightClosingFrames = [
        'textures/doors/right/103.png',
        'textures/doors/right/104.png',
        'textures/doors/right/105.png',
        'textures/doors/right/106.png',
        'textures/doors/right/107.png',
        'textures/doors/right/108.png',
        'textures/doors/right/109.png',
        'textures/doors/right/110.png',
        'textures/doors/right/111.png',
        'textures/doors/right/112.png',
        'textures/doors/right/113.png',
        'textures/doors/right/114.png',
        'textures/doors/right/115.png',
        'textures/doors/right/116.png',
        'textures/doors/right/117.png',
        'textures/doors/right/118.png'
    ];

    const closing = side === 'left' ? leftClosingFrames : rightClosingFrames;
    const frames = isClosed ? closing : [...closing].reverse();

    if (doorEl._doorAnimInterval) {
        clearInterval(doorEl._doorAnimInterval);
    }

    doorEl.style.display = 'block';
    let idx = 0;
    doorEl._doorAnimInterval = setInterval(() => {
        if (idx < frames.length) {
            doorEl.style.backgroundImage = `url('${frames[idx]}')`;
            idx++;
        } else {
            clearInterval(doorEl._doorAnimInterval);
            doorEl._doorAnimInterval = null;
            if (!isClosed) {
                doorEl.style.display = 'none';
            }
        }
    }, 16);
}

let isFoxySprinting = false;

const kitchenText = document.getElementById('kitchenText');

function setKitchenTextVisible(visible) {
    if (kitchenText) kitchenText.style.display = visible ? 'block' : 'none';
}

function updateCameraTexture(state) {
    if (isFoxySprinting) {
        setKitchenTextVisible(false);
        return;
    }
    if (!state || !state.cameraUp) {
        cameraFeed.style.display = 'none';
        setKitchenTextVisible(false);
        return;
    }

    if (cameraBlackoutActive) {
        cameraFeed.style.display = 'none';
        setKitchenTextVisible(false);
        cameraOverlay.style.backgroundImage = 'none';
        cameraOverlay.style.backgroundColor = '#000';
        return;
    }

    cameraFeed.style.display = 'block';
    applyCameraBackground();

    const cam = selectedCamera;
    const a = state.animatronics;
    let imgSrc = `${cam}.png`;

    const fLoc = a.freddy.location;
    const bLoc = a.bonnie.location;
    const cLoc = a.chica.location;
    const fxLoc = a.foxy.location;
    const fxStage = a.foxy.foxyStage;

    if (cam === '1A') {
        const fAt1A = fLoc === '1A';
        const bAt1A = bLoc === '1A';
        const cAt1A = cLoc === '1A';

        if (fAt1A && bAt1A && cAt1A) {
            imgSrc = '1A.png'; // Default when no animatronics leave stage
        } else if (fAt1A && cAt1A && !bAt1A) {
            imgSrc = '1A bonnie.png'; // Bonnie leaves 1A (stage without Bonnie)
        } else if (fAt1A && bAt1A && !cAt1A) {
            imgSrc = '1A chica.png'; // Chica leaves 1A (stage without Chica)
        } else if (fAt1A && !bAt1A && !cAt1A) {
            imgSrc = '1A bonnie_chica.png'; // Both Bonnie and Chica leave
        } else if (!fAt1A && !bAt1A && !cAt1A) {
            imgSrc = '1A all.png'; // All three leave 1A
        } else {
            imgSrc = '1A.png';
        }
    }
    else if (cam === '1B') {
        if (fLoc === '1B') imgSrc = '1B freddy.png';
        else if (bLoc === '1B') imgSrc = `1B bonnie_${animatronicVariants['bonnie_1B']}.png`;
        else if (cLoc === '1B') imgSrc = `1B chica_${animatronicVariants['chica_1B']}.png`;
        else imgSrc = '1B.png';
    }
    else if (cam === '1C') {
        if (fxStage === 1) imgSrc = '1C stage_1.png';
        else if (fxStage === 2) imgSrc = '1C stage_2.png';
        else if (fxStage === 3) imgSrc = '1C stage_3.png';
        else imgSrc = '1C.png';
    }
    else if (cam === '2A') {
        if (bLoc === '2A') imgSrc = '2A bonnie.png';
        else imgSrc = '2A.png';
    }
    else if (cam === '2B') {
        if (bLoc === '2B') imgSrc = '2B bonnie.png';
        else imgSrc = '2B.png';
    }
    else if (cam === '3') {
        if (bLoc === '3') imgSrc = '3 bonnie.png';
        else imgSrc = '3.png';
    }
    else if (cam === '4A') {
        if (fLoc === '4A') imgSrc = '4A freddy.png';
        else if (cLoc === '4A') imgSrc = `4A chica_${animatronicVariants['chica_4A']}.png`;
        else imgSrc = '4A.png';
    }
    else if (cam === '4B') {
        if (fLoc === '4B') imgSrc = '4B freddy.png';
        else if (cLoc === '4B') imgSrc = '4B chica.png';
        else imgSrc = '4B.png';
    }
    else if (cam === '5') {
        if (bLoc === '5') imgSrc = `5 bonnie_${animatronicVariants['bonnie_5']}.png`;
        else imgSrc = '5.png';
    }
    else if (cam === '6') {
        imgSrc = 'cam assets/6.png'; // Kitchen Disabled Feed
    }
    else if (cam === '7') {
        if (fLoc === '7') imgSrc = '7 freddy.png';
        else if (cLoc === '7') imgSrc = `7 chica_${animatronicVariants['chica_7']}.png`;
        else imgSrc = '7.png';
    }

    if (cam === '6') {
        // The kitchen camera is dead in the original — black plate plus the
        // "CAMERA DISABLED / AUDIO ONLY" caption.
        cameraFeed.style.display = 'none';
        cameraOverlay.style.backgroundImage = 'none';
        cameraOverlay.style.backgroundColor = '#000';
        setKitchenTextVisible(true);
    } else {
        setKitchenTextVisible(false);
        cameraFeed.src = 'textures/camera/' + imgSrc;
    }
}

const jumpscareFrames = {
    bonnie: [
        'textures/jumpscares/bonnie/291.png',
        'textures/jumpscares/bonnie/293.png',
        'textures/jumpscares/bonnie/294.png',
        'textures/jumpscares/bonnie/295.png',
        'textures/jumpscares/bonnie/296.png',
        'textures/jumpscares/bonnie/297.png',
        'textures/jumpscares/bonnie/298.png',
        'textures/jumpscares/bonnie/299.png',
        'textures/jumpscares/bonnie/300.png',
        'textures/jumpscares/bonnie/301.png',
        'textures/jumpscares/bonnie/303.png'
    ],
    chica: [
        'textures/jumpscares/chica/216.png',
        'textures/jumpscares/chica/228.png',
        'textures/jumpscares/chica/229.png',
        'textures/jumpscares/chica/230.png',
        'textures/jumpscares/chica/231.png',
        'textures/jumpscares/chica/232.png',
        'textures/jumpscares/chica/233.png',
        'textures/jumpscares/chica/234.png',
        'textures/jumpscares/chica/235.png',
        'textures/jumpscares/chica/236.png',
        'textures/jumpscares/chica/237.png',
        'textures/jumpscares/chica/239.png',
        'textures/jumpscares/chica/279.png',
        'textures/jumpscares/chica/281.png'
    ],
    foxy: [
        'textures/jumpscares/foxy/242.png',
        'textures/jumpscares/foxy/243.png',
        'textures/jumpscares/foxy/396.png',
        'textures/jumpscares/foxy/397.png',
        'textures/jumpscares/foxy/398.png',
        'textures/jumpscares/foxy/399.png',
        'textures/jumpscares/foxy/400.png',
        'textures/jumpscares/foxy/401.png',
        'textures/jumpscares/foxy/402.png',
        'textures/jumpscares/foxy/403.png',
        'textures/jumpscares/foxy/404.png',
        'textures/jumpscares/foxy/405.png',
        'textures/jumpscares/foxy/406.png',
        'textures/jumpscares/foxy/407.png',
        'textures/jumpscares/foxy/408.png',
        'textures/jumpscares/foxy/409.png',
        'textures/jumpscares/foxy/410.png',
        'textures/jumpscares/foxy/411.png',
        'textures/jumpscares/foxy/412.png'
    ],
    freddy: [
        'textures/jumpscares/freddy/489.png',
        'textures/jumpscares/freddy/490.png',
        'textures/jumpscares/freddy/491.png',
        'textures/jumpscares/freddy/493.png',
        'textures/jumpscares/freddy/495.png',
        'textures/jumpscares/freddy/496.png',
        'textures/jumpscares/freddy/497.png',
        'textures/jumpscares/freddy/498.png',
        'textures/jumpscares/freddy/499.png',
        'textures/jumpscares/freddy/500.png',
        'textures/jumpscares/freddy/501.png',
        'textures/jumpscares/freddy/502.png',
        'textures/jumpscares/freddy/503.png',
        'textures/jumpscares/freddy/504.png',
        'textures/jumpscares/freddy/505.png',
        'textures/jumpscares/freddy/506.png',
        'textures/jumpscares/freddy/507.png',
        'textures/jumpscares/freddy/508.png',
        'textures/jumpscares/freddy/509.png',
        'textures/jumpscares/freddy/510.png',
        'textures/jumpscares/freddy/511.png',
        'textures/jumpscares/freddy/512.png',
        'textures/jumpscares/freddy/513.png',
        'textures/jumpscares/freddy/514.png',
        'textures/jumpscares/freddy/515.png',
        'textures/jumpscares/freddy/516.png',
        'textures/jumpscares/freddy/517.png',
        'textures/jumpscares/freddy/518.png'
    ],
    freddy2: [
        'textures/jumpscares/freddy 2/301.png',
        'textures/jumpscares/freddy 2/305.png',
        'textures/jumpscares/freddy 2/307.png',
        'textures/jumpscares/freddy 2/308.png',
        'textures/jumpscares/freddy 2/309.png',
        'textures/jumpscares/freddy 2/310.png',
        'textures/jumpscares/freddy 2/311.png',
        'textures/jumpscares/freddy 2/312.png',
        'textures/jumpscares/freddy 2/313.png',
        'textures/jumpscares/freddy 2/314.png',
        'textures/jumpscares/freddy 2/315.png',
        'textures/jumpscares/freddy 2/316.png',
        'textures/jumpscares/freddy 2/317.png',
        'textures/jumpscares/freddy 2/318.png',
        'textures/jumpscares/freddy 2/319.png',
        'textures/jumpscares/freddy 2/320.png',
        'textures/jumpscares/freddy 2/321.png',
        'textures/jumpscares/freddy 2/322.png',
        'textures/jumpscares/freddy 2/323.png',
        'textures/jumpscares/freddy 2/324.png',
        'textures/jumpscares/freddy 2/325.png'
    ]
};

function preloadJumpscareImages() {
    for (const frames of Object.values(jumpscareFrames)) {
        frames.forEach(src => {
            const img = new Image();
            img.src = src;
        });
    }
}
preloadJumpscareImages();

const staticFrames = [
    'textures/static/12.png',
    'textures/static/13.png',
    'textures/static/14.png',
    'textures/static/15.png',
    'textures/static/16.png',
    'textures/static/17.png',
    'textures/static/18.png',
    'textures/static/20.png'
];

staticFrames.forEach(src => {
    const img = new Image();
    img.src = src;
});

let staticFrameIndex = 0;

function updateStaticOverlay() {
    staticFrameIndex = (staticFrameIndex + 1) % staticFrames.length;
    const currentFrame = staticFrames[staticFrameIndex];

    // 1. Main Menu Static Overlay: Random low opacity so Freddy & menu items stay visible
    const menuStatic = document.getElementById('menuStatic');
    const mainMenu = document.getElementById('mainMenu');
    if (menuStatic && mainMenu && mainMenu.style.display !== 'none') {
        menuStatic.src = currentFrame;
        menuStatic.style.opacity = (0.06 + Math.random() * 0.16).toFixed(2);
    }

    // 2. Camera Static Overlay: Reduced opacity so camera view is visible underneath
    const cameraStatic = document.getElementById('cameraStatic');
    if (cameraStatic && typeof isCameraUp !== 'undefined' && isCameraUp) {
        cameraStatic.src = currentFrame;
        cameraStatic.style.opacity = (0.20 + Math.random() * 0.10).toFixed(2);
    }

    // 3. Death Static Screen: Full opacity (1.0)
    const deathStaticImg = document.getElementById('deathStaticImg');
    const deathStaticScreen = document.getElementById('deathStaticScreen');
    if (deathStaticImg && deathStaticScreen && deathStaticScreen.style.display !== 'none') {
        deathStaticImg.src = currentFrame;
        deathStaticImg.style.opacity = '1.0';
    }
}

setInterval(updateStaticOverlay, 50);

let jumpscareAnimInterval = null;
let jumpscareSequenceTimeout = null;
let deathStaticTimeout = null;

function showGameOverScreen() {
    const gameOverScreen = document.getElementById('gameOverScreen');
    if (!gameOverScreen) {
        returnToMainMenu(false);
        return;
    }

    stopSound('ambience');
    stopSound('on_cam');
    stopSound('garble1');
    if (typeof stopPowerOutageSequence === 'function') {
        stopPowerOutageSequence();
    }

    gameOverScreen.style.display = 'flex';

    function onGameOverClick(e) {
        if (e.button !== undefined && e.button !== 0) return;
        gameOverScreen.removeEventListener('click', onGameOverClick);
        gameOverScreen.style.display = 'none';
        returnToMainMenu(false);
    }

    gameOverScreen.removeEventListener('click', onGameOverClick);
    gameOverScreen.addEventListener('click', onGameOverClick);
}

function triggerJumpscare(reason) {
    const jumpscare = document.getElementById('jumpscare');
    const deathStaticScreen = document.getElementById('deathStaticScreen');
    const gameOverScreen = document.getElementById('gameOverScreen');
    const anim = jumpscareFrames[reason] || jumpscareFrames.freddy;

    if (jumpscareAnimInterval) {
        clearInterval(jumpscareAnimInterval);
        jumpscareAnimInterval = null;
    }
    if (jumpscareSequenceTimeout) clearTimeout(jumpscareSequenceTimeout);
    if (deathStaticTimeout) clearTimeout(deathStaticTimeout);

    if (deathStaticScreen) deathStaticScreen.style.display = 'none';
    if (gameOverScreen) gameOverScreen.style.display = 'none';

    playSound('jumpscare');
    if (jumpscare) {
        jumpscare.style.display = 'block';
        jumpscare.style.zIndex = '1000';
    }

    // Drive the frames off elapsed time rather than a fixed step, so the whole
    // sheet spans exactly totalDurationMs no matter how many frames it has.
    // (The old fixed step was floored, so the sheet finished early and looped
    // back to frame 0 for the remainder — the scare visibly restarted.)
    const totalDurationMs = 1000;
    const startTime = performance.now();
    let lastIdx = -1;

    if (jumpscare) jumpscare.src = anim[0];

    jumpscareAnimInterval = setInterval(() => {
        const progress = (performance.now() - startTime) / totalDurationMs;
        const idx = Math.min(anim.length - 1, Math.floor(progress * anim.length));
        if (idx !== lastIdx) {
            lastIdx = idx;
            if (jumpscare) jumpscare.src = anim[idx];
        }
        if (idx >= anim.length - 1) {
            // Hold the final frame until the sequence timeout takes over.
            clearInterval(jumpscareAnimInterval);
            jumpscareAnimInterval = null;
        }
    }, 8);

    // 1. Jumpscare plays for 1 second
    jumpscareSequenceTimeout = setTimeout(() => {
        if (jumpscareAnimInterval) {
            clearInterval(jumpscareAnimInterval);
            jumpscareAnimInterval = null;
        }
        if (jumpscare) jumpscare.style.display = 'none';
        stopSound('jumpscare');

        // 2. Full opacity death static screen plays for 3 seconds
        playSound('garble1');
        if (deathStaticScreen) {
            deathStaticScreen.style.display = 'block';
        }

        deathStaticTimeout = setTimeout(() => {
            stopSound('garble1');
            if (deathStaticScreen) {
                deathStaticScreen.style.display = 'none';
            }

            // 3. Move to Game Over screen
            showGameOverScreen();
        }, 3000);
    }, totalDurationMs);
}

let winSequenceTimeout1 = null;
let winSequenceTimeout2 = null;

function triggerWinSequence(callback) {
    const winScreen = document.getElementById('winScreen');
    const winDigit5 = document.getElementById('winDigit5');
    const winDigit6 = document.getElementById('winDigit6');

    if (winSequenceTimeout1) clearTimeout(winSequenceTimeout1);
    if (winSequenceTimeout2) clearTimeout(winSequenceTimeout2);

    if (!winScreen || !winDigit5 || !winDigit6) {
        if (typeof callback === 'function') callback();
        return;
    }

    stopSound('ambience');
    stopSound('on_cam');
    if (typeof stopPowerOutageSequence === 'function') {
        stopPowerOutageSequence();
    }

    // Reset initial digit positions (5 in view, 6 below view)
    winDigit5.style.transition = 'none';
    winDigit6.style.transition = 'none';
    winDigit5.style.transform = 'translateY(0%)';
    winDigit6.style.transform = 'translateY(0%)';

    void winDigit5.offsetHeight;

    winScreen.style.display = 'flex';
    playSound('win');

    // Phase 1: Show 5 AM for 1.5 seconds, then animate 5 sliding up and 6 sliding in
    winSequenceTimeout1 = setTimeout(() => {
        winDigit5.style.transition = 'transform 1.8s cubic-bezier(0.4, 0, 0.2, 1)';
        winDigit6.style.transition = 'transform 1.8s cubic-bezier(0.4, 0, 0.2, 1)';
        winDigit5.style.transform = 'translateY(-100%)';
        winDigit6.style.transform = 'translateY(-100%)';

        winSequenceTimeout2 = setTimeout(() => {
            stopSound('win');
            winScreen.style.display = 'none';
            if (typeof callback === 'function') callback();
        }, 7000);
    }, 1500);
}

const foxyRunFrames = [
    'textures/camera/foxy run/240.png',
    'textures/camera/foxy run/241.png',
    'textures/camera/foxy run/244.png',
    'textures/camera/foxy run/245.png',
    'textures/camera/foxy run/246.png',
    'textures/camera/foxy run/247.png',
    'textures/camera/foxy run/248.png',
    'textures/camera/foxy run/250.png',
    'textures/camera/foxy run/280.png',
    'textures/camera/foxy run/282.png',
    'textures/camera/foxy run/283.png',
    'textures/camera/foxy run/284.png',
    'textures/camera/foxy run/285.png',
    'textures/camera/foxy run/286.png',
    'textures/camera/foxy run/287.png',
    'textures/camera/foxy run/288.png',
    'textures/camera/foxy run/289.png',
    'textures/camera/foxy run/290.png',
    'textures/camera/foxy run/292.png',
    'textures/camera/foxy run/302.png',
    'textures/camera/foxy run/306.png',
    'textures/camera/foxy run/327.png',
    'textures/camera/foxy run/329.png',
    'textures/camera/foxy run/330.png',
    'textures/camera/foxy run/331.png',
    'textures/camera/foxy run/332.png',
    'textures/camera/foxy run/333.png',
    'textures/camera/foxy run/334.png',
    'textures/camera/foxy run/335.png',
    'textures/camera/foxy run/336.png',
    'textures/camera/foxy run/337.png'
];

let foxyRunInterval = null;

function triggerFoxyRun() {
    isFoxySprinting = true;
    playSound('run');
    setKitchenTextVisible(false);

    const cameraFeed = document.getElementById('cameraFeed');
    const cameraOverlay = document.getElementById('cameraOverlay');

    if (cameraFeed) cameraFeed.style.display = 'block';
    if (cameraOverlay) cameraOverlay.style.display = 'block';

    let frameIdx = 0;
    if (foxyRunInterval) clearInterval(foxyRunInterval);

    foxyRunInterval = setInterval(() => {
        if (frameIdx < foxyRunFrames.length) {
            if (cameraFeed) {
                cameraFeed.style.display = 'block';
                cameraFeed.src = foxyRunFrames[frameIdx];
            }
            frameIdx++;
        } else {
            clearInterval(foxyRunInterval);
            foxyRunInterval = null;
            isFoxySprinting = false;

            if (typeof forceCloseCamera === 'function') {
                forceCloseCamera();
            } else if (typeof closeCamera === 'function') {
                closeCamera();
            }
        }
    }, 28);
}

function updateButtonState(side, door, light) {
    const btn = document.getElementById(side === 'left' ? 'toggleLeft' : 'toggleRight');
    btn.classList.remove('door-only', 'light-only', 'both-on');

    if (door && light) {
        btn.classList.add('both-on');
    } else if (door) {
        btn.classList.add('door-only');
    } else if (light) {
        btn.classList.add('light-only');
    }
}

function updatePowerUsage(usage) {
    const usageNum = Math.min(5, Math.max(1, usage));
    powerUsageImg.src = `textures/power/${usageNum} usage.png`;
}

const cameraAnimFrames = [
    'textures/camera/office cam/1.png',
    'textures/camera/office cam/2.png',
    'textures/camera/office cam/3.png',
    'textures/camera/office cam/4.png',
    'textures/camera/office cam/5.png',
    'textures/camera/office cam/6.png',
    'textures/camera/office cam/7.png',
    'textures/camera/office cam/8.png',
    'textures/camera/office cam/9.png',
    'textures/camera/office cam/10.png',
    'textures/camera/office cam/11.png'
];

// The backdrop behind the feed is just black. (It used to be stretched from
// `cam assets/<cam>.png`, which are the 31x25 map labels — blown up to 1280x720
// they flashed as a blurry smear during the flip-up before the plate decoded.)
function applyCameraBackground() {
    cameraOverlay.style.backgroundImage = 'none';
    cameraOverlay.style.backgroundColor = '#000';
}

const camGlitch = document.getElementById('camGlitch');
const glitchFrames = [
    'textures/camera/glitch/6.png',
    'textures/camera/glitch/8.png',
    'textures/camera/glitch/9.png'
];
let glitchAnimInterval = null;

function playCamGlitch() {
    if (glitchAnimInterval) {
        clearInterval(glitchAnimInterval);
        glitchAnimInterval = null;
    }

    if (!camGlitch) return;

    camGlitch.style.display = 'block';
    let idx = 0;

    glitchAnimInterval = setInterval(() => {
        if (idx < glitchFrames.length) {
            camGlitch.src = glitchFrames[idx];
            idx++;
        } else {
            clearInterval(glitchAnimInterval);
            glitchAnimInterval = null;
            camGlitch.style.display = 'none';
        }
    }, 50);
}

const ovenSounds = ['oven1', 'oven2', 'oven3', 'oven4'];
let currentOvenSound = null;

function updateKitchenOvenSound(cam) {
    if (cam === '6' && currentState && currentState.animatronics.chica.location === '6') {
        // Pick a random oven sound and play it
        stopKitchenOvenSound();
        const rand = ovenSounds[Math.floor(Math.random() * ovenSounds.length)];
        currentOvenSound = rand;
        playSound(rand);
    } else {
        stopKitchenOvenSound();
    }
}

function stopKitchenOvenSound() {
    if (currentOvenSound) {
        stopSound(currentOvenSound);
        currentOvenSound = null;
    }
}

function selectCamera(cam) {
    selectedCamera = cam;

    if (typeof sendAction === 'function') {
        sendAction('selectCamera', null, cam);
    }

    // Toggle active class on map buttons
    document.querySelectorAll('.camera-position').forEach(btn => {
        btn.classList.remove('active');
    });
    const camEl = document.querySelector(`.camera-position[data-cam="${cam}"]`);
    if (camEl) {
        camEl.classList.add('active');
    }

    // Update camera name image on top of map
    setPlateSrc(document.getElementById('camNameImg'), `textures/camera/camera names/${cam}.png`);

    // Play glitch animation on camera switch
    playCamGlitch();

    applyCameraBackground();

    if (isCameraUp && currentState) {
        updateCameraTexture(currentState);
    }

    // Kitchen oven sounds: play random oven sound when switching to cam 6 while Chica is in kitchen
    updateKitchenOvenSound(cam);
}

let cameraAnimating = false;
let cameraAnimFrame = 0;
let cameraAnimInterval = null;
let cameraHovered = false;
let cameraCloseTimeout = null;
let mouseInOverlay = false;

function openCamera() {
    if (cameraAnimating || isCameraUp) return;
    isFoxySprinting = false;
    isCameraUp = true;
    cameraHovered = true;

    if (cameraCloseTimeout) {
        clearTimeout(cameraCloseTimeout);
        cameraCloseTimeout = null;
    }

    if (cameraAnimInterval) {
        clearInterval(cameraAnimInterval);
        cameraAnimInterval = null;
    }

    cameraAnimating = true;
    cameraAnimFrame = 0;

    cameraAnimation.style.display = 'block';
    cameraOverlay.style.display = 'none';
    applyCameraBackground();
    playSound('cam_open');
    playSound('on_cam');

    cameraAnimInterval = setInterval(() => {
        if (cameraAnimFrame < cameraAnimFrames.length) {
            cameraAnimation.src = cameraAnimFrames[cameraAnimFrame];
            cameraAnimFrame++;
        } else {
            clearInterval(cameraAnimInterval);
            cameraAnimInterval = null;
            cameraAnimation.style.display = 'none';
            cameraOverlay.style.display = 'block';
            cameraAnimating = false;
            if (currentState) {
                updateCameraTexture(currentState);
            }
        }
    }, 20);
}

function closeCamera() {
    if (cameraAnimating || !isCameraUp) return;
    isCameraUp = false;
    cameraHovered = false;

    if (cameraCloseTimeout) {
        clearTimeout(cameraCloseTimeout);
        cameraCloseTimeout = null;
    }

    if (cameraAnimInterval) {
        clearInterval(cameraAnimInterval);
        cameraAnimInterval = null;
    }

    mouseInOverlay = false;
    stopSound('on_cam');
    playSound('put_down');

    cameraAnimating = true;
    cameraOverlay.style.display = 'none';
    cameraAnimation.style.display = 'block';

    // Play flip-down animation in REVERSE (from 11.png down to 1.png)
    cameraAnimFrame = cameraAnimFrames.length - 1;

    cameraAnimInterval = setInterval(() => {
        if (cameraAnimFrame >= 0) {
            cameraAnimation.src = cameraAnimFrames[cameraAnimFrame];
            cameraAnimFrame--;
        } else {
            clearInterval(cameraAnimInterval);
            cameraAnimInterval = null;
            cameraAnimation.style.display = 'none';
            cameraAnimating = false;
            sendAction('setCamera', null, false);
        }
    }, 20);
}

function forceCloseCamera() {
    isCameraUp = false;
    cameraHovered = false;
    canToggleCamera = false;

    if (foxyRunInterval) {
        clearInterval(foxyRunInterval);
        foxyRunInterval = null;
    }
    isFoxySprinting = false;

    if (cameraCloseTimeout) {
        clearTimeout(cameraCloseTimeout);
        cameraCloseTimeout = null;
    }

    if (cameraAnimInterval) {
        clearInterval(cameraAnimInterval);
        cameraAnimInterval = null;
    }

    mouseInOverlay = false;
    stopSound('on_cam');
    playSound('put_down');

    cameraAnimating = true;
    if (cameraFeed) cameraFeed.style.display = 'none';
    if (cameraOverlay) cameraOverlay.style.display = 'none';

    if (cameraAnimation) {
        cameraAnimation.style.display = 'block';
        cameraAnimFrame = cameraAnimFrames.length - 1;

        cameraAnimInterval = setInterval(() => {
            if (cameraAnimFrame >= 0) {
                cameraAnimation.src = cameraAnimFrames[cameraAnimFrame];
                cameraAnimFrame--;
            } else {
                clearInterval(cameraAnimInterval);
                cameraAnimInterval = null;
                cameraAnimation.style.display = 'none';
                cameraAnimating = false;
                if (currentState) {
                    applyCameraBackground();
                    updateCameraTexture(currentState);
                }
                setTimeout(() => {
                    canToggleCamera = true;
                }, 300);
            }
        }, 18);
    } else {
        cameraAnimating = false;
        canToggleCamera = true;
        if (currentState) {
            applyCameraBackground();
            updateCameraTexture(currentState);
        }
    }

    if (typeof sendAction === 'function') {
        sendAction('setCamera', null, false);
    }
}

let canToggleCamera = true;

cameraContainer.addEventListener('mouseenter', () => {
    if (!canToggleCamera || cameraAnimating) return;
    canToggleCamera = false;

    if (isCameraUp) {
        closeCamera();
    } else {
        openCamera();
        sendAction('setCamera', null, true);
    }
});

cameraContainer.addEventListener('mouseleave', () => {
    canToggleCamera = true;
});

cameraOverlay.addEventListener('mouseenter', () => {
    mouseInOverlay = true;
});

cameraOverlay.addEventListener('mouseleave', () => {
    mouseInOverlay = false;
});

document.querySelectorAll('.camera-position').forEach(pos => {
    pos.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cam = pos.dataset.cam;
        if (selectedCamera !== cam) {
            selectCamera(cam);
            playSound('Blip3');
        }
    });
});

let prevDoorState = { left: null, right: null };
let prevLightState = { left: false, right: false };
let prevAnimLocations = { freddy: null, bonnie: null, chica: null, foxy: null, foxyStage: null };

function onServerState(state) {
    if (!state) return;
    currentState = state;

    if (state.cameraUp === false && isCameraUp && !cameraAnimating && !isFoxySprinting) {
        forceCloseCamera();
    }

    checkVariants(state);

    const a = state.animatronics;

    if (a.bonnie.location !== 'office_door_left') {
        scaredAtDoor.left = false;
    }
    if (a.chica.location !== 'office_door_right') {
        scaredAtDoor.right = false;
    }

    // Check windowscare sound when turning light on with animatronic at door (only once per visit)
    if (!prevLightState.left && state.lights.left && a.bonnie.location === 'office_door_left') {
        if (!scaredAtDoor.left) {
            playSound('windowscare');
            scaredAtDoor.left = true;
        }
    }
    if (!prevLightState.right && state.lights.right && a.chica.location === 'office_door_right') {
        if (!scaredAtDoor.right) {
            playSound('windowscare');
            scaredAtDoor.right = true;
        }
    }
    prevLightState.left = state.lights.left;
    prevLightState.right = state.lights.right;

    // Check random garble audio and trigger 5-second camera blackout when an animatronic moves
    if (prevAnimLocations.freddy !== null) {
        if (prevAnimLocations.freddy !== a.freddy.location) {
            const laughs = ['freddyLaugh1', 'freddyLaugh2', 'freddyLaugh3'];
            const randLaugh = laughs[Math.floor(Math.random() * laughs.length)];
            playSound(randLaugh);
        }

        if (prevAnimLocations.freddy !== a.freddy.location ||
            prevAnimLocations.bonnie !== a.bonnie.location ||
            prevAnimLocations.chica !== a.chica.location ||
            prevAnimLocations.foxy !== a.foxy.location ||
            prevAnimLocations.foxyStage !== a.foxy.foxyStage) {

            triggerCameraBlackout();

            if (state.cameraUp) {
                const garbles = ['garble1', 'garble2', 'garble3'];
                const randG = garbles[Math.floor(Math.random() * garbles.length)];
                playSound(randG);
            }
        }
    }

    // Eerie random sound trigger on night progression (hour change) - disabled in power outage
    if (prevHour !== null && prevHour !== state.hour && state.hour > 0) {
        if (state.power > 0 && !isPowerOutage && Math.random() < 0.2) {
            const randS = Math.random() < 0.5 ? 'randomsound1' : 'randomsound2';
            playSound(randS);
        }
    }
    prevHour = state.hour;

    prevAnimLocations = {
        freddy: a.freddy.location,
        bonnie: a.bonnie.location,
        chica: a.chica.location,
        foxy: a.foxy.location,
        foxyStage: a.foxy.foxyStage
    };

    // Stop kitchen oven sounds when Chica leaves the kitchen
    if (a.chica.location !== '6') {
        stopKitchenOvenSound();
    }

    const aiDisplay = document.getElementById('aiDisplay');
    if (aiDisplay) {
        document.getElementById('aiF').textContent = state.animatronics.freddy.ai;
        document.getElementById('aiB').textContent = state.animatronics.bonnie.ai;
        document.getElementById('aiC').textContent = state.animatronics.chica.ai;
        document.getElementById('aiFx').textContent = state.animatronics.foxy.ai;
    }

    if (timeDisplay) timeDisplay.textContent = (state.hour === 0 ? 12 : state.hour) + ' AM';
    if (powerDisplay) powerDisplay.textContent = state.power + '%';
    if (usageDisplay) usageDisplay.textContent = state.usage;

    const leftDoor = document.getElementById('leftDoor');
    const rightDoor = document.getElementById('rightDoor');

    if (isPowerOutage || state.power <= 0) {
        if (leftDoor) leftDoor.style.display = 'none';
        if (rightDoor) rightDoor.style.display = 'none';
        prevDoorState = { left: false, right: false };

        const leftButtons = document.getElementById('leftButtons');
        const rightButtons = document.getElementById('rightButtons');
        if (leftButtons) leftButtons.style.display = 'none';
        if (rightButtons) rightButtons.style.display = 'none';

        const powerUsage = document.getElementById('powerUsage');
        if (powerUsage) powerUsage.style.display = 'none';

        isCameraUp = false;
        if (cameraOverlay) cameraOverlay.style.display = 'none';
        if (cameraAnimation) cameraAnimation.style.display = 'none';
        const cameraContainer = document.getElementById('cameraContainer');
        if (cameraContainer) cameraContainer.style.display = 'none';
        canToggleCamera = false;

        const timeDisplayContainer = document.getElementById('timeDisplayContainer');
        const aiDisplay = document.getElementById('aiDisplay');

        if (powerOutagePhase === 3) {
            if (timeDisplayContainer) timeDisplayContainer.style.display = 'none';
            if (aiDisplay) aiDisplay.style.display = 'none';
            office.style.backgroundImage = 'none';
            office.style.backgroundColor = '#000';
        } else {
            if (timeDisplayContainer) timeDisplayContainer.style.display = 'flex';
        }
        return;
    }

    if (prevDoorState.left !== null && prevDoorState.left !== state.doors.left) {
        updateDoorTextureAnimated(leftDoor, 'left', state.doors.left);
        prevDoorState.left = state.doors.left;
    } else if (prevDoorState.left === null) {
        leftDoor.style.display = state.doors.left ? 'block' : 'none';
        leftDoor.style.backgroundImage = state.doors.left ? "url('textures/doors/left/100.png')" : 'none';
        prevDoorState.left = state.doors.left;
    }

    if (prevDoorState.right !== null && prevDoorState.right !== state.doors.right) {
        updateDoorTextureAnimated(rightDoor, 'right', state.doors.right);
        prevDoorState.right = state.doors.right;
    } else if (prevDoorState.right === null) {
        rightDoor.style.display = state.doors.right ? 'block' : 'none';
        rightDoor.style.backgroundImage = state.doors.right ? "url('textures/doors/right/118.png')" : 'none';
        prevDoorState.right = state.doors.right;
    }

    updateButtonState('left', state.doors.left, state.lights.left);
    updateButtonState('right', state.doors.right, state.lights.right);

    const leftButtons = document.getElementById('leftButtons');
    const rightButtons = document.getElementById('rightButtons');
    if (leftButtons) leftButtons.style.display = state.cameraUp ? 'none' : 'block';
    if (rightButtons) rightButtons.style.display = state.cameraUp ? 'none' : 'block';

    isCameraUp = state.cameraUp;

    updateCameraTexture(state);
    updateOfficeTexture(state);
    updatePowerUsage(state.usage);

    const nightDisplay = document.getElementById('nightDisplay');
    if (nightDisplay) nightDisplay.textContent = 'Night ' + currentNight;
}

let lastFrameTime = 0;

function frame(now) {
    const deltaSec = lastFrameTime ? Math.min(0.1, (now - lastFrameTime) / 1000) : 0;
    lastFrameTime = now;

    if (mainMenu.style.display === 'none' && document.getElementById('customNightScreen').style.display === 'none' && document.getElementById('newStartScreen').style.display === 'none') {
        if (isCameraUp) {
            updateCctvPan();
        } else {
            const step = OFFICE_PAN_SPEED * deltaSec;
            if (mouseX < 0.25) {
                cameraPan += step;
            } else if (mouseX > 0.75) {
                cameraPan -= step;
            }
            cameraPan = Math.max(OFFICE_PAN_MIN, Math.min(cameraPan, OFFICE_PAN_MAX));
            office.style.left = cameraPan + "%";
        }
    }
    requestAnimationFrame(frame);
}

let isPowerOutage = false;
let powerOutagePhase = 0;
let powerOutageTimeouts = [];
let powerOutageIntervals = [];
let scaredAtDoor = { left: false, right: false };
let cameraBlackoutActive = false;
let cameraBlackoutTimeout = null;
let prevHour = null;

function triggerCameraBlackout() {
    cameraBlackoutActive = true;
    if (cameraBlackoutTimeout) {
        clearTimeout(cameraBlackoutTimeout);
    }
    if (isCameraUp && currentState) {
        updateCameraTexture(currentState);
    }
    cameraBlackoutTimeout = setTimeout(() => {
        cameraBlackoutActive = false;
        cameraBlackoutTimeout = null;
        if (isCameraUp && currentState) {
            updateCameraTexture(currentState);
        }
    }, 5000);
}

function clearPowerOutageTimers() {
    powerOutageTimeouts.forEach(t => clearTimeout(t));
    powerOutageIntervals.forEach(i => clearInterval(i));
    powerOutageTimeouts = [];
    powerOutageIntervals = [];
}

function stopPowerOutageSequence() {
    isPowerOutage = false;
    powerOutagePhase = 0;
    clearPowerOutageTimers();
    stopSound('musicBox');
    stopSound('powerdown');
    if (office) {
        office.style.backgroundColor = '';
        office.style.backgroundImage = '';
    }
    const powerUsage = document.getElementById('powerUsage');
    const timeDisplayContainer = document.getElementById('timeDisplayContainer');
    const aiDisplay = document.getElementById('aiDisplay');
    if (powerUsage) powerUsage.style.display = 'flex';
    if (timeDisplayContainer) timeDisplayContainer.style.display = 'flex';
    if (aiDisplay) aiDisplay.style.display = 'none';
}

function triggerPowerOutage() {
    if (isPowerOutage) return;
    isPowerOutage = true;
    powerOutagePhase = 1;
    clearPowerOutageTimers();

    stopSound('ambience');
    stopSound('on_cam');
    playSound('powerdown');

    // Play door sound if any door was closed when power out hits
    if (prevDoorState.left || prevDoorState.right) {
        playSound('doorClick');
    }

    // Hide usage bar
    const powerUsage = document.getElementById('powerUsage');
    if (powerUsage) powerUsage.style.display = 'none';

    // Open doors visually
    const leftDoor = document.getElementById('leftDoor');
    const rightDoor = document.getElementById('rightDoor');
    if (leftDoor) leftDoor.style.display = 'none';
    if (rightDoor) rightDoor.style.display = 'none';
    prevDoorState = { left: false, right: false };

    // Force camera down & hide hover bar + disable flipping open
    isCameraUp = false;
    if (cameraOverlay) cameraOverlay.style.display = 'none';
    if (cameraAnimation) cameraAnimation.style.display = 'none';
    const cameraContainer = document.getElementById('cameraContainer');
    if (cameraContainer) cameraContainer.style.display = 'none';
    canToggleCamera = false;

    // Hide door & light button panels
    const leftButtons = document.getElementById('leftButtons');
    const rightButtons = document.getElementById('rightButtons');
    if (leftButtons) leftButtons.style.display = 'none';
    if (rightButtons) rightButtons.style.display = 'none';

    // Show power out texture in office
    office.style.display = 'block';
    office.style.backgroundImage = "url('textures/office/power out.png')";

    // Phase 1: Wait up to 20 seconds before Freddy appears. Every 5s: 20% chance to move to Phase 2 earlier.
    let phase1Elapsed = 0;
    const phase1Interval = setInterval(() => {
        if (!isPowerOutage) return;
        phase1Elapsed += 5;
        if (Math.random() < 0.2 || phase1Elapsed >= 20) {
            clearInterval(phase1Interval);
            startPhase2();
        }
    }, 5000);
    powerOutageIntervals.push(phase1Interval);

    function startPhase2() {
        if (!isPowerOutage || powerOutagePhase >= 2) return;
        powerOutagePhase = 2;

        // Play music box audio
        playSound('musicBox');

        // Randomly flicker office between 'power out' and 'freddy music box'
        const flickerInterval = setInterval(() => {
            if (!isPowerOutage) return;
            const showFreddy = Math.random() < 0.5;
            office.style.backgroundImage = showFreddy
                ? "url('textures/office/freddy music box.png')"
                : "url('textures/office/power out.png')";
        }, 120);
        powerOutageIntervals.push(flickerInterval);

        let phase2Elapsed = 0;
        const phase2Interval = setInterval(() => {
            if (!isPowerOutage) return;
            phase2Elapsed += 5;
            if (Math.random() < 0.2 || phase2Elapsed >= 20) {
                clearInterval(phase2Interval);
                clearInterval(flickerInterval);
                startPhase3();
            }
        }, 5000);
        powerOutageIntervals.push(phase2Interval);
    }

    function startPhase3() {
        if (!isPowerOutage || powerOutagePhase >= 3) return;
        powerOutagePhase = 3;

        stopSound('musicBox');

        // Hide all text overlays for pure black screen in Phase 3
        const timeDisplayContainer = document.getElementById('timeDisplayContainer');
        if (timeDisplayContainer) timeDisplayContainer.style.display = 'none';
        const aiDisplay = document.getElementById('aiDisplay');
        if (aiDisplay) aiDisplay.style.display = 'none';
        if (powerUsage) powerUsage.style.display = 'none';

        // Actual black screen background (complete darkness)
        office.style.backgroundImage = 'none';
        office.style.backgroundColor = '#000';

        let phase3Elapsed = 0;
        // Every 2s: 20% chance to jumpscare (or max 20 seconds)
        const phase3Interval = setInterval(() => {
            if (!isPowerOutage) return;
            phase3Elapsed += 2;
            if (Math.random() < 0.2 || phase3Elapsed >= 20) {
                clearInterval(phase3Interval);
                stopPowerOutageSequence();
                triggerJumpscare('freddy2');
            }
        }, 2000);
        powerOutageIntervals.push(phase3Interval);
    }
}

// Progression Save System
function getSavedNight() {
    return parseInt(localStorage.getItem('fnaf_saved_night') || '1', 10);
}

function setSavedNight(night) {
    localStorage.setItem('fnaf_saved_night', night.toString());
}

function getSavedStars() {
    return parseInt(localStorage.getItem('fnaf_saved_stars') || '0', 10);
}

function setSavedStars(stars) {
    const current = getSavedStars();
    if (stars > current) {
        localStorage.setItem('fnaf_saved_stars', stars.toString());
    }
}

let customAiLevels = {
    freddy: 20,
    bonnie: 20,
    chica: 20,
    foxy: 20
};

let menuTwitchTimeout = null;
let menuFlickerTimeout = null;

function stopMenuEffects() {
    if (menuTwitchTimeout) clearTimeout(menuTwitchTimeout);
    if (menuFlickerTimeout) clearTimeout(menuFlickerTimeout);
    menuTwitchTimeout = null;
    menuFlickerTimeout = null;
}

function startMenuEffects() {
    stopMenuEffects();

    function scheduleNextTwitch() {
        if (mainMenu.style.display === 'none') return;
        const delay = Math.floor(Math.random() * 700) + 300;
        menuTwitchTimeout = setTimeout(() => {
            if (mainMenu.style.display !== 'none') {
                const twitchVariants = ['440.png', '441.png', '442.png'];
                const randFrame = twitchVariants[Math.floor(Math.random() * twitchVariants.length)];
                menuBg.src = 'textures/main menu/' + randFrame;
                menuBg.style.opacity = '1.0';

                const duration = Math.floor(Math.random() * 100) + 60;
                setTimeout(() => {
                    if (mainMenu.style.display !== 'none') {
                        menuBg.src = 'textures/main menu/431.png';
                    }
                    scheduleNextTwitch();
                }, duration);
            }
        }, delay);
    }

    // The menu portrait sits lit most of the time and drops out for a frame or
    // two now and then. A constant strobe reads as a broken page, not as FNAF.
    function scheduleNextFlicker() {
        if (mainMenu.style.display === 'none') return;
        const delay = Math.floor(Math.random() * 900) + 250;
        menuFlickerTimeout = setTimeout(() => {
            if (mainMenu.style.display === 'none') return;

            const dip = Math.random() < 0.55 ? '0' : '0.35';
            menuBg.style.opacity = dip;

            setTimeout(() => {
                if (mainMenu.style.display !== 'none') {
                    menuBg.style.opacity = '1';
                }
                scheduleNextFlicker();
            }, Math.floor(Math.random() * 60) + 40);
        }, delay);
    }

    scheduleNextTwitch();
    scheduleNextFlicker();
}

function startMenuTwitch() {
    startMenuEffects();
}

function renderMainMenu() {
    const savedNight = Math.min(5, Math.max(1, getSavedNight()));
    const continueNight = document.getElementById('continueNight');
    if (continueNight) {
        continueNight.textContent = savedNight;
    }

    const btnNight6 = document.getElementById('btnNight6');
    const btnCustomNight = document.getElementById('btnCustomNight');

    const unlockedNight = parseInt(localStorage.getItem('fnaf_saved_night') || '1', 10);

    if (btnNight6) btnNight6.style.display = unlockedNight >= 6 ? 'flex' : 'none';
    if (btnCustomNight) btnCustomNight.style.display = 'flex'; // Available by default

    // Render stars
    const starsContainer = document.getElementById('starsContainer');
    if (starsContainer) {
        starsContainer.innerHTML = '';
        let starCount = 0;
        if (unlockedNight >= 6) starCount = 1;
        if (unlockedNight >= 7) starCount = 2;
        if (getSavedStars() >= 3) starCount = 3;

        for (let i = 0; i < starCount; i++) {
            const img = document.createElement('img');
            img.src = 'textures/main menu/star.png';
            img.alt = 'Star';
            starsContainer.appendChild(img);
        }
    }
}

function updateCustomAiDisplay() {
    const f = document.getElementById('customAiFreddy');
    const b = document.getElementById('customAiBonnie');
    const c = document.getElementById('customAiChica');
    const fx = document.getElementById('customAiFoxy');
    if (f) f.textContent = customAiLevels.freddy;
    if (b) b.textContent = customAiLevels.bonnie;
    if (c) c.textContent = customAiLevels.chica;
    if (fx) fx.textContent = customAiLevels.foxy;
}

function adjustCustomAI(anim, delta) {
    if (customAiLevels[anim] !== undefined) {
        customAiLevels[anim] = Math.max(0, Math.min(20, customAiLevels[anim] + delta));
        updateCustomAiDisplay();
    }
}

document.getElementById('freddyMinus')?.addEventListener('click', () => adjustCustomAI('freddy', -1));
document.getElementById('freddyPlus')?.addEventListener('click', () => adjustCustomAI('freddy', 1));
document.getElementById('bonnieMinus')?.addEventListener('click', () => adjustCustomAI('bonnie', -1));
document.getElementById('bonniePlus')?.addEventListener('click', () => adjustCustomAI('bonnie', 1));
document.getElementById('chicaMinus')?.addEventListener('click', () => adjustCustomAI('chica', -1));
document.getElementById('chicaPlus')?.addEventListener('click', () => adjustCustomAI('chica', 1));
document.getElementById('foxyMinus')?.addEventListener('click', () => adjustCustomAI('foxy', -1));
document.getElementById('foxyPlus')?.addEventListener('click', () => adjustCustomAI('foxy', 1));

// READY gets the menu blip; BACK and the A.I. arrows deliberately stay silent.
document.getElementById('btnStartCustom')?.addEventListener('click', () => {
    playSound('Blip3');
    document.getElementById('customNightScreen').style.display = 'none';
    const is20202020 = customAiLevels.freddy === 20 && customAiLevels.bonnie === 20 && customAiLevels.chica === 20 && customAiLevels.foxy === 20;
    if (is20202020) setSavedStars(3);
    startGame(7, customAiLevels);
});

document.getElementById('btnBackCustom')?.addEventListener('click', () => {
    document.getElementById('customNightScreen').style.display = 'none';
    showMainMenu();
});

// Setup hover selector arrow positioning
const selectorArrow = document.getElementById('selectorArrow');
document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('mouseenter', () => {
        if (item.style.display === 'none') return;
        // Reveal the "Night n" subhead from the same event that drives the
        // arrow, so the two can never disagree.
        item.classList.add('is-hovered');
        if (!selectorArrow) return;

        // Align the ">>" with the label plate, not the whole item — the
        // Continue item is taller because of its "Night n" subhead.
        const label = item.querySelector('img') || item;
        const rect = label.getBoundingClientRect();
        const parentRect = mainMenu.getBoundingClientRect();

        // Make it visible before measuring: a display:none element has no box.
        selectorArrow.style.display = 'block';
        const arrow = selectorArrow.getBoundingClientRect();
        const gap = arrow.height * 0.9;

        selectorArrow.style.top = (rect.top - parentRect.top + (rect.height - arrow.height) / 2) + 'px';
        selectorArrow.style.left = (rect.left - parentRect.left - arrow.width - gap) + 'px';
    });
    item.addEventListener('mouseleave', () => {
        item.classList.remove('is-hovered');
        if (selectorArrow) selectorArrow.style.display = 'none';
    });
});

// Coming back from the Custom Night screen must not restart the menu music —
// that screen never stopped it, so only start it when it isn't already running.
function startMenuMusic() {
    const ambience = ensureAudio('menuAmbience');
    if (ambience && !ambience.paused && !ambience.ended) return;
    playSound('menuAmbience');
    playSound('mainMenu2');
}

function showMainMenu() {
    stopPowerOutageSequence();
    renderMainMenu();
    mainMenu.style.display = 'flex';
    document.getElementById('customNightScreen').style.display = 'none';
    office.style.display = 'none';
    document.getElementById('cameraContainer').style.display = 'none';
    document.getElementById('powerUsage').style.display = 'none';
    document.getElementById('timeDisplayContainer').style.display = 'none';
    document.getElementById('jumpscare').style.display = 'none';
    document.getElementById('aiDisplay').style.display = 'none';
    cameraOverlay.style.display = 'none';
    cameraAnimation.style.display = 'none';
    stopSound('ambience');
    startMenuMusic();
    startMenuTwitch();
}

function hideMainMenu() {
    mainMenu.style.display = 'none';
    document.getElementById('customNightScreen').style.display = 'none';
    office.style.display = 'block';
    document.getElementById('cameraContainer').style.display = 'block';
    document.getElementById('powerUsage').style.display = 'flex';
    document.getElementById('timeDisplayContainer').style.display = 'flex';
    // #aiDisplay is a debug readout — it is never visible in the shipped game.
    document.getElementById('aiDisplay').style.display = 'none';
    stopSound('menuAmbience');
    stopSound('mainMenu2');
}

function getNightIntroFilename(night) {
    switch (night) {
        case 2: return '12 am 2 night.png';
        case 5: return '12 am 5 night.png';
        case 1: return '12am 1 night.png';
        case 3: return '12am 3 night.png';
        case 4: return '12am 4 night.png';
        case 6: return '12am 6 night.png';
        case 7:
        default: return '12am 7 night.png';
    }
}

function showNightIntro(night, callback) {
    const nightIntroScreen = document.getElementById('nightIntroScreen');
    const nightIntroImg = document.getElementById('nightIntroImg');

    if (nightIntroScreen && nightIntroImg) {
        setPlateSrc(nightIntroImg, 'textures/main menu/' + getNightIntroFilename(night));
        nightIntroScreen.style.display = 'flex';

        setTimeout(() => {
            nightIntroScreen.style.display = 'none';
            playSound('ambience');
            if (typeof callback === 'function') callback();
        }, 3000);
    } else {
        playSound('ambience');
        if (typeof callback === 'function') callback();
    }
}

function startGame(night, customAI = null) {
    stopPowerOutageSequence();
    canToggleCamera = true;
    currentNight = night;
    currentRoomId = 'room_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

    prevDoorState = { left: null, right: null };

    cameraPan = DEFAULT_CAMERA_PAN;
    office.style.left = cameraPan + '%';
    isCameraUp = false;
    selectedCamera = '1A';
    cameraOverlay.style.display = 'none';
    cameraAnimation.style.display = 'none';
    cameraFeed.style.display = 'none';
    document.getElementById('jumpscare').style.display = 'none';
    cameraHovered = false;
    mouseInOverlay = false;
    if (cameraCloseTimeout) {
        clearTimeout(cameraCloseTimeout);
        cameraCloseTimeout = null;
    }

    hideMainMenu();
    showNightIntro(night, () => {
        joinGame(currentRoomId, night, customAI);
    });
}

function returnToMainMenu(win = false) {
    if (win && currentNight <= 6) {
        const nextNight = currentNight + 1;
        const currentSaved = parseInt(localStorage.getItem('fnaf_saved_night') || '1', 10);
        if (nextNight > currentSaved) {
            setSavedNight(nextNight);
        }
    }
    showMainMenu();
}

const newStartScreen = document.getElementById('newStartScreen');

function triggerNewStart(callback) {
    stopMenuEffects();
    mainMenu.style.display = 'none';
    if (newStartScreen) {
        newStartScreen.style.display = 'flex';
        newStartScreen.classList.remove('fade-out');
        newStartScreen.classList.add('fade-in');

        let proceedCalled = false;
        function proceed() {
            if (proceedCalled) return;
            proceedCalled = true;
            newStartScreen.removeEventListener('click', proceed);

            newStartScreen.classList.remove('fade-in');
            newStartScreen.classList.add('fade-out');
            setTimeout(() => {
                newStartScreen.style.display = 'none';
                newStartScreen.classList.remove('fade-out');
                if (typeof callback === 'function') callback();
            }, 600);
        }

        newStartScreen.addEventListener('click', proceed);
        setTimeout(proceed, 5500);
    } else {
        if (typeof callback === 'function') callback();
    }
}

document.getElementById('btnNewGame')?.addEventListener('click', () => {
    playSound('Blip3');
    setSavedNight(1);
    triggerNewStart(() => {
        startGame(1);
    });
});

document.getElementById('btnContinue')?.addEventListener('click', () => {
    playSound('Blip3');
    const savedNight = getSavedNight();
    startGame(savedNight);
});

document.getElementById('btnNight6')?.addEventListener('click', () => {
    playSound('Blip3');
    startGame(6);
});

document.getElementById('btnCustomNight')?.addEventListener('click', () => {
    playSound('Blip3');
    updateCustomAiDisplay();
    mainMenu.style.display = 'none';
    document.getElementById('customNightScreen').style.display = 'flex';
});

initTextPlates();

window.addEventListener('load', () => {
    showMainMenu();
});

requestAnimationFrame(frame);