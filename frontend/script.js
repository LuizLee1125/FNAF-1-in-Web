// Game Elements
const office = document.getElementById('office');
const cameraSystem = document.getElementById('cameraSystem');
const cameraFeed = document.getElementById('cameraFeed');
const cameraNameLabel = document.getElementById('cameraNameLabel');
const cameraAnimation = document.getElementById('cameraAnimation');
const cameraContainer = document.getElementById('cameraContainer');
const timeImg = document.getElementById('timeImg');
const powerUsageImg = document.getElementById('powerUsageImg');

// UI Elements
const timeDisplay = document.getElementById('timeDisplay');
const powerDisplay = document.getElementById('powerDisplay');
const usageDisplay = document.getElementById('usageDisplay');

// State Variables
let mouseX = 0;
let cameraPan = -25;
let isCameraUp = false;

// Audio Manager
const audio = {
    static: new Audio('audio/static.wav'),
    powerdown: new Audio('audio/powerdown.wav'),
    jumpscare: new Audio('audio/XSCREAM.wav'),
    doorClick: new Audio('audio/SFXBible_12478.wav'),
    lightClick: new Audio('audio/MiniDV_Tape_Eject_1.wav'),
    ambience: new Audio('audio/EerieAmbienceLargeSca_MV005.wav')
};

audio.ambience.loop = true;
audio.ambience.volume = 0.3;

function playSound(name) {
    if (audio[name]) {
        audio[name].currentTime = 0;
        audio[name].volume = 0.5;
        audio[name].play().catch(() => {});
    }
}

// Start ambience
playSound('ambience');

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

function updateCameraTexture(state) {
    if (!state || !state.cameraUp) {
        cameraFeed.style.display = 'none';
        cameraNameLabel.style.display = 'none';
        return;
    }

    cameraFeed.style.display = 'block';
    cameraNameLabel.style.display = 'block';

    const a = state.animatronics;
    if (a.foxy.location === 'cove' || a.foxy.location === 'hall') {
        cameraFeed.src = 'textures/camera/foxy/1.png';
        cameraNameLabel.src = 'textures/camera/camera names/79.png';
    } else if (a.bonnie.location === 'leftHall') {
        cameraFeed.src = 'textures/camera/office cam/46.png';
        cameraNameLabel.src = 'textures/camera/camera names/72.png';
    } else if (a.chica.location === 'rightHall') {
        cameraFeed.src = 'textures/camera/office cam/46.png';
        cameraNameLabel.src = 'textures/camera/camera names/73.png';
    } else {
        cameraFeed.src = 'textures/camera/office cam/46.png';
        cameraNameLabel.src = 'textures/camera/camera names/70.png';
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

// Camera animation frames from textures/camera/office cam
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
    cameraSystem.style.display = 'none';
    playSound('static');

    cameraAnimInterval = setInterval(() => {
        if (cameraAnimFrame < cameraAnimFrames.length) {
            cameraAnimation.src = cameraAnimFrames[cameraAnimFrame];
            cameraAnimFrame++;
        } else {
            clearInterval(cameraAnimInterval);
            cameraAnimInterval = null;
            cameraAnimation.style.display = 'none';
            cameraSystem.style.display = 'flex';
            cameraAnimating = false;
        }
    }, 80);
}

function closeCamera() {
    cameraCloseTimeout = setTimeout(() => {
        if (cameraAnimating) {
            clearInterval(cameraAnimInterval);
            cameraAnimInterval = null;
            cameraAnimating = false;
        }
        cameraSystem.style.display = 'none';
        cameraAnimation.style.display = 'none';
        cameraHovered = false;
        sendAction('toggleCamera', null);
    }, 50);
}

cameraContainer.addEventListener('mouseenter', () => {
    openCamera();
    sendAction('toggleCamera', null);
});

cameraContainer.addEventListener('mouseleave', () => {
    closeCamera();
});

function onServerState(state) {
    document.getElementById('timeDisplay').innerText = (state.hour === 0 ? 12 : state.hour) + ' AM';
    document.getElementById('powerDisplay').innerText = state.power + '%';
    document.getElementById('usageDisplay').innerText = state.usage;

    document.getElementById('leftDoor').style.transform = state.doors.left ? 'translateY(0%)' : 'translateY(-100%)';
    document.getElementById('rightDoor').style.transform = state.doors.right ? 'translateY(0%)' : 'translateY(-100%)';

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

requestAnimationFrame(frame);
