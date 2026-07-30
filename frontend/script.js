// Game Elements
const office = document.getElementById('office');
const cameraOverlay = document.getElementById('cameraOverlay');
const cameraFeed = document.getElementById('cameraFeed');
const cameraAnimation = document.getElementById('cameraAnimation');
const cameraContainer = document.getElementById('cameraContainer');
const powerUsageImg = document.getElementById('powerUsageImg');
const onClickBorder = document.getElementById('onClickBorder');
const mainMenu = document.getElementById('mainMenu');
const menuBg = document.getElementById('menuBg');
const menuTitle = document.getElementById('menuTitle');

// UI Elements
const timeDisplay = document.getElementById('timeDisplay');
const powerDisplay = document.getElementById('powerDisplay');
const usageDisplay = document.getElementById('usageDisplay');

// State Variables
let mouseX = 0;
const DEFAULT_CAMERA_PAN = -25;
let cameraPan = DEFAULT_CAMERA_PAN;
let isCameraUp = false;
let selectedCamera = '1A';
let currentNight = 1;
let currentRoomId = null;
let currentState = null;

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
    powerdown: 'audio/powerdown.wav',
    jumpscare: 'audio/XSCREAM.wav',
    doorClick: 'audio/SFXBible_12478.wav',
    lightClick: 'audio/lights on.mp3',
    cam_open: 'audio/cam open.mp3',
    on_cam: 'audio/on_cam.wav',
    Blip3: 'audio/Blip3.mp3',
    put_down: 'audio/put down.wav',
    ambience: 'audio/office ambience.mp3',
    menuAmbience: 'audio/main menu ambience.mp3'
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

    if (name === 'ambience' || name === 'menuAmbience' || name === 'on_cam') {
        sound.loop = true;
        sound.volume = 0.3;
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
    playSound('menuAmbience');
}

function playSound(name) {
    const sound = ensureAudio(name);
    if (!sound || typeof sound.play !== 'function') return;

    try {
        sound.currentTime = 0;
        sound.volume = (name === 'ambience' || name === 'menuAmbience') ? 0.3 : 0.5;
        sound.play().catch(() => {});
    } catch (error) {
        console.warn('Audio play failed:', name, error);
    }
}

window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX / window.innerWidth;
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

function updateDoorTextureAnimated(doorEl, side, isOpen) {
    if (!doorEl) return;
    const leftFrames = ['textures/doors/left/100.png','textures/doors/left/99.png','textures/doors/left/98.png','textures/doors/left/97.png','textures/doors/left/96.png','textures/doors/left/95.png','textures/doors/left/94.png','textures/doors/left/93.png','textures/doors/left/92.png','textures/doors/left/91.png','textures/doors/left/90.png','textures/doors/left/89.png','textures/doors/left/88.png','textures/doors/left/87.png','textures/doors/left/86.png','textures/doors/left/101.png','textures/doors/left/102.png'];
    const rightFrames = ['textures/doors/right/104.png','textures/doors/right/103.png','textures/doors/right/105.png','textures/doors/right/106.png','textures/doors/right/107.png','textures/doors/right/108.png','textures/doors/right/109.png','textures/doors/right/110.png','textures/doors/right/111.png','textures/doors/right/112.png','textures/doors/right/113.png','textures/doors/right/114.png','textures/doors/right/115.png','textures/doors/right/116.png','textures/doors/right/117.png','textures/doors/right/118.png'];
    const frames = isOpen ? (side === 'left' ? leftFrames : rightFrames) : (side === 'left' ? [...leftFrames].reverse() : [...rightFrames].reverse());

    if (doorEl._doorAnimInterval) {
        clearInterval(doorEl._doorAnimInterval);
    }
    let idx = 0;
    doorEl._doorAnimInterval = setInterval(() => {
        if (idx < frames.length) {
            doorEl.style.backgroundImage = `url('${frames[idx]}')`;
            idx++;
        } else {
            clearInterval(doorEl._doorAnimInterval);
            doorEl._doorAnimInterval = null;
        }
    }, 20);
}

