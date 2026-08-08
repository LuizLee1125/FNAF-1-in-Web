// client.js - Connect frontend to FNAF Backend

const socket = io();

let gameActive = false;
let runEnded = false;
let lightState = { left: false, right: false };
let jammedState = { left: false, right: false };

socket.on('connect', () => {
  console.log('Connected to FNAF Backend');
});

// Called on jumpscare to notify server and end run.
function endRun() {
  if (runEnded) return;
  runEnded = true;
  gameActive = false;
  if (socket.connected) socket.emit('playerDied');
}

socket.on('stateUpdate', (state) => {
  if (runEnded) return;
  gameActive = true;
  if (state) {
    if (state.lights) {
      const prevLightOn = lightState.left || lightState.right;
      lightState.left = state.lights.left;
      lightState.right = state.lights.right;
      const currentLightOn = lightState.left || lightState.right;
      if (prevLightOn && !currentLightOn) {
        if (typeof stopSound === 'function') {
          stopSound('lightClick');
        }
      }
    }
    if (state.jammed) {
      jammedState.left = state.jammed.left;
      jammedState.right = state.jammed.right;
    }
  }
  if (typeof onServerState === 'function') {
    onServerState(state);
  }
});

socket.on('actionError', (data) => {
  if (data && data.sound && typeof playSound === 'function') {
    playSound(data.sound);
  }
});

socket.on('gameEnd', (data) => {
  if (runEnded) return;
  gameActive = false;
  if (data.result === 'win') {
    runEnded = true;
    if (typeof stopPowerOutageSequence === 'function') {
      stopPowerOutageSequence();
    }
    if (typeof triggerWinSequence === 'function') {
      triggerWinSequence();
    } else if (typeof returnToMainMenu === 'function') {
      returnToMainMenu();
    }
  } else if (data.result === 'powerOut') {
    if (typeof triggerPowerOutage === 'function') {
      triggerPowerOutage();
    } else if (typeof returnToMainMenu === 'function') {
      returnToMainMenu();
    }
  }
});

socket.on('gameOver', (data) => {
  if (runEnded) return;
  endRun();
  if (data.reason === 'goldenFreddy' && typeof triggerGoldenFreddyJumpscare === 'function') {
    triggerGoldenFreddyJumpscare();
  } else if (typeof triggerJumpscare === 'function') {
    triggerJumpscare(data.reason);
  }
});

socket.on('goldenFreddyAppear', () => {
  if (runEnded) return;
  if (typeof showGoldenFreddy === 'function') showGoldenFreddy();
});

socket.on('goldenFreddyVanish', () => {
  if (typeof hideGoldenFreddy === 'function') hideGoldenFreddy();
});

socket.on('foxySprint', () => {
  if (typeof triggerFoxyRun === 'function') {
    triggerFoxyRun();
  } else if (typeof playSound === 'function') {
    playSound('run');
  }
});

socket.on('foxyKnock', (data) => {
  if (typeof playSound === 'function') {
    playSound('knock2');
  }
});

function sendAction(type, side, value) {
  if (!gameActive) return;
  socket.emit('playerAction', { type, side, value });
}

function handleButtonClick(e, side) {
  if (typeof isCameraUp !== 'undefined' && isCameraUp) return;

  const btn = e.currentTarget;
  const rect = btn.getBoundingClientRect();
  const clickY = e.clientY - rect.top;
  const halfHeight = rect.height / 2;

  if (jammedState[side]) {
    if (typeof playSound === 'function') {
      playSound('error');
    }
    sendAction(clickY < halfHeight ? 'toggleDoor' : 'toggleLight', side);
    return;
  }

  // Top half = door, bottom half = light
  if (clickY < halfHeight) {
    sendAction('toggleDoor', side);
    playSound('doorClick');
  } else {
    const isAnyLightOn = lightState.left || lightState.right;
    sendAction('toggleLight', side);
    if (!lightState[side]) {
      if (typeof playSound === 'function') playSound('lightClick');
    } else {
      if (typeof stopSound === 'function') stopSound('lightClick');
    }
  }
}

const leftButton = document.getElementById('toggleLeft');
const rightButton = document.getElementById('toggleRight');

function bindButton(button, side) {
  if (!button) return;
  const handler = (e) => {
    e.preventDefault();
    handleButtonClick(e, side);
  };
  button.addEventListener('mousedown', handler);
  button.addEventListener('pointerdown', handler);
}

bindButton(leftButton, 'left');
bindButton(rightButton, 'right');

// Emit joinGame payload with room settings and active cheats.
function joinGame(roomId, night = 1, customAI = null, cheats = []) {
  gameActive = false;
  runEnded = false;
  socket.emit('joinGame', { roomId, night, customAI, cheats });
}
