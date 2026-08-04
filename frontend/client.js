// client.js - Connect frontend to FNAF Backend

const socket = io();

let gameActive = false;
let lightState = { left: false, right: false };
let jammedState = { left: false, right: false };

socket.on('connect', () => {
  console.log('Connected to FNAF Backend');
});

socket.on('stateUpdate', (state) => {
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
  gameActive = false;
  if (data.result === 'win') {
    if (typeof stopPowerOutageSequence === 'function') {
      stopPowerOutageSequence();
    }
    alert('6 AM - You Win!');
    if (typeof returnToMainMenu === 'function') {
      returnToMainMenu(true);
    }
  } else if (data.result === 'powerOut') {
    if (typeof triggerPowerOutage === 'function') {
      triggerPowerOutage();
    } else if (typeof returnToMainMenu === 'function') {
      returnToMainMenu(false);
    }
  }
});

socket.on('gameOver', (data) => {
  gameActive = false;
  if (typeof triggerJumpscare === 'function') {
    triggerJumpscare(data.reason);
  }
});

function sendAction(type, side, value) {
  if (!gameActive) return;
  socket.emit('playerAction', { type, side, value });
}

function handleButtonClick(e, side) {
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

function joinGame(roomId, night = 1, customAI = null) {
  gameActive = false;
  socket.emit('joinGame', { roomId, night, customAI });
}

window.addEventListener('load', () => {
  // joinGame is called from script.js main menu
});