function updateCameraTexture(state) {
    if (!state || !state.cameraUp) {
        cameraFeed.style.display = 'none';
        return;
    }

    cameraFeed.style.display = 'block';
    applyCameraBackground();

    const cam = selectedCamera;
    const a = state.animatronics;
    let imgSrc = `${cam}.png`; // fallback empty

    const fLoc = a.freddy.location;
    const bLoc = a.bonnie.location;
    const cLoc = a.chica.location;
    const fxLoc = a.foxy.location;
    const fxStage = a.foxy.foxyStage;

    if (cam === '1A') {
        if (fLoc === '1A' && bLoc === '1A' && cLoc === '1A') imgSrc = '1A all.png';
        else if (fLoc === '1A' && cLoc === '1A') imgSrc = '1A chica.png'; // Bonnie left
        else if (fLoc === '1A' && bLoc === '1A') imgSrc = '1A bonnie.png'; // Chica left
        else if (bLoc === '1A' && cLoc === '1A') imgSrc = '1A bonnie_chica.png'; 
        else if (fLoc === '1A') imgSrc = '1A.png'; 
        else imgSrc = '1A.png';
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
        cameraFeed.style.display = 'none';
        cameraOverlay.style.backgroundImage = 'none';
        cameraOverlay.style.backgroundColor = '#000';
    } else {
        cameraFeed.src = 'textures/camera/' + imgSrc;
    }
}

function updateJumpscare(reason) {
    const jumpscare = document.getElementById('jumpscare');
    let src = 'textures/jumpscares/freddy/489.png';

    switch (reason) {
        case 'bonnie': src = 'textures/jumpscares/bonnie/291.png'; break;
        case 'chica': src = 'textures/jumpscares/chica/216.png'; break;
        case 'foxy': src = 'textures/jumpscares/foxy/242.png'; break;
        case 'freddy':
        default: src = 'textures/jumpscares/freddy/489.png'; break;
    }

    jumpscare.src = src;
    jumpscare.style.display = 'block';
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

function applyCameraBackground() {
    const camImg = selectedCamera ? `textures/camera/cam assets/${selectedCamera.toLowerCase()}.png` : 'textures/camera/0.png';
    cameraOverlay.style.backgroundImage = `url('${camImg}')`;
    cameraOverlay.style.backgroundSize = 'cover';
    cameraOverlay.style.backgroundRepeat = 'no-repeat';
    cameraOverlay.style.backgroundColor = '#000';
}

function selectCamera(cam) {
    selectedCamera = cam;
    
    const camEl = document.querySelector(`.camera-position[data-cam="${cam}"]`);
    if (camEl) {
        const existingBorder = camEl.querySelector('.on-click-border');
        if (existingBorder && existingBorder !== onClickBorder) {
            existingBorder.remove();
        }
        const camIcon = camEl.querySelector('img:not(.on-click-border)');
        if (camIcon && onClickBorder.parentNode !== camEl) {
            camEl.insertBefore(onClickBorder, camIcon);
        } else if (!camIcon && onClickBorder.parentNode !== camEl) {
            camEl.appendChild(onClickBorder);
        }
        onClickBorder.style.display = 'block';
        onClickBorder.style.left = '-4px';
        onClickBorder.style.top = '-4px';
        onClickBorder.style.width = 'calc(100% + 8px)';
        onClickBorder.style.height = 'calc(100% + 8px)';
    }
    
    applyCameraBackground();
    
    if (isCameraUp && currentState) {
        updateCameraTexture(currentState);
    }
}

let cameraAnimating = false;
let cameraAnimFrame = 0;
let cameraAnimInterval = null;
let cameraHovered = false;
let cameraCloseTimeout = null;
let mouseInOverlay = false;

function openCamera() {
    if (cameraHovered) return;
    cameraHovered = true;

    if (cameraCloseTimeout) {
        clearTimeout(cameraCloseTimeout);
        cameraCloseTimeout = null;
    }

    if (cameraAnimating) return;
    cameraAnimating = true;
    cameraAnimFrame = 0;

    cameraAnimation.style.display = 'block';
    cameraOverlay.style.display = 'block';
    applyCameraBackground();
    playSound('static');
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
        }
    }, 24);
}

function closeCamera() {
    cameraCloseTimeout = setTimeout(() => {
        if (cameraAnimating) {
            clearInterval(cameraAnimInterval);
            cameraAnimInterval = null;
            cameraAnimating = false;
        }
        cameraOverlay.style.display = 'none';
        cameraAnimation.style.display = 'none';
        cameraHovered = false;
        mouseInOverlay = false;
        stopSound('on_cam');
        playSound('put_down');
        sendAction('setCamera', null, false);
    }, 20);
}

cameraContainer.addEventListener('mouseenter', () => {
    if (cameraHovered && mouseInOverlay) {
        closeCamera();
        return;
    }
    openCamera();
    sendAction('setCamera', null, true);
});

cameraContainer.addEventListener('mouseleave', () => {
    if (!cameraAnimating && !mouseInOverlay) {
        closeCamera();
    }
});

cameraOverlay.addEventListener('mouseenter', () => {
    mouseInOverlay = true;
    if (cameraCloseTimeout) {
        clearTimeout(cameraCloseTimeout);
        cameraCloseTimeout = null;
    }
});

cameraOverlay.addEventListener('mouseleave', () => {
    mouseInOverlay = false;
    if (!cameraAnimating) {
        closeCamera();
    }
});

