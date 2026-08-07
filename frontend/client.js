// client.js - Connect frontend to FNAF Backend

const socket = io();

let gameActive = false;
// Sticky for the whole run, unlike gameActive which stateUpdate keeps flipping
// back on. Without it the room kept ticking after a death and the 6 AM win
// arrived minutes later — on the main menu.
let runEnded = false;
let lightState = { left: false, right: false };
let jammedState = { left: false, right: false };

socket.on('connect', () => {
  console.log('Connected to FNAF Backend');
});

// Called by script.js the moment the player is jumpscared, including the
// power-outage scare, which the server has no way of knowing about.
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
    // triggerWinSequence hands off to finishNight, which either rolls straight
    // into the next night or stops on the end card — so no callback here.
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
  // Golden Freddy has his own scare: one frame, XSCREAM2, then the menu — none
  // of the static / Game Over tail the others run through.
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

// `cheats` is the enabled-id list from cheats.js. The server freezes it onto the
// room, so a run keeps whatever was set when it started.
function joinGame(roomId, night = 1, customAI = null, cheats = []) {
  gameActive = false;
  runEnded = false;
  socket.emit('joinGame', { roomId, night, customAI, cheats });
}

window.addEventListener('load', () => {
  // joinGame is called from script.js main menu
});
