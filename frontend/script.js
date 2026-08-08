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
// The AI levels the current run actually started with — `customAiLevels` keeps
// being edited on the Custom Night screen, so it can't answer "was this 4/20?".
let currentCustomAI = null;

/* ---------------------------- Cheats in flight -----------------------------
   The menu can be edited at any time, but a run has to keep the cheats it
   started with. The authority is therefore the list the server froze onto the
   room and echoes back in every state payload; the menu's own list only seeds
   it until the first payload lands. Everything client-side reads runCheatOn(),
   never isCheatOn(), once a night is underway. */
let runCheats = new Set();

function setRunCheats(list) {
    runCheats = new Set(Array.isArray(list) ? list : []);
}

function runCheatOn(id) {
    return runCheats.has(id);
}

/* ---------------------------- Map Hacks (cheat 1) --------------------------
   Room coordinates are the very percentages the .camera-position markers
   already carry in index.html, so the dots line up with the map plate for free.
   The three office-side entries have no marker of their own and are placed by
   hand along the bottom of the plate. */
const MAP_DOT_POSITIONS = {
    '1A': [44.5, 15], '1B': [44.6, 36.5], '1C': [10.4, 46.3],
    '2A': [31.4, 66], '2B': [31.4, 84], '3': [18.5, 68.8],
    '4A': [57.5, 66], '4B': [57.5, 84], '5': [7.1, 27.9],
    '6': [77.2, 65.8], '7': [81, 39.3],
    'office_door_left': [37.5, 93.5],
    'office_door_right': [51.5, 93.5],
    'office': [44.5, 96]
};

const MAP_DOT_COLORS = {
    freddy: '#7a4a20',  // brown
    bonnie: '#6a4fd8',  // blue-ish violet
    chica: '#c8a800',   // slightly dark yellow
    foxy: '#c02020'     // red
};

// Fixed per animatronic rather than computed from who else is in the room, so a
// dot never jumps sideways just because someone walked in beside it.
const MAP_DOT_OFFSETS = {
    freddy: [-2.6, -2.6],
    bonnie: [2.6, -2.6],
    chica: [-2.6, 2.6],
    foxy: [2.6, 2.6]
};

function renderMapDots(layer, anims) {
    for (const name of ['freddy', 'bonnie', 'chica', 'foxy']) {
        let dot = layer.querySelector('.map-dot[data-anim="' + name + '"]');
        if (!dot) {
            dot = document.createElement('div');
            dot.className = 'map-dot';
            dot.dataset.anim = name;
            // `color` as well as the fill, so .is-hollow can border-colour off it.
            dot.style.color = MAP_DOT_COLORS[name];
            dot.style.backgroundColor = MAP_DOT_COLORS[name];
            layer.appendChild(dot);
        }

        const data = anims[name];
        // Foxy never walks the graph — his location stays 1C and the stage is
        // what actually advances, so he is pinned to the cove and goes hollow
        // once it's empty.
        const room = name === 'foxy' ? '1C' : (data && data.location);
        const pos = MAP_DOT_POSITIONS[room];
        if (!pos) {
            dot.style.display = 'none';
            continue;
        }

        const off = MAP_DOT_OFFSETS[name];
        dot.style.display = 'block';
        dot.style.left = (pos[0] + off[0]) + '%';
        dot.style.top = (pos[1] + off[1]) + '%';
        dot.classList.toggle('is-hollow', name === 'foxy' && !!data && data.foxyStage >= 3);
    }
}

function updateMapDots(state) {
    const on = runCheatOn('mapHacks') && !!state && !!state.animatronics;
    [document.getElementById('camMapDots'), document.getElementById('officeMapDots')]
        .forEach(layer => {
            if (!layer) return;
            if (!on) {
                if (layer.childElementCount) layer.innerHTML = '';
                return;
            }
            renderMapDots(layer, state.animatronics);
        });
}

function setOfficeMapVisible(visible) {
    const el = document.getElementById('officeMap');
    if (el) el.style.display = visible ? 'block' : 'none';
}

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

/* ------------------------------ Pixel text --------------------------------
   The HUD has to read as the same blocky bitmap face as "kitchen txt.png".
   Decoding that plate shows it is a 5x7 bitmap on a 6x8 cell, upscaled ~3.71x
   (371x54 for two lines; its row runs repeat in groups of 3-4 pixels).

   No such font ships with the browser, so the text is drawn tiny, thresholded
   to 1-bit — which is what kills the antialiasing and produces hard square
   pixels — and then upscaled with image-rendering: pixelated. Each glyph is
   centred in its own fixed cell so the result stays on an exact monospace grid.

   Blockiness is set by how small the source is drawn before it gets blown up:
   a bigger cell means finer steps for the same on-screen size. */
const PIXEL_FONT_PX = 12;
const PIXEL_CELL_W = 8;        // Volter's native 12px cell advance
const PIXEL_CELL_H = 14;
const PIXEL_BASELINE = 10;
const PIXEL_ALPHA_CUT = 40;    // Clean threshold for Volter pixel glyphs
// Keep the on-screen glyph pitch on the camera-name plates' 21.63px regardless
// of how the source cell is sized, so changing the two above only changes grain.
const PIXEL_TARGET_ADVANCE_PX = 21.63;
const PIXEL_UPSCALE_CQH = (PIXEL_TARGET_ADVANCE_PX / PIXEL_CELL_W) / 720 * 100;
// Spelled out rather than read from --fnaf-font: ctx.font silently ignores a
// value it cannot parse, which would leave the HUD in 10px sans-serif.
const PIXEL_FONT_STACK = 'Volter, Consolas, "Lucida Console", "DejaVu Sans Mono", monospace';

