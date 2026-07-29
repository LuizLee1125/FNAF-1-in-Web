const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, '../frontend')));

const TICK_MS = 1000;
const HOUR_TICKS = 60;
const TOTAL_HOURS = 6;
const POWER_DRAIN_BASE = 0.5;

const MOVEMENT_CONFIG = {
  freddy: { threshold: 3, cameraStall: true },
  bonnie: { threshold: 5, cameraStall: false },
  chica: { threshold: 5, cameraStall: false },
  foxy: { threshold: 5, cameraStall: true }
};

const AI_SCHEDULES = {
  1: [
    { hour: 0, freddy: 0, bonnie: 0, chica: 0, foxy: 0 },
    { hour: 1, freddy: 0, bonnie: 0, chica: 0, foxy: 0 },
    { hour: 2, freddy: 0, bonnie: 1, chica: 0, foxy: 0 },
    { hour: 3, freddy: 0, bonnie: 2, chica: 1, foxy: 1 },
    { hour: 4, freddy: 0, bonnie: 3, chica: 2, foxy: 2 }
  ],
  6: [
    { hour: 0, freddy: 0, bonnie: 0, chica: 0, foxy: 0 },
    { hour: 1, freddy: 0, bonnie: 0, chica: 0, foxy: 0 },
    { hour: 2, freddy: 1, bonnie: 4, chica: 4, foxy: 2 },
    { hour: 3, freddy: 2, bonnie: 7, chica: 7, foxy: 4 },
    { hour: 4, freddy: 4, bonnie: 13, chica: 14, foxy: 8 }
  ]
};

const rooms = new Map();
const roomIntervals = new Map();

function createRoom(roomId, night) {
  return {
    id: roomId,
    night: night || 1,
    state: 'waiting',
    hour: 0,
    tickCounter: 0,
    power: 100.0,
    usage: 1,
    players: [],
    doors: { left: false, right: false },
    lights: { left: false, right: false },
    cameraUp: false,
    animatronics: {
      freddy: { location: 'stage', ai: 0, movementTimer: 0 },
      bonnie: { location: 'stage', ai: 0, movementTimer: 0 },
      chica: { location: 'stage', ai: 0, movementTimer: 0 },
      foxy: { location: 'cove', ai: 0, movementTimer: 0, foxyStage: 0 }
    }
  };
}

function getAIForHour(room, hour) {
  const schedule = AI_SCHEDULES[room.night] || AI_SCHEDULES[1];
  let result = { freddy: 0, bonnie: 0, chica: 0, foxy: 0 };
  for (const entry of schedule) {
    if (entry.hour <= hour) {
      result = { freddy: entry.freddy, bonnie: entry.bonnie, chica: entry.chica, foxy: entry.foxy };
    }
  }
  return result;
}

function attemptMove(room, name) {
  const state = room.animatronics[name];
  const config = MOVEMENT_CONFIG[name];

  if (config.cameraStall && room.cameraUp) return;

  const roll = Math.floor(Math.random() * 20) + 1;
  if (roll > state.ai) return;

  switch (name) {
    case 'freddy':
      if (state.location === 'stage') state.location = 'showStage';
      else if (state.location === 'showStage') state.location = 'dining';
      else if (state.location === 'dining') state.location = 'hall';
      else if (state.location === 'hall') {
        if (!room.doors.right) {
          room.state = 'gameover';
          io.to(room.id).emit('gameOver', { reason: 'freddy' });
        }
      }
      break;
    case 'bonnie':
      if (state.location === 'stage') state.location = 'showStage';
      else if (state.location === 'showStage') state.location = 'dining';
      else if (state.location === 'dining') state.location = 'leftHall';
      else if (state.location === 'leftHall') {
        if (!room.doors.left) {
          room.state = 'gameover';
          io.to(room.id).emit('gameOver', { reason: 'bonnie' });
        }
      }
      break;
    case 'chica':
      if (state.location === 'stage') state.location = 'showStage';
      else if (state.location === 'showStage') state.location = 'dining';
      else if (state.location === 'dining') state.location = 'rightHall';
      else if (state.location === 'rightHall') {
        if (!room.doors.right) {
          room.state = 'gameover';
          io.to(room.id).emit('gameOver', { reason: 'chica' });
        }
      }
      break;
    case 'foxy':
      if (state.location === 'cove') {
        state.foxyStage = Math.min(3, state.foxyStage + 1);
      } else if (state.location === 'hall') {
        if (!room.doors.left) {
          room.state = 'gameover';
          io.to(room.id).emit('gameOver', { reason: 'foxy' });
        }
      }
      break;
  }
}

function gameTick(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.state !== 'playing') return;

  room.tickCounter++;

  if (room.tickCounter >= HOUR_TICKS) {
    room.tickCounter = 0;
    room.hour++;

    if (room.hour >= TOTAL_HOURS) {
      room.state = 'won';
      io.to(roomId).emit('gameEnd', { result: 'win' });
      stopRoomLoop(roomId);
      return;
    }

    const newAI = getAIForHour(room, room.hour);
    for (const name of ['freddy', 'bonnie', 'chica', 'foxy']) {
      room.animatronics[name].ai = newAI[name];
    }
  }

  for (const [name, config] of Object.entries(MOVEMENT_CONFIG)) {
    room.animatronics[name].movementTimer += 1;
    if (room.animatronics[name].movementTimer >= config.threshold) {
      room.animatronics[name].movementTimer = 0;
      attemptMove(room, name);
    }
  }

  let usage = 1;
  if (room.doors.left) usage++;
  if (room.doors.right) usage++;
  if (room.lights.left) usage++;
  if (room.lights.right) usage++;
  if (room.cameraUp) usage++;
  room.usage = usage;

  room.power = Math.max(0, room.power - POWER_DRAIN_BASE * usage);
  if (room.power <= 0) {
    room.state = 'gameover';
    io.to(roomId).emit('gameEnd', { result: 'powerOut' });
    stopRoomLoop(roomId);
    return;
  }

  io.to(roomId).emit('stateUpdate', {
    hour: room.hour,
    power: Math.floor(room.power),
    usage: room.usage,
    animatronics: room.animatronics,
    doors: room.doors,
    lights: room.lights,
    cameraUp: room.cameraUp
  });
}

function startRoomLoop(roomId) {
  if (roomIntervals.has(roomId)) return;
  const interval = setInterval(() => gameTick(roomId), TICK_MS);
  roomIntervals.set(roomId, interval);
}

function stopRoomLoop(roomId) {
  const interval = roomIntervals.get(roomId);
  if (interval) {
    clearInterval(interval);
    roomIntervals.delete(roomId);
  }
}

io.on('connection', (socket) => {
  socket.on('joinGame', (data) => {
    const { roomId, night = 1 } = data;
    let room = rooms.get(roomId);
    if (!room) {
      room = createRoom(roomId, night);
      rooms.set(roomId, room);
    }
    room.players.push(socket.id);
    socket.join(roomId);
    socket.roomId = roomId;

    socket.emit('stateUpdate', {
      hour: room.hour,
      power: Math.floor(room.power),
      usage: room.usage,
      animatronics: room.animatronics,
      doors: room.doors,
      lights: room.lights,
      cameraUp: room.cameraUp
    });

    if (room.state === 'waiting') {
      room.state = 'playing';
      startRoomLoop(roomId);
    } else if (room.state === 'playing' && !roomIntervals.has(roomId)) {
      startRoomLoop(roomId);
    }
  });

  socket.on('playerAction', (action) => {
    const room = rooms.get(socket.roomId);
    if (!room || room.state !== 'playing') return;

    if (action.type === 'toggleDoor') {
      room.doors[action.side] = !room.doors[action.side];
    } else if (action.type === 'toggleLight') {
      room.lights[action.side] = !room.lights[action.side];
    } else if (action.type === 'toggleCamera') {
      room.cameraUp = !room.cameraUp;
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.players = room.players.filter(id => id !== socket.id);
      if (room.players.length === 0) {
        stopRoomLoop(roomId);
        rooms.delete(roomId);
      }
    }
  });
});

server.listen(3000, () => {
  console.log('FNAF Backend running on http://localhost:3000');
});
