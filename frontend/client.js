// client.js - Connect frontend to FNAF Backend

const socket = io();

let gameActive = false;

socket.on('connect', () => {
  console.log('Connected to FNAF Backend');
});

socket.on('stateUpdate', (state) => {
  gameActive = true;
  if (typeof onServerState === 'function') {
    onServerState(state);
  }
});

socket.on('gameEnd', (data) => {
  gameActive = false;
  if (data.result === 'win') {
    alert('6 AM - You Win!');
  } else if (data.result === 'powerOut') {
    alert('Power Outage!');
  }
});

socket.on('gameOver', (data) => {
  gameActive = false;
  if (typeof triggerJumpscare === 'function') {
    triggerJumpscare(data.reason);
  }
});

function sendAction(type, side) {
  if (!gameActive) return;
  socket.emit('playerAction', { type, side });
}

function handleButtonClick(e, side) {
  const btn = e.currentTarget;
  const rect = btn.getBoundingClientRect();
  const clickY = e.clientY - rect.top;
  const halfHeight = rect.height / 2;

  if (clickY < halfHeight) {
    sendAction('toggleDoor', side);
    playSound('doorClick');
  } else {
    sendAction('toggleLight', side);
    playSound('lightClick');
  }
}

document.getElementById('toggleLeft').addEventListener('mousedown', (e) => {
  e.preventDefault();
  handleButtonClick(e, 'left');
});

document.getElementById('toggleRight').addEventListener('mousedown', (e) => {
  e.preventDefault();
  handleButtonClick(e, 'right');
});

function joinGame(roomId, night = 1) {
  socket.emit('joinGame', { roomId, night });
}

window.addEventListener('load', () => {
  joinGame('default', 1);
});