document.querySelectorAll('.camera-position').forEach(pos => {
    pos.addEventListener('click', () => {
        const cam = pos.dataset.cam;
        if (selectedCamera !== cam) {
            selectCamera(cam);
            playSound('Blip3');
        }
    });
});

let prevDoorState = { left: null, right: null };

function onServerState(state) {
    if (!state) return;
    currentState = state;

    checkVariants(state);

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

    if (prevDoorState.left !== null && prevDoorState.left !== state.doors.left) {
        leftDoor.style.transform = state.doors.left ? 'translateY(0%)' : 'translateY(-100%)';
        updateDoorTextureAnimated(leftDoor, 'left', state.doors.left);
        prevDoorState.left = state.doors.left;
    } else if (prevDoorState.left === null) {
        leftDoor.style.transform = state.doors.left ? 'translateY(0%)' : 'translateY(-100%)';
        updateDoorTexture(leftDoor, 'left', state.doors.left);
        prevDoorState.left = state.doors.left;
    }
    if (prevDoorState.right !== null && prevDoorState.right !== state.doors.right) {
        rightDoor.style.transform = state.doors.right ? 'translateY(0%)' : 'translateY(-100%)';
        updateDoorTextureAnimated(rightDoor, 'right', state.doors.right);
        prevDoorState.right = state.doors.right;
    } else if (prevDoorState.right === null) {
        rightDoor.style.transform = state.doors.right ? 'translateY(0%)' : 'translateY(-100%)';
        updateDoorTexture(rightDoor, 'right', state.doors.right);
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

    if (state.power <= 0) {
        office.style.backgroundImage = "url('textures/office/power out.png')";
    }
}

function frame() {
    if (mainMenu.style.display === 'none') {
        if (isCameraUp) {
            cameraPan -= 0.6;
            if (cameraPan < -40) cameraPan = 40;
            cameraOverlay.style.backgroundPosition = `calc(50% + ${cameraPan}px) center`;
        } else {
            if (mouseX < 0.25) {
                cameraPan += 2;
            } else if (mouseX > 0.75) {
                cameraPan -= 2;
            }
            cameraPan = Math.max(-50, Math.min(cameraPan, 0));
            office.style.left = cameraPan + "%";
        }
    }
    requestAnimationFrame(frame);
}

function triggerPowerOutage() {
    office.style.backgroundImage = "url('textures/office/power out.png')";
    stopSound('ambience');
    playSound('powerdown');
}

function triggerJumpscare(reason) {
    updateJumpscare(reason);
    playSound('jumpscare');
}

function showMainMenu() {
    mainMenu.style.display = 'flex';
    office.style.display = 'none';
    document.getElementById('cameraContainer').style.display = 'none';
    document.getElementById('powerUsage').style.display = 'none';
    document.getElementById('timeDisplayContainer').style.display = 'none';
    document.getElementById('jumpscare').style.display = 'none';
    document.getElementById('aiDisplay').style.display = 'none';
    cameraOverlay.style.display = 'none';
    cameraAnimation.style.display = 'none';
    stopSound('ambience');
    playSound('menuAmbience');
}

function hideMainMenu() {
    mainMenu.style.display = 'none';
    office.style.display = 'block';
    document.getElementById('cameraContainer').style.display = 'block';
    document.getElementById('powerUsage').style.display = 'flex';
    document.getElementById('timeDisplayContainer').style.display = 'flex';
    document.getElementById('aiDisplay').style.display = 'block';
    stopSound('menuAmbience');
    playSound('ambience');
}

function startGame(night) {
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
    onClickBorder.style.display = 'none';
    cameraHovered = false;
    mouseInOverlay = false;
    if (cameraCloseTimeout) {
        clearTimeout(cameraCloseTimeout);
        cameraCloseTimeout = null;
    }

    hideMainMenu();
    joinGame(currentRoomId, night);
}

function returnToMainMenu() {
    showMainMenu();
}

document.getElementById('btnNewGame').addEventListener('click', () => startGame(1));
document.getElementById('btnNight1').addEventListener('click', () => startGame(1));
document.getElementById('btnNight2').addEventListener('click', () => startGame(2));
document.getElementById('btnNight3').addEventListener('click', () => startGame(3));
document.getElementById('btnNight4').addEventListener('click', () => startGame(4));
document.getElementById('btnNight5').addEventListener('click', () => startGame(5));
document.getElementById('btnNight6').addEventListener('click', () => startGame(6));
document.getElementById('btnNight7').addEventListener('click', () => startGame(7));
document.getElementById('btnCustomNight').addEventListener('click', () => startGame(1));

window.addEventListener('load', () => {
    showMainMenu();
});

requestAnimationFrame(frame);