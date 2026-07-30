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
  foxy: { threshold: 5, cameraStall: true } // Foxy is stalled if any camera is up
};

// FNAF 1 Accurate Room Graph
const MOVEMENT_GRAPH = {
  freddy: {
    '1A': ['1B'],
    '1B': ['7'],
    '7': ['6'],
    '6': ['4A'],
    '4A': ['4B'],
    '4B': ['attack']
  },
  bonnie: {
    '1A': ['1B', '5'],
    '1B': ['5', '2A'],
    '5': ['1B', '2A'],
    '2A': ['3', '2B'],
    '3': ['2A', '2B'],
    '2B': ['office_door_left', '2A'],
    'office_door_left': ['attack', '1B'] // 1B if retreated
  },
  chica: {
    '1A': ['1B', '7'],
    '1B': ['7', '4A'],
    '7': ['4A', '6'],
    '6': ['4A'],
    '4A': ['4B'],
    '4B': ['office_door_right', '4A'],
    'office_door_right': ['attack', '1B'] // 1B if retreated
  }
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
      freddy: { location: '1A', ai: 0, movementTimer: 0 },
      bonnie: { location: '1A', ai: 0, movementTimer: 0 },
      chica: { location: '1A', ai: 0, movementTimer: 0 },
      foxy: { location: '1C', ai: 0, movementTimer: 0, foxyStage: 0 }
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

  // Foxy has unique stage mechanics
  if (name === 'foxy') {
    if (state.location === '1C') {
      state.foxyStage++;
      if (state.foxyStage > 3) {
        state.location = '2A'; // Running down the hall
      }
    } else if (state.location === '2A') {
      if (!room.doors.left) {
        room.state = 'gameover';
        io.to(room.id).emit('gameOver', { reason: 'foxy' });
      } else {
        state.location = '1C'; // Retreat and reset
        state.foxyStage = 0;
        room.power = Math.max(0, room.power - 5); // Foxy drains power upon hitting door
      }
    }
    return;
  }

  // Handle direct attacks
  if (name === 'freddy' && state.location === '4B') {
    if (!room.doors.right) {
      room.state = 'gameover'; io.to(room.id).emit('gameOver', { reason: 'freddy' });
    } else {
      state.location = '4A';
    }
    return;
  }
  
  if (name === 'bonnie' && state.location === 'office_door_left') {
    if (!room.doors.left) {
      room.state = 'gameover'; io.to(room.id).emit('gameOver', { reason: 'bonnie' });
    } else {
      state.location = '1B'; // Reset on door hit
    }
    return;
  }
  
  if (name === 'chica' && state.location === 'office_door_right') {
    if (!room.doors.right) {
      room.state = 'gameover'; io.to(room.id).emit('gameOver', { reason: 'chica' });
    } else {
      state.location = '1B'; // Reset on door hit
    }
    return;
  }

  // General movement across the camera graph
  const paths = MOVEMENT_GRAPH[name];
  if (paths && paths[state.location]) {
    const possibleMoves = paths[state.location];
    state.location = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
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

    if (!room || room.state === 'gameover' || room.state === 'won') {
      stopRoomLoop(roomId);
      room = createRoom(roomId, night);
      rooms.set(roomId, room);
    } else {
      if (room.state === 'waiting') {
        room.night = night;
      }
    }

    if (!room.players.includes(socket.id)) {
      room.players.push(socket.id);
    }
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
    } else if (action.type === 'setCamera') {
      room.cameraUp = !!action.value;
    }

    let usage = 1;
    if (room.doors.left) usage++;
    if (room.doors.right) usage++;
    if (room.lights.left) usage++;
    if (room.lights.right) usage++;
    if (room.cameraUp) usage++;
    room.usage = usage;

    io.to(socket.roomId).emit('stateUpdate', {
      hour: room.hour,
      power: Math.floor(room.power),
      usage: room.usage,
      animatronics: room.animatronics,
      doors: room.doors,
      lights: room.lights,
      cameraUp: room.cameraUp
    });
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