function drawPixelText(el, text) {
    if (!el) return;
    if (el.textContent !== text) {
        el.textContent = text;
    }
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
    jumpscare2: 'audio/XSCREAM2.wav', // Golden Freddy's scream, his alone
    goldenLaugh: 'audio/Laugh_Giggle_Girl_1.wav',
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
    kitchenMusicBox: 'audio/music box.wav', // separate element: the power-outage
                                            // cue uses musicBox at the same time
    pirateSong: 'audio/pirate song2.wav',
    win: 'audio/win.mp3',
    run: 'audio/run.wav',
    knock2: 'audio/knock2.wav',
    randomsound1: 'audio/randomsound1.mp3',
    randomsound2: 'audio/randomsound2.wav',
    freddyLaugh1: 'audio/Laugh_Giggle_Girl_1d.wav',
    freddyLaugh2: 'audio/Laugh_Giggle_Girl_2d.wav',
    freddyLaugh3: 'audio/Laugh_Giggle_Girl_8d.wav',
    mainMenu2: 'audio/main_menu1.wav',
    // The four oven clips are not listed here: they share one element so the
    // Web Audio routing survives swapping between them. See OVEN_CLIPS.
    voiceover1: 'audio/voiceover1c.wav',
    voiceover2: 'audio/voiceover2a.wav',
    voiceover3: 'audio/voiceover3.wav',
    voiceover4: 'audio/voiceover4.wav',
    voiceover5: 'audio/voiceover5.wav'
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

/* ------------------------------- Phone call ------------------------------- */
/* The night's message comes in a few seconds after the shift starts. A mute
   button sits beside the camera's red dot for the first stretch of the call;
   after that the message is committed and plays out in full. */

// Nights 6 and 7 have no recording, so they are absent from the map on purpose.
const NIGHT_VOICEOVERS = {
    1: 'voiceover1',
    2: 'voiceover2',
    3: 'voiceover3',
    4: 'voiceover4',
    5: 'voiceover5'
};

const CALL_START_DELAY_MS = 5000;
const CALL_MUTE_WINDOW_MS = 25000;

const muteCallButton = document.getElementById('muteCall');

let activeCallName = null;
let callStartTimeout = null;
let callMuteTimeout = null;
let callEndedHandler = null;

function setMuteCallVisible(visible) {
    if (muteCallButton) muteCallButton.style.display = visible ? 'block' : 'none';
}

function clearCallTimers() {
    if (callStartTimeout) {
        clearTimeout(callStartTimeout);
        callStartTimeout = null;
    }
    if (callMuteTimeout) {
        clearTimeout(callMuteTimeout);
        callMuteTimeout = null;
    }
}

function detachCallEndedHandler() {
    if (activeCallName && callEndedHandler) {
        const clip = audio[activeCallName];
        if (clip) clip.removeEventListener('ended', callEndedHandler);
    }
    callEndedHandler = null;
}

// Called on every night boundary as well as on death and on the win, so a call
// left running can never bleed into the next run.
function stopNightCall() {
    clearCallTimers();
    detachCallEndedHandler();
    if (activeCallName) {
        stopSound(activeCallName);
        activeCallName = null;
    }
    setMuteCallVisible(false);
}

function startNightCall(night) {
    stopNightCall();

    const name = NIGHT_VOICEOVERS[night];
    if (!name) return;

    callStartTimeout = setTimeout(() => {
        callStartTimeout = null;

        const clip = ensureAudio(name);
        if (!clip) return;

        activeCallName = name;
        playSound(name);
        setMuteCallVisible(true);

        // Also drop the button if the message runs shorter than the mute window.
        callEndedHandler = () => {
            setMuteCallVisible(false);
            detachCallEndedHandler();
            activeCallName = null;
        };
        clip.addEventListener('ended', callEndedHandler);

        callMuteTimeout = setTimeout(() => {
            callMuteTimeout = null;
            setMuteCallVisible(false);
        }, CALL_MUTE_WINDOW_MS);
    }, CALL_START_DELAY_MS);
}

if (muteCallButton) {
    muteCallButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        stopNightCall();
    });
}

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

/* Golden Freddy is the odd one out: a single held frame rather than a sheet, so
   he is kept out of jumpscareFrames and driven by his own path below. */
const GOLDEN_FREDDY_JUMPSCARE = 'textures/jumpscares/golden freddy/548.png';
const GOLDEN_FREDDY_SPRITE = 'textures/office/misc/golden freddy sprite.png';
const GOLDEN_FREDDY_JUMPSCARE_MS = 2000;

function preloadJumpscareImages() {
    for (const frames of Object.values(jumpscareFrames)) {
        frames.forEach(src => {
            const img = new Image();
            img.src = src;
        });
    }
    [GOLDEN_FREDDY_JUMPSCARE, GOLDEN_FREDDY_SPRITE].forEach(src => {
        const img = new Image();
        img.src = src;
    });
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
        returnToMainMenu();
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
        returnToMainMenu();
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
    clearWinTimers();

    if (deathStaticScreen) deathStaticScreen.style.display = 'none';
    if (gameOverScreen) gameOverScreen.style.display = 'none';

    // Close the run out on the server too. The power-outage scare is decided
    // entirely client-side, so without this the room keeps ticking to 6 AM.
    if (typeof endRun === 'function') endRun();
    if (typeof AIBot !== 'undefined') AIBot.stop();

    // Kill the room the moment the scare lands — the office ambience used to
    // keep humming underneath it all the way to the Game Over screen.
    stopSound('ambience');
    stopSound('on_cam');
    stopSound('musicBox');
    stopChicaKitchenSound();
    stopKitchenMusic();
    stopPirateSongRolls();
    stopNightCall();

    playSound('jumpscare');
    if (jumpscare) {
        jumpscare.style.display = 'block';
        jumpscare.style.zIndex = '1000';
    }

    // Play at a fixed fast rate rather than stretching the sheet over a fixed
    // duration: the sheets range from 11 to 28 frames, so a fixed duration made
    // the short ones crawl at 11fps. 20ms/frame is 50fps for all of them.
    const FRAME_MS = 20;
    const MIN_ONSCREEN_MS = 700;
    const animMs = anim.length * FRAME_MS;
    const totalDurationMs = Math.max(MIN_ONSCREEN_MS, animMs);

    // Step the index one frame per tick rather than deriving it from elapsed
    // time: a delayed tick would otherwise skip a frame outright, and every
    // frame in the sheet has to be shown.
    let frameIdx = 0;
    if (jumpscare) jumpscare.src = anim[0];

    jumpscareAnimInterval = setInterval(() => {
        frameIdx++;
        if (frameIdx < anim.length) {
            if (jumpscare) jumpscare.src = anim[frameIdx];
        } else {
            // Hold the final frame until the sequence timeout takes over.
            clearInterval(jumpscareAnimInterval);
            jumpscareAnimInterval = null;
        }
    }, FRAME_MS);

    // 1. Jumpscare plays for 1 second
    jumpscareSequenceTimeout = setTimeout(() => {
        if (jumpscareAnimInterval) {
            clearInterval(jumpscareAnimInterval);
            jumpscareAnimInterval = null;
        }
        if (jumpscare) jumpscare.style.display = 'none';
        stopSound('jumpscare');

        // 2. Full opacity death static screen plays for 3 seconds
        playSound('mainMenu2'); // main_menu1.wav, over the static
        if (deathStaticScreen) {
            deathStaticScreen.style.display = 'block';
        }

        deathStaticTimeout = setTimeout(() => {
            if (deathStaticScreen) {
                deathStaticScreen.style.display = 'none';
            }

            // 3. Move to Game Over screen
            showGameOverScreen();
        }, 3000);
    }, totalDurationMs);
}

/* ----------------------------- Golden Freddy ------------------------------ */
/* The server owns his timer; this side just shows the sprite, yanks the monitor
   down, and — if the 4 seconds run out — plays a scare that skips the whole
   static / Game Over tail every other animatronic gets. */

let goldenJumpscareTimeout = null;

function getGoldenFreddyEl() {
    return document.getElementById('goldenFreddy');
}

function showGoldenFreddy() {
    // The laugh goes first and lands on the same frame he does. It is warmed at
    // startup (see the ensureAudio list at the end of this file) — created cold
    // here, the element would spend its first play fetching and the giggle would
    // trail the sprite by a beat.
    playSound('goldenLaugh');

    const el = getGoldenFreddyEl();
    if (el) el.style.display = 'block';

    // He appears *because* the player was on the cameras, so the monitor has to
    // come down before he is visible at all.
    if (isCameraUp || cameraAnimating) {
        forceCloseCamera();
    }
}

