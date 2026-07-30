// Game Elements
const office = document.getElementById('office');
const cameraOverlay = document.getElementById('cameraOverlay');
const cameraFeed = document.getElementById('cameraFeed');
const cameraAnimation = document.getElementById('cameraAnimation');
const cameraContainer = document.getElementById('cameraContainer');
const timeImg = document.getElementById('timeImg');
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
let cameraPan = -25;
let isCameraUp = false;
let selectedCamera = null;
let currentNight = 1;

// Audio Manager
const audioSources = {
    static: 'audio/garble1.wav',
    powerdown: 'audio/powerdown.wav',
    jumpscare: 'audio/XSCREAM.wav',
    doorClick: 'audio/SFXBible_12478.wav',
    lightClick: 'audio/knock2.wav',
    ambience: 'audio/EerieAmbienceLargeSca_MV005.wav'
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

    if (name === 'ambience') {
        sound.loop = true;
        sound.volume = 0.3;
    }

    return sound;
}

function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    playSound('ambience');
}

function playSound(name) {
    const sound = ensureAudio(name);
    if (!sound || typeof sound.play !== 'function') return;

    try {
        sound.currentTime = 0;
        sound.volume = name === 'ambience' ? 0.3 : 0.5;
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

function updateOfficeTexture(state) {
    if (!state || !state.animatronics) return;

    const a = state.animatronics;

    if (state.power <= 0) {
        office.style.backgroundImage = "url('textures/office/power out.png')";
    } else if (state.lights.left) {
        office.style.backgroundImage = "url('textures/office/left light open.png')";
    } else if (state.lights.right) {
        office.style.backgroundImage = "url('textures/office/right light open.png')";
    } else if (a.bonnie.location === 'leftHall' || a.bonnie.location === 'office') {
        office.style.backgroundImage = "url('textures/office/bonnie visible.png')";
    } else if (a.chica.location === 'rightHall' || a.chica.location === 'office') {
        office.style.backgroundImage = "url('textures/office/chica visible.png')";
    } else if (a.freddy.location === 'hall') {
        office.style.backgroundImage = "url('textures/office/freddy music box.png')";
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

function updateCameraTexture(state) {
    if (!state || !state.cameraUp) {
        cameraFeed.style.display = 'none';
        return;
    }

    cameraFeed.style.display = 'block';
    applyCameraBackground();

    const feedMap = {
        '1A': 'textures/camera/office cam/132.png',
        '1B': 'textures/camera/office cam/133.png',
        '1C': 'textures/camera/office cam/136.png',
        '2A': 'textures/camera/office cam/137.png',
        '2B': 'textures/camera/office cam/138.png',
        '3': 'textures/camera/office cam/139.png',
        '4A': 'textures/camera/office cam/140.png',
        '4B': 'textures/camera/office cam/141.png',
        '5': 'textures/camera/office cam/142.png',
        '6': 'textures/camera/office cam/144.png',
        '7': 'textures/camera/office cam/46.png'
    };

    const a = state.animatronics;
    if (selectedCamera && feedMap[selectedCamera]) {
        cameraFeed.src = feedMap[selectedCamera];
    } else if (a.foxy.location === 'cove' || a.foxy.location === 'hall') {
        cameraFeed.src = 'textures/camera/office cam/46.png';
    } else if (a.bonnie.location === 'leftHall') {
        cameraFeed.src = 'textures/camera/office cam/46.png';
    } else if (a.chica.location === 'rightHall') {
        cameraFeed.src = 'textures/camera/office cam/46.png';
    } else {
        cameraFeed.src = 'textures/camera/office cam/46.png';
    }
}

function updateJumpscare(reason) {
    const jumpscare = document.getElementById('jumpscare');
    let src = 'textures/jumpscares/freddy/489.png';

    switch (reason) {
        case 'bonnie':
            src = 'textures/jumpscares/bonnie/1.png';
            break;
        case 'chica':
            src = 'textures/jumpscares/chica/1.png';
            break;
        case 'foxy':
            src = 'textures/jumpscares/foxy/1.png';
            break;
        case 'freddy':
        default:
            src = 'textures/jumpscares/freddy/489.png';
            break;
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

function updateTimeTexture(hour) {
    const timeMap = ['350', '350', '351', '351', '352', '352', '350'];
    const index = Math.min(6, hour);
    timeImg.src = `textures/time/${timeMap[index]}.png`;
}

const cameraAnimFrames = [
    'textures/camera/office cam/46.png',
    'textures/camera/office cam/132.png',
    'textures/camera/office cam/133.png',
    'textures/camera/office cam/136.png',
    'textures/camera/office cam/137.png',
    'textures/camera/office cam/138.png',
    'textures/camera/office cam/139.png',
    'textures/camera/office cam/140.png',
    'textures/camera/office cam/141.png',
    'textures/camera/office cam/142.png',
    'textures/camera/office cam/144.png'
];

function applyCameraBackground() {
    cameraOverlay.style.backgroundImage = "url('textures/camera/0.png')";
    cameraOverlay.style.backgroundSize = 'cover';
    cameraOverlay.style.backgroundPosition = 'center';
}

function selectCamera(cam) {
    selectedCamera = cam;
    onClickBorder.style.display = 'block';

    const camEl = document.querySelector(`.camera-position[data-cam="${cam}"]`);
    if (camEl) {
        const rect = camEl.getBoundingClientRect();
        const parentRect = camEl.parentElement.getBoundingClientRect();
        onClickBorder.style.left = `${rect.left - parentRect.left - 2}px`;
        onClickBorder.style.top = `${rect.top - parentRect.top - 2}px`;
        onClickBorder.style.width = `${rect.width + 4}px`;
        onClickBorder.style.height = `${rect.height + 4}px`;
    }
}

let cameraAnimating = false;
let cameraAnimFrame = 0;
let cameraAnimInterval = null;
let cameraHovered = false;
let cameraCloseTimeout = null;

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
        sendAction('toggleCamera', null);
    }, 20);
}

cameraContainer.addEventListener('mouseenter', () => {
    openCamera();
    sendAction('toggleCamera', null);
});

cameraContainer.addEventListener('mouseleave', () => {
    if (!cameraAnimating) {
        closeCamera();
    }
});

cameraOverlay.addEventListener('mouseenter', () => {
    if (cameraCloseTimeout) {
        clearTimeout(cameraCloseTimeout);
        cameraCloseTimeout = null;
    }
});

cameraOverlay.addEventListener('mouseleave', () => {
    closeCamera();
});

document.querySelectorAll('.camera-position').forEach(pos => {
    pos.addEventListener('click', () => {
        const cam = pos.dataset.cam;
        selectCamera(cam);
        playSound('static');
    });
});

function onServerState(state) {
    const timeDisplay = document.getElementById('timeDisplay');
    const powerDisplay = document.getElementById('powerDisplay');
    const usageDisplay = document.getElementById('usageDisplay');

    if (!state) return;

    if (timeDisplay) timeDisplay.textContent = (state.hour === 0 ? 12 : state.hour) + ' AM';
    if (powerDisplay) powerDisplay.textContent = state.power + '%';
    if (usageDisplay) usageDisplay.textContent = state.usage;

    const leftDoor = document.getElementById('leftDoor');
    const rightDoor = document.getElementById('rightDoor');

    leftDoor.style.transform = state.doors.left ? 'translateY(0%)' : 'translateY(-100%)';
    rightDoor.style.transform = state.doors.right ? 'translateY(0%)' : 'translateY(-100%)';

    updateDoorTexture(leftDoor, 'left', state.doors.left);
    updateDoorTexture(rightDoor, 'right', state.doors.right);

    updateButtonState('left', state.doors.left, state.lights.left);
    updateButtonState('right', state.doors.right, state.lights.right);

    isCameraUp = state.cameraUp;

    updateCameraTexture(state);
    updateOfficeTexture(state);
    updatePowerUsage(state.usage);
    updateTimeTexture(state.hour);

    if (state.power <= 0) {
        office.style.backgroundImage = "url('textures/office/power out.png')";
    }
}

function frame() {
    if (!isCameraUp) {
        if (mouseX < 0.25) {
            cameraPan += 2;
        } else if (mouseX > 0.75) {
            cameraPan -= 2;
        }

        cameraPan = Math.max(-50, Math.min(cameraPan, 0));
        office.style.left = cameraPan + "%";
    }

    requestAnimationFrame(frame);
}

function triggerPowerOutage() {
    office.style.backgroundImage = "url('textures/office/power out.png')";
    audio.ambience.pause();
    playSound('powerdown');
}

function triggerJumpscare(reason) {
    updateJumpscare(reason);
    playSound('jumpscare');
}

function showMainMenu() {
    mainMenu.style.display = 'flex';
    office.style.display = 'none';
    document.getElementById('leftButtons').style.display = 'none';
    document.getElementById('rightButtons').style.display = 'none';
    document.getElementById('cameraContainer').style.display = 'none';
    document.getElementById('powerUsage').style.display = 'none';
    document.getElementById('timeDisplayContainer').style.display = 'none';
}

function hideMainMenu() {
    mainMenu.style.display = 'none';
    office.style.display = 'block';
    document.getElementById('leftButtons').style.display = 'block';
    document.getElementById('rightButtons').style.display = 'block';
    document.getElementById('cameraContainer').style.display = 'block';
    document.getElementById('powerUsage').style.display = 'block';
    document.getElementById('timeDisplayContainer').style.display = 'block';
}

function startGame(night) {
    currentNight = night;
    hideMainMenu();
    joinGame('default', night);
}

// Main menu button handlers
document.getElementById('btnNewGame').addEventListener('click', () => startGame(1));
document.getElementById('btnNight1').addEventListener('click', () => startGame(1));
document.getElementById('btnNight2').addEventListener('click', () => startGame(2));
document.getElementById('btnNight3').addEventListener('click', () => startGame(3));
document.getElementById('btnNight4').addEventListener('click', () => startGame(4));
document.getElementById('btnNight5').addEventListener('click', () => startGame(5));
document.getElementById('btnNight6').addEventListener('click', () => startGame(6));
document.getElementById('btnNight7').addEventListener('click', () => startGame(7));
document.getElementById('btnCustomNight').addEventListener('click', () => startGame(1));

// Show main menu on load
window.addEventListener('load', () => {
    showMainMenu();
});

requestAnimationFrame(frame);