function hideGoldenFreddy() {
    const el = getGoldenFreddyEl();
    if (el) el.style.display = 'none';
    stopSound('goldenLaugh');
}

function triggerGoldenFreddyJumpscare() {
    const jumpscare = document.getElementById('jumpscare');
    const deathStaticScreen = document.getElementById('deathStaticScreen');
    const gameOverScreen = document.getElementById('gameOverScreen');

    if (jumpscareAnimInterval) {
        clearInterval(jumpscareAnimInterval);
        jumpscareAnimInterval = null;
    }
    if (jumpscareSequenceTimeout) clearTimeout(jumpscareSequenceTimeout);
    if (deathStaticTimeout) clearTimeout(deathStaticTimeout);
    if (goldenJumpscareTimeout) clearTimeout(goldenJumpscareTimeout);
    clearWinTimers();

    if (deathStaticScreen) deathStaticScreen.style.display = 'none';
    if (gameOverScreen) gameOverScreen.style.display = 'none';

    if (typeof endRun === 'function') endRun();
    if (typeof AIBot !== 'undefined') AIBot.stop();

    hideGoldenFreddy();
    stopSound('ambience');
    stopSound('on_cam');
    stopSound('musicBox');
    stopChicaKitchenSound();
    stopKitchenMusic();
    stopPirateSongRolls();
    stopNightCall();
    stopPowerOutageSequence();

    playSound('jumpscare2');
    if (jumpscare) {
        jumpscare.src = GOLDEN_FREDDY_JUMPSCARE;
        jumpscare.style.display = 'block';
        jumpscare.style.zIndex = '1000';
    }

    // One frame held for two seconds, then straight back to the menu — no death
    // static, no Game Over screen.
    goldenJumpscareTimeout = setTimeout(() => {
        goldenJumpscareTimeout = null;
        if (jumpscare) jumpscare.style.display = 'none';
        stopSound('jumpscare2');
        returnToMainMenu();
    }, GOLDEN_FREDDY_JUMPSCARE_MS);
}

function resetGoldenFreddy() {
    if (goldenJumpscareTimeout) {
        clearTimeout(goldenJumpscareTimeout);
        goldenJumpscareTimeout = null;
    }
    hideGoldenFreddy();
}

let winSequenceTimeouts = [];

function clearWinTimers() {
    winSequenceTimeouts.forEach(t => clearTimeout(t));
    winSequenceTimeouts = [];
}

function afterWin(ms, fn) {
    winSequenceTimeouts.push(setTimeout(fn, ms));
}

/* Nights 5, 6 and 7 each finish on their own plate, held under the music box
   until it ends or the player clicks. Earlier nights roll straight on to the
   next night instead. */
const END_CARDS = {
    5: { img: 'textures/end game/5th.png', star: 0 },
    6: { img: 'textures/end game/6th.png', star: 1 },
    7: { img: 'textures/end game/7th.png', star: 2 }
};

function getEndCard(night) {
    return END_CARDS[Math.min(7, night)] || null;
}

const END_CARD_FADE_MS = 900;
const END_CARD_FALLBACK_MS = 30000; // only used if the music box duration is unknown

function showEndCard(night, callback) {
    const screen = document.getElementById('endCardScreen');
    const img = document.getElementById('endCardImg');
    const card = getEndCard(night);

    if (!screen || !img || !card) {
        if (typeof callback === 'function') callback();
        return;
    }

    awardStar(card.star);
    awardCheatStars(night);

    const music = ensureAudio('musicBox');
    let done = false;

    function finish() {
        if (done) return;
        done = true;
        screen.removeEventListener('click', finish);
        if (music) music.removeEventListener('ended', finish);
        stopSound('musicBox');
        screen.classList.remove('visible');
        afterWin(END_CARD_FADE_MS, () => {
            screen.style.display = 'none';
            if (typeof callback === 'function') callback();
        });
    }

    img.src = card.img;
    screen.style.display = 'flex';
    void screen.offsetHeight;
    screen.classList.add('visible');

    playSound('musicBox');
    if (music) {
        music.loop = false;
        music.addEventListener('ended', finish);
        // Belt and braces if the file never fires `ended`.
        const known = isFinite(music.duration) && music.duration > 0;
        afterWin(known ? music.duration * 1000 + 500 : END_CARD_FALLBACK_MS, finish);
    } else {
        afterWin(END_CARD_FALLBACK_MS, finish);
    }

    screen.addEventListener('click', finish);
}

// How far the "6" sits below the "5" before the clock rolls, as a share of the
// digit's own height. >100% leaves clear air between them mid-roll.
const WIN_DIGIT_GAP = 165;
const WIN_ROLL_MS = 2200;
const WIN_HOLD_BEFORE_ROLL_MS = 1200;
const WIN_FADE_MS = 600;
const WIN_FALLBACK_MS = 9000;

function triggerWinSequence(callback) {
    const winScreen = document.getElementById('winScreen');
    const winDigit5 = document.getElementById('winDigit5');
    const winDigit6 = document.getElementById('winDigit6');
    const night = currentNight;

    clearWinTimers();

    if (!winScreen || !winDigit5 || !winDigit6) {
        if (typeof callback === 'function') callback();
        return;
    }

    if (typeof AIBot !== 'undefined') AIBot.stop();
    stopSound('ambience');
    stopSound('on_cam');
    stopChicaKitchenSound();
    stopKitchenMusic();
    stopPirateSongRolls();
    stopNightCall();
    if (typeof stopPowerOutageSequence === 'function') {
        stopPowerOutageSequence();
    }

    // Reset the roller: 5 in view, 6 parked further below than its own height.
    winDigit6.style.top = WIN_DIGIT_GAP + '%';
    winDigit5.style.transition = 'none';
    winDigit6.style.transition = 'none';
    winDigit5.style.transform = 'translateY(0%)';
    winDigit6.style.transform = 'translateY(0%)';
    void winDigit5.offsetHeight;

    winScreen.style.display = 'flex';
    winScreen.classList.remove('visible');
    void winScreen.offsetHeight;
    winScreen.classList.add('visible');
    playSound('win');

    // The scene runs exactly as long as win.mp3 does. The chime's length is only
    // known once metadata has loaded, so fall back to a fixed hold if it hasn't.
    const chime = ensureAudio('win');
    const chimeMs = chime && isFinite(chime.duration) && chime.duration > 0
        ? chime.duration * 1000
        : WIN_FALLBACK_MS;
    const holdAfterRoll = Math.max(
        400,
        chimeMs - WIN_HOLD_BEFORE_ROLL_MS - WIN_ROLL_MS - WIN_FADE_MS
    );

    afterWin(WIN_HOLD_BEFORE_ROLL_MS, () => {
        const roll = `transform ${WIN_ROLL_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        winDigit5.style.transition = roll;
        winDigit6.style.transition = roll;
        winDigit5.style.transform = `translateY(-${WIN_DIGIT_GAP}%)`;
        winDigit6.style.transform = `translateY(-${WIN_DIGIT_GAP}%)`;

        afterWin(WIN_ROLL_MS + holdAfterRoll, () => {
            winScreen.classList.remove('visible');
            afterWin(WIN_FADE_MS, () => {
                stopSound('win');
                winScreen.style.display = 'none';
                finishNight(night, callback);
            });
        });
    });
}

/* Where a cleared night goes next: 1-4 roll straight into the following night,
   5/6/7 stop on their end card and then drop back to the menu. */
function finishNight(night, callback) {
    if (night < 5) {
        const nextNight = night + 1;
        if (nextNight > getSavedNight()) setSavedNight(nextNight);
        startGame(nextNight);
        return;
    }

    if (night === 5 && getSavedNight() < 6) setSavedNight(6);

    showEndCard(night, () => {
        if (typeof callback === 'function') callback();
        else returnToMainMenu();
    });
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
// Used by the camera switch and by the night-intro burst — preload so neither stutters.
glitchFrames.forEach(src => { const img = new Image(); img.src = src; });
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

/* ------------------- Freddy's music box (Kitchen, CAM 06) -------------------
   Clear when you're watching the kitchen, and barely-there through the office
   wall otherwise. The muffling is a real lowpass rather than just a low volume,
   which needs the element routed through Web Audio; if that isn't available the
   mix falls back to volume alone. */
const KITCHEN_MUSIC_ON_CAM = { gain: 0.55, cutoffHz: 18000 };
const KITCHEN_MUSIC_MUFFLED = { gain: 0.09, cutoffHz: 380 };

/* One context for the page. Browsers cap how many a document may open, and both
   kitchen sources want the same one. `false` means Web Audio isn't available at
   all, which every caller reads as "fall back to plain volume". */
let sharedAudioCtx = null;

function getAudioContext() {
    if (sharedAudioCtx !== null) return sharedAudioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { sharedAudioCtx = false; return false; }
    try {
        sharedAudioCtx = new Ctx();
    } catch (err) {
        sharedAudioCtx = false;
    }
    return sharedAudioCtx;
}

// element -> lowpass -> gain -> speakers. Returns false if the routing can't be
// built, in which case the caller drives `el.volume` directly instead.
function buildFilteredChain(el) {
    const ctx = getAudioContext();
    if (!ctx) return false;
    try {
        const source = ctx.createMediaElementSource(el);
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        const gain = ctx.createGain();
        source.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        return { ctx, filter, gain };
    } catch (err) {
        return false;
    }
}

function resumeAudioContext(chain) {
    if (chain && chain.ctx.state === 'suspended') {
        chain.ctx.resume().catch(() => { });
    }
}

let kitchenChain = null;
let kitchenMusicPlaying = false;

function ensureKitchenChain() {
    const el = ensureAudio('kitchenMusicBox');
    if (!el) return null;
    el.loop = true;

    if (kitchenChain === null) {
        kitchenChain = buildFilteredChain(el);
    }
    return el;
}

function setKitchenMusicMix(onCam) {
    const el = ensureKitchenChain();
    if (!el) return;
    const mix = onCam ? KITCHEN_MUSIC_ON_CAM : KITCHEN_MUSIC_MUFFLED;

    if (kitchenChain) {
        const now = kitchenChain.ctx.currentTime;
        kitchenChain.gain.gain.setTargetAtTime(mix.gain, now, 0.15);
        kitchenChain.filter.frequency.setTargetAtTime(mix.cutoffHz, now, 0.15);
        el.volume = 1;
    } else {
        el.volume = mix.gain;
    }
}

function startKitchenMusic(onCam) {
    const el = ensureKitchenChain();
    if (!el) return;
    setKitchenMusicMix(onCam);
    if (kitchenMusicPlaying) return;
    kitchenMusicPlaying = true;
    resumeAudioContext(kitchenChain);
    el.play().catch(() => { });
}

function stopKitchenMusic() {
    kitchenMusicPlaying = false;
    const el = audio['kitchenMusicBox'];
    if (el) {
        el.pause();
        el.currentTime = 0;
    }
}

// Freddy is in the kitchen for as long as his location is CAM 06.
function updateFreddyMusicBox(state) {
    const inKitchen = !!(state && state.animatronics && state.animatronics.freddy.location === '6');
    if (!inKitchen || state.power <= 0 || isPowerOutage) {
        stopKitchenMusic();
        return;
    }
    startKitchenMusic(isCameraUp && selectedCamera === '6');
}

/* --------------------- Foxy's tune inside Pirate Cove ----------------------
   One chance in five every 30 seconds, and only while you're actually watching
   CAM 1C with Foxy still behind the curtain. */
const PIRATE_SONG_INTERVAL_MS = 30000;
const PIRATE_SONG_CHANCE = 0.2;
let pirateSongTimer = null;

function foxyStillInCove() {
    const foxy = currentState && currentState.animatronics && currentState.animatronics.foxy;
    return !!foxy && foxy.foxyStage < 3;
}

function startPirateSongRolls() {
    stopPirateSongRolls();
    pirateSongTimer = setInterval(() => {
        if (!currentState || currentState.power <= 0 || isPowerOutage) return;
        if (!isCameraUp || selectedCamera !== '1C') return;
        if (!foxyStillInCove()) return;
        if (Math.random() < PIRATE_SONG_CHANCE) playSound('pirateSong');
    }, PIRATE_SONG_INTERVAL_MS);
}

function stopPirateSongRolls() {
    if (pirateSongTimer) {
        clearInterval(pirateSongTimer);
        pirateSongTimer = null;
    }
    stopSound('pirateSong');
}

/* ------------------- Chica in the Kitchen (CAM 06) -------------------------
   The same rule as Freddy's music box: clear while you're watching CAM 06, and
   quiet and muffled through the office wall otherwise. Where Freddy loops one
   clip, Chica's kitchen is four oven clips picked at random with a short pause
   between them, so it reads as someone banging around in there rather than a
   single clang. They share one element so the Web Audio routing survives the
   src swap — a MediaElementSource binds to the element, not to the file. */
const CHICA_KITCHEN_ON_CAM = { gain: 0.55, cutoffHz: 18000 };
const CHICA_KITCHEN_MUFFLED = { gain: 0.09, cutoffHz: 380 };

const OVEN_CLIPS = [
    'audio/OVEN-DRAWE_GEN-HDF18122.wav',
    'audio/OVEN-DRA_1_GEN-HDF18119.wav',
    'audio/OVEN-DRA_2_GEN-HDF18120.wav',
    'audio/OVEN-DRA_7_GEN-HDF18121.wav'
];
const OVEN_GAP_MIN_MS = 700;
const OVEN_GAP_MAX_MS = 2600;

let chicaKitchenChain = null;
let chicaKitchenPlaying = false;
let chicaOvenEl = null;
let chicaOvenGapTimer = null;

function ensureChicaOvenElement() {
    if (chicaOvenEl) return chicaOvenEl;

    chicaOvenEl = new Audio(OVEN_CLIPS[0]);
    chicaOvenEl.preload = 'auto';
    chicaOvenEl.volume = 1;
    chicaOvenEl.addEventListener('ended', () => {
        if (!chicaKitchenPlaying) return;
        const gap = OVEN_GAP_MIN_MS + Math.random() * (OVEN_GAP_MAX_MS - OVEN_GAP_MIN_MS);
        chicaOvenGapTimer = setTimeout(playNextOvenClip, gap);
    });

    chicaKitchenChain = buildFilteredChain(chicaOvenEl);
    return chicaOvenEl;
}

function playNextOvenClip() {
    chicaOvenGapTimer = null;
    if (!chicaKitchenPlaying) return;
    const el = ensureChicaOvenElement();
    el.src = OVEN_CLIPS[Math.floor(Math.random() * OVEN_CLIPS.length)];
    el.currentTime = 0;
    el.play().catch(() => { });
}

function setChicaKitchenMix(onCam) {
    const el = ensureChicaOvenElement();
    if (!el) return;
    const mix = onCam ? CHICA_KITCHEN_ON_CAM : CHICA_KITCHEN_MUFFLED;

    if (chicaKitchenChain) {
        const now = chicaKitchenChain.ctx.currentTime;
        chicaKitchenChain.gain.gain.setTargetAtTime(mix.gain, now, 0.15);
        chicaKitchenChain.filter.frequency.setTargetAtTime(mix.cutoffHz, now, 0.15);
        el.volume = 1;
    } else {
        el.volume = mix.gain;
    }
}

function startChicaKitchenSound(onCam) {
    const el = ensureChicaOvenElement();
    if (!el) return;
    setChicaKitchenMix(onCam);
    if (chicaKitchenPlaying) return;
    chicaKitchenPlaying = true;
    resumeAudioContext(chicaKitchenChain);
    playNextOvenClip();
}

function stopChicaKitchenSound() {
    chicaKitchenPlaying = false;
    if (chicaOvenGapTimer) {
        clearTimeout(chicaOvenGapTimer);
        chicaOvenGapTimer = null;
    }
    if (chicaOvenEl) {
        chicaOvenEl.pause();
        chicaOvenEl.currentTime = 0;
    }
}

// Chica is in the kitchen for as long as her location is CAM 06.
function updateChicaKitchenSound(state) {
    const inKitchen = !!(state && state.animatronics && state.animatronics.chica.location === '6');
    if (!inKitchen || state.power <= 0 || isPowerOutage) {
        stopChicaKitchenSound();
        return;
    }
    startChicaKitchenSound(isCameraUp && selectedCamera === '6');
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

    // Both kitchen sources open up when you land on CAM 06 and muffle again when
    // you leave it.
    if (currentState) {
        updateFreddyMusicBox(currentState);
        updateChicaKitchenSound(currentState);
    }
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

// Flip the monitor down visually without telling the server — used when the
// power cutting out yanks the camera from the player's hands.
function playCameraFlipDown(onDone) {
    isFoxySprinting = false;
    if (foxyRunInterval) {
        clearInterval(foxyRunInterval);
        foxyRunInterval = null;
    }
    if (cameraAnimInterval) {
        clearInterval(cameraAnimInterval);
        cameraAnimInterval = null;
    }

    mouseInOverlay = false;
    stopSound('on_cam');
    playSound('put_down');

    if (cameraFeed) cameraFeed.style.display = 'none';
    if (cameraOverlay) cameraOverlay.style.display = 'none';
    setKitchenTextVisible(false);

    if (!cameraAnimation) {
        cameraAnimating = false;
        if (typeof onDone === 'function') onDone();
        return;
    }

    cameraAnimating = true;
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
            if (typeof onDone === 'function') onDone();
        }
    }, 18);
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

    // The room's frozen list wins over the menu's from here on.
    if (state.cheats) setRunCheats(state.cheats);
    updateMapDots(state);

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

    if (prevAnimLocations.freddy !== null) {
        // Freddy's laugh is his own cue and is not tied to the feed at all — it
        // plays wherever he goes, monitor up or down.
        if (prevAnimLocations.freddy !== a.freddy.location) {
            const laughs = ['freddyLaugh1', 'freddyLaugh2', 'freddyLaugh3'];
            const randLaugh = laughs[Math.floor(Math.random() * laughs.length)];
            playSound(randLaugh);
        }

        /* The feed only cuts out when Bonnie or Chica move, and only on the
           camera being watched at that moment.

           It used to fire on any of the four moving, anywhere, whether or not
           the monitor was even up. On a busy night that is four clocks between
           3 and 5 seconds against a 5-second blackout, so the picture was
           static more often than not and the cameras stopped being usable.
           Freddy and Foxy no longer touch it: he has his laugh and Foxy has the
           cove, neither of which needs the screen to break.

           Either end of the move counts — she vanished from the room being
           watched, or she walked into it. Both are the picture changing under
           the player, which is what the static is for. */
        if (state.cameraUp) {
            const disturbed = ['bonnie', 'chica'].some(name => {
                const from = prevAnimLocations[name];
                const to = a[name].location;
                return from !== to && (selectedCamera === from || selectedCamera === to);
            });

            if (disturbed) {
                triggerCameraBlackout();
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

    // Both of these stop themselves once their animatronic leaves CAM 06.
    updateFreddyMusicBox(state);
    updateChicaKitchenSound(state);

    const aiDisplay = document.getElementById('aiDisplay');
    if (aiDisplay) {
        document.getElementById('aiF').textContent = state.animatronics.freddy.ai;
        document.getElementById('aiB').textContent = state.animatronics.bonnie.ai;
        document.getElementById('aiC').textContent = state.animatronics.chica.ai;
        document.getElementById('aiFx').textContent = state.animatronics.foxy.ai;
        const aiG = document.getElementById('aiG');
        if (aiG && state.animatronics.goldenFreddy) {
            aiG.textContent = state.animatronics.goldenFreddy.ai;
        }
    }

    drawPixelText(timeDisplay, (state.hour === 0 ? 12 : state.hour) + ' AM');
    drawPixelText(powerDisplay, 'Power left: ' + state.power + '%');
    if (usageDisplay) usageDisplay.textContent = state.usage;

    const leftDoor = document.getElementById('leftDoor');
    const rightDoor = document.getElementById('rightDoor');

    if (isPowerOutage || state.power <= 0) {
        if (doorsAtPowerOut === null) {
            doorsAtPowerOut = { left: !!prevDoorState.left, right: !!prevDoorState.right };
        }
        // Leave the doors alone while the outage sequence rolls them open.
        if (!isPowerOutage) {
            if (leftDoor) leftDoor.style.display = 'none';
            if (rightDoor) rightDoor.style.display = 'none';
        }
        prevDoorState = { left: false, right: false };

        const leftButtons = document.getElementById('leftButtons');
        const rightButtons = document.getElementById('rightButtons');
        if (leftButtons) leftButtons.style.display = 'none';
        if (rightButtons) rightButtons.style.display = 'none';

        const powerUsage = document.getElementById('powerUsage');
        if (powerUsage) powerUsage.style.display = 'none';

        isCameraUp = false;
        if (cameraOverlay) cameraOverlay.style.display = 'none';
        // Don't blank the monitor mid-flip — the outage plays the flip-down
        // animation and this runs again every second while it's still going.
        if (cameraAnimation && !cameraAnimating) cameraAnimation.style.display = 'none';
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

    drawPixelText(document.getElementById('nightDisplay'), 'Night ' + currentNight);
}

let lastFrameTime = 0;
let realTimeTimerStart = null;

function formatRealTimeTimer(ms) {
    if (ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function frame(now) {
    const deltaSec = lastFrameTime ? Math.min(0.1, (now - lastFrameTime) / 1000) : 0;
    lastFrameTime = now;

    const cheatsScreen = document.getElementById('cheatsScreen');
    if (mainMenu.style.display === 'none' && document.getElementById('customNightScreen').style.display === 'none' && document.getElementById('newStartScreen').style.display === 'none' && (!cheatsScreen || cheatsScreen.style.display === 'none')) {
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

    const realTimeDisplay = document.getElementById('realTimeTimerDisplay');
    if (realTimeDisplay) {
        if (runCheatOn('realTime') && realTimeTimerStart && currentState && currentState.power > 0 && !isPowerOutage) {
            realTimeDisplay.style.display = 'block';
            drawPixelText(realTimeDisplay, formatRealTimeTimer(Date.now() - realTimeTimerStart));
        } else {
            realTimeDisplay.style.display = 'none';
        }
    }

    requestAnimationFrame(frame);
}

let isPowerOutage = false;
// Door state captured the moment power hit zero — the broadcast that reports it
// has already zeroed state.doors, so it can't be read back off the state.
let doorsAtPowerOut = null;
let powerOutagePhase = 0;
let powerOutageTimeouts = [];
let powerOutageIntervals = [];
let scaredAtDoor = { left: false, right: false };
let cameraBlackoutActive = false;
let cameraBlackoutTimeout = null;
let prevHour = null;

function triggerCameraBlackout() {
    // Map Hacks (cheat 1) drops the blackout entirely, which is what lets the
    // player watch an animatronic "teleport" between rooms live.
    if (runCheatOn('mapHacks')) return;

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

/* Freddy's countdown in the dark, for phases 2 and 3 alike. Normally a 20% roll
   on every tick with a 20-second cap. Unlucky (6) takes the very first tick;
   Super Lucky (7) always runs the full 20 seconds. Phase 1 is left random —
   only phases 2 and 3 were specified. */
const OUTAGE_PHASE_CAP_SEC = 20;

function shouldAdvanceOutagePhase(elapsedSec) {
    if (runCheatOn('unlucky')) return true;
    if (runCheatOn('superLucky')) return elapsedSec >= OUTAGE_PHASE_CAP_SEC;
    return Math.random() < 0.2 || elapsedSec >= OUTAGE_PHASE_CAP_SEC;
}

function clearPowerOutageTimers() {
    powerOutageTimeouts.forEach(t => clearTimeout(t));
    powerOutageIntervals.forEach(i => clearInterval(i));
    powerOutageTimeouts = [];
    powerOutageIntervals = [];
}

function stopPowerOutageSequence() {
    isPowerOutage = false;
    doorsAtPowerOut = null;
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
    // Nothing left for the bot to click, and the office map goes with the lights.
    if (typeof AIBot !== 'undefined') AIBot.stop();
    setOfficeMapVisible(false);

    stopSound('ambience');
    stopSound('on_cam');
    playSound('powerdown');

    // Hide usage bar
    const powerUsage = document.getElementById('powerUsage');
    if (powerUsage) powerUsage.style.display = 'none';

    // Roll the doors open rather than blanking them, and let the shutter be
    // heard. The server zeroes `doors` in the same broadcast that reports 0%
    // power, so read the snapshot taken before that update wiped prevDoorState.
    const closedAtOutage = doorsAtPowerOut || prevDoorState;
    const leftDoor = document.getElementById('leftDoor');
    const rightDoor = document.getElementById('rightDoor');

    if (closedAtOutage.left || closedAtOutage.right) {
        playSound('doorClick');
    }
    if (closedAtOutage.left) {
        updateDoorTextureAnimated(leftDoor, 'left', false);
    } else if (leftDoor) {
        leftDoor.style.display = 'none';
    }
    if (closedAtOutage.right) {
        updateDoorTextureAnimated(rightDoor, 'right', false);
    } else if (rightDoor) {
        rightDoor.style.display = 'none';
    }
    prevDoorState = { left: false, right: false };

    // Force the camera down through the flip-down animation instead of cutting
    // straight to the office.
    const cameraContainer = document.getElementById('cameraContainer');
    if (cameraContainer) cameraContainer.style.display = 'none';
    canToggleCamera = false;

    if (isCameraUp || cameraAnimating) {
        playCameraFlipDown();
    } else {
        isCameraUp = false;
        if (cameraOverlay) cameraOverlay.style.display = 'none';
        if (cameraAnimation) cameraAnimation.style.display = 'none';
    }
    isCameraUp = false;

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
            if (shouldAdvanceOutagePhase(phase2Elapsed)) {
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
            if (shouldAdvanceOutagePhase(phase3Elapsed)) {
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

/* Independent stars, each in a fixed slot on the menu. They are separate flags
   rather than a count so a later clear can't imply an earlier one, and so each
   lands in its own slot.

   0 — cleared night 5          3 — Golden Freddy cheat
   1 — cleared the 6th night    4 — Power Loss cheat
   2 — cleared the 7th night    5 — Insta Bonnie Chica cheat
                                6 — Unlucky cheat
                                7 — Real Time cheat
                                8 — Speed cheat

   Slots 3-8 are earned only by clearing Night 7 at 4/20 with that cheat on; see
   awardCheatStars. The starIndex values live in cheats.js. */
const STAR_KEYS = [
    'fnaf_star_night5', 'fnaf_star_night6', 'fnaf_star_night7',
    'fnaf_star_golden', 'fnaf_star_powerloss', 'fnaf_star_instabc',
    'fnaf_star_unlucky', 'fnaf_star_realtime', 'fnaf_star_speed'
];

// CSS classes per slot. Empty for the original three, which stay plain <img>.
const STAR_STYLES = [
    '', '', '',
    'cheat-star star-gold',
    'cheat-star star-green',
    'cheat-star star-purpleyellow',
    'cheat-star star-multi',
    'cheat-star star-rainbow star-big',
    'cheat-star star-red star-pulse'
];

function hasStar(index) {
    return localStorage.getItem(STAR_KEYS[index]) === '1';
}

/* The single gate for every star in the game. Putting it here rather than at the
   call sites is what makes "cheats that forfeit the night 5/6/7 stars also
   forfeit the cheat stars" fall out for free — nothing can write a star past it. */
function awardStar(index) {
    if (typeof anyStarBlockingCheatOn === 'function' && anyStarBlockingCheatOn()) return;
    if (STAR_KEYS[index]) localStorage.setItem(STAR_KEYS[index], '1');
}

// 4/20 means all four Custom Night sliders at 20.
function isFourTwentyRun() {
    const ai = currentCustomAI;
    if (!ai) return false;
    return ['freddy', 'bonnie', 'chica', 'foxy'].every(name => ai[name] === 20);
}

// Called on a Night 7 win. awardStar still has the final say, so a run with a
// blocking cheat on writes nothing here either.
function awardCheatStars(night) {
    if (night !== 7 || !isFourTwentyRun()) return;
    if (typeof activeStarGrantingCheats !== 'function') return;
    activeStarGrantingCheats().forEach(cheat => awardStar(cheat.starIndex));
}

// A cleared 5th night is what opens the 6th.
function isNight6Unlocked() {
    return hasStar(0) || getSavedNight() >= 6;
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

    // 6th Night keeps its space when locked (visibility, not display) so Custom
    // Night always sits in the slot below it rather than sliding up.
    if (btnNight6) btnNight6.style.visibility = isNight6Unlocked() ? 'visible' : 'hidden';
    if (btnCustomNight) btnCustomNight.style.display = 'flex'; // always available

    /* The original three keep fixed slots, so an unearned one leaves a gap and
       the others don't shuffle. The six cheat stars are appended only once
       earned — reserving empty slots for them would leave a permanent run of
       blank space under the title for anyone who never touches the cheats. */
    const starsContainer = document.getElementById('starsContainer');
    if (starsContainer) {
        starsContainer.innerHTML = '';
        for (let i = 0; i < STAR_KEYS.length; i++) {
            const earned = hasStar(i);
            const isCheatStar = i >= 3;
            if (isCheatStar && !earned) continue;

            const slot = document.createElement('div');
            slot.className = 'star-slot';
            if (earned) {
                if (isCheatStar) {
                    // Masked div: the fill is a colour or an animation, not a bitmap.
                    slot.className += ' ' + STAR_STYLES[i];
                } else {
                    const img = document.createElement('img');
                    img.src = 'textures/main menu/star.png';
                    img.alt = 'Star';
                    slot.appendChild(img);
                }
            }
            starsContainer.appendChild(slot);
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

/* 1/9/8/7 on the four sliders spells the year on the posters. Setting it and
   hitting READY doesn't start a shift — Golden Freddy answers instead. */
const GOLDEN_FREDDY_CODE = { freddy: 1, bonnie: 9, chica: 8, foxy: 7 };

function isGoldenFreddyCode(levels) {
    return Object.keys(GOLDEN_FREDDY_CODE)
        .every(name => levels[name] === GOLDEN_FREDDY_CODE[name]);
}

document.getElementById('btnStartCustom')?.addEventListener('click', () => {
    document.getElementById('customNightScreen').style.display = 'none';

    if (isGoldenFreddyCode(customAiLevels)) {
        // Skip the night card entirely — the scare is the whole response.
        stopSound('menuAmbience');
        stopSound('mainMenu2');
        stopMenuEffects();
        triggerGoldenFreddyJumpscare();
        return;
    }

    // The third star is earned by surviving to 6 AM here, not by setting 20/20/20/20.
    startGame(7, customAiLevels);
});

document.getElementById('btnBackCustom')?.addEventListener('click', () => {
    document.getElementById('customNightScreen').style.display = 'none';
    showMainMenu();
});

/* ------------------------------ Cheats menu -------------------------------
   Rows are built from the CHEATS array in cheats.js rather than written out in
   index.html, so a cheat is added in exactly one place. */
const CHEATS_HINT_IDLE = 'Hover a cheat for what it does.';

function setCheatsHint(text) {
    const hint = document.getElementById('cheatsHint');
    if (hint) hint.textContent = text || CHEATS_HINT_IDLE;
}

/* One row per cheat: number, name, the star it pays out, and its state. The
   description lives in the shared line under the list rather than under every
   row — ten labels read as a menu, ten labels each with their own paragraph of
   small print read as a settings page, and this screen sits next to Custom
   Night, which is plain centred text on black.

   Kept in the original 1-10 order. That is the numbering the cheats were
   specified in and the one to reach for when talking about them, and the star
   swatch already shows at a glance which of them forfeit stars and which pay
   one out — so regrouping would cost the familiar order to restate something
   the row already says. */
function buildCheatRow(cheat) {
    const on = isCheatOn(cheat.id);
    const locked = isCheatLocked(cheat.id);

    const row = document.createElement('div');
    row.className = 'cheat-row' + (on ? ' is-on' : '') + (locked ? ' is-locked' : '');

    const num = document.createElement('div');
    num.className = 'cheat-num';
    num.textContent = cheat.num;

    const name = document.createElement('div');
    name.className = 'cheat-name';
    name.textContent = cheat.name;

    row.appendChild(num);
    row.appendChild(name);

    // The star this cheat pays out, in the colour it will actually be. Every
    // row reserves the slot so the names stay on one column whether or not a
    // given cheat has a star.
    const mark = document.createElement('div');
    mark.className = 'cheat-star-mark';
    if (cheat.starIndex !== null && STAR_STYLES[cheat.starIndex]) {
        mark.className += ' ' + STAR_STYLES[cheat.starIndex];
    }
    row.appendChild(mark);

    const toggle = document.createElement('div');
    toggle.className = 'cheat-toggle';
    toggle.textContent = locked ? 'LOCKED' : (on ? 'ON' : 'OFF');
    row.appendChild(toggle);

    // Say *why* a locked cheat won't turn on rather than just grEying it out.
    const hint = locked
        ? 'Locked while ' + getCheat(cheat.mutex).name + ' is on.'
        : cheat.desc;
    row.addEventListener('mouseenter', () => setCheatsHint(hint));
    row.addEventListener('mouseleave', () => setCheatsHint(''));

    if (!locked) {
        row.addEventListener('click', () => {
            toggleCheat(cheat.id);
            playSound('Blip3');
            renderCheatsList();
            setCheatsHint(hint);
        });
    }
    return row;
}

function renderCheatsList() {
    const list = document.getElementById('cheatsList');
    const warning = document.getElementById('cheatsWarning');
    if (!list) return;

    list.innerHTML = '';
    CHEATS.forEach(cheat => list.appendChild(buildCheatRow(cheat)));

    if (warning) {
        warning.textContent = anyStarBlockingCheatOn()
            ? 'Stars are disabled for this run.'
            : '';
    }
}

function showCheatsScreen() {
    renderCheatsList();
    setCheatsHint('');
    mainMenu.style.display = 'none';
    const screen = document.getElementById('cheatsScreen');
    if (screen) screen.style.display = 'flex';
}

document.getElementById('btnCheats')?.addEventListener('click', () => {
    showCheatsScreen();
});

document.getElementById('btnBackCheats')?.addEventListener('click', () => {
    const screen = document.getElementById('cheatsScreen');
    if (screen) screen.style.display = 'none';
    showMainMenu();
});

// Setup hover selector arrow positioning
const selectorArrow = document.getElementById('selectorArrow');
document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('mouseenter', () => {
        // A locked 6th Night still occupies its slot, so check visibility too.
        if (item.style.display === 'none' || item.style.visibility === 'hidden') return;
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
    realTimeTimerStart = null;
    stopPowerOutageSequence();
    resetGoldenFreddy();
    if (typeof AIBot !== 'undefined') AIBot.stop();
    renderMainMenu();
    mainMenu.style.display = 'flex';
    document.getElementById('customNightScreen').style.display = 'none';
    const cheatsScreen = document.getElementById('cheatsScreen');
    if (cheatsScreen) cheatsScreen.style.display = 'none';
    setOfficeMapVisible(false);
    updateMapDots(null);
    office.style.display = 'none';
    document.getElementById('cameraContainer').style.display = 'none';
    document.getElementById('powerUsage').style.display = 'none';
    document.getElementById('timeDisplayContainer').style.display = 'none';
    document.getElementById('jumpscare').style.display = 'none';
    document.getElementById('aiDisplay').style.display = 'none';
    const endCardScreen = document.getElementById('endCardScreen');
    if (endCardScreen) {
        endCardScreen.style.display = 'none';
        endCardScreen.classList.remove('visible');
    }
    cameraOverlay.style.display = 'none';
    cameraAnimation.style.display = 'none';
    stopSound('ambience');
    stopSound('win');
    stopChicaKitchenSound();
    stopKitchenMusic();
    stopPirateSongRolls();
    stopNightCall();
    startMenuMusic();
    startMenuTwitch();
}

function hideMainMenu() {
    mainMenu.style.display = 'none';
    document.getElementById('customNightScreen').style.display = 'none';
    const cheatsScreen = document.getElementById('cheatsScreen');
    if (cheatsScreen) cheatsScreen.style.display = 'none';
    setOfficeMapVisible(runCheatOn('mapHacks'));
    office.style.display = 'block';
    document.getElementById('cameraContainer').style.display = 'block';
    document.getElementById('powerUsage').style.display = 'flex';
    document.getElementById('timeDisplayContainer').style.display = 'flex';
    document.getElementById('aiDisplay').style.display = 'block';
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

let nightIntroGlitchInterval = null;

// A burst of the camera-glitch frames as the night card comes up, with the
// blip landing on the same beat.
function playNightIntroGlitch() {
    const el = document.getElementById('nightIntroGlitch');
    if (!el) return;

    if (nightIntroGlitchInterval) {
        clearInterval(nightIntroGlitchInterval);
        nightIntroGlitchInterval = null;
    }

    const frames = [...glitchFrames, ...glitchFrames];
    let idx = 0;
    el.src = frames[0];
    el.style.display = 'block';

    nightIntroGlitchInterval = setInterval(() => {
        idx++;
        if (idx < frames.length) {
            el.src = frames[idx];
        } else {
            clearInterval(nightIntroGlitchInterval);
            nightIntroGlitchInterval = null;
            el.style.display = 'none';
        }
    }, 60);
}

function showNightIntro(night, callback) {
    const nightIntroScreen = document.getElementById('nightIntroScreen');
    const nightIntroImg = document.getElementById('nightIntroImg');

    if (nightIntroScreen && nightIntroImg) {
        setPlateSrc(nightIntroImg, 'textures/main menu/' + getNightIntroFilename(night));
        nightIntroScreen.style.display = 'flex';
        playSound('Blip3');
        playNightIntroGlitch();

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
    stopNightCall();
    resetGoldenFreddy();
    if (typeof AIBot !== 'undefined') AIBot.stop();
    canToggleCamera = true;
    currentNight = night;
    /* Drop the finished run's state. joinGame is a socket round trip, so without
       this there is a window where the new night is underway while currentState
       still describes the last one — and anything reading it, the AI bot most of
       all, acts on positions and AI levels that belong to a different shift. */
    currentState = null;
    // Snapshot both, so nothing edited on a menu mid-run can change this night.
    currentCustomAI = customAI ? { ...customAI } : null;
    setRunCheats(getEnabledCheats());
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
    realTimeTimerStart = null;
    showNightIntro(night, () => {
        realTimeTimerStart = Date.now();
        joinGame(currentRoomId, night, customAI, getEnabledCheats());
        startPirateSongRolls();
        // Counted from the moment the shift actually starts, not from the card.
        startNightCall(night);
        if (runCheatOn('aiMode') && typeof AIBot !== 'undefined') AIBot.start();
    });
}

// Progression is settled in finishNight(), which knows whether the night rolls
// straight into the next one or stops on an end card.
function returnToMainMenu() {
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
    setSavedNight(1);
    triggerNewStart(() => {
        startGame(1);
    });
});

document.getElementById('btnContinue')?.addEventListener('click', () => {
    const savedNight = getSavedNight();
    startGame(savedNight);
});

document.getElementById('btnNight6')?.addEventListener('click', (e) => {
    if (e.currentTarget.style.visibility === 'hidden') return;
    startGame(6);
});

document.getElementById('btnCustomNight')?.addEventListener('click', () => {
    updateCustomAiDisplay();
    mainMenu.style.display = 'none';
    document.getElementById('customNightScreen').style.display = 'flex';
});

initTextPlates();

// Warm the clips whose *duration* drives timing, so it is known by the time a
// night is actually cleared rather than NaN on first use.
['win', 'musicBox', 'kitchenMusicBox', 'pirateSong'].forEach(ensureAudio);

// Golden Freddy's two cues are warmed for latency, not duration: both have to be
// audible on the exact frame they are asked for, with no fetch in between.
['goldenLaugh', 'jumpscare2'].forEach(ensureAudio);

// Seed the HUD so it is drawn before the first server state arrives.
drawPixelText(document.getElementById('usageLabel'), 'Usage:');
drawPixelText(document.getElementById('powerDisplay'), 'Power left: 100%');
drawPixelText(document.getElementById('timeDisplay'), '12 AM');
drawPixelText(document.getElementById('nightDisplay'), 'Night 1');

if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
        ['usageLabel', 'powerDisplay', 'timeDisplay', 'nightDisplay'].forEach(id => {
            const el = document.getElementById(id);
            if (el) delete el.dataset.pixelText;
        });
        drawPixelText(document.getElementById('usageLabel'), 'Usage:');
        drawPixelText(document.getElementById('powerDisplay'), 'Power left: ' + (gameState ? gameState.power : 100) + '%');
        drawPixelText(document.getElementById('timeDisplay'), (gameState && gameState.hour ? (gameState.hour === 0 ? 12 : gameState.hour) : 12) + ' AM');
        drawPixelText(document.getElementById('nightDisplay'), 'Night ' + currentNight);
    });
}

window.addEventListener('load', () => {
    showMainMenu();
});

requestAnimationFrame(frame);