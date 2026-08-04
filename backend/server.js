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

const TICK_MS = 100;
const HOUR_TICKS = 60;
const TOTAL_HOURS = 6;
const POWER_DRAIN_BASE = 0.09;

const MOVEMENT_CONFIG = {
  freddy: { intervalMs: 10000, cameraStall: true },
  bonnie: { intervalMs: 9970, cameraStall: false },
  chica: { intervalMs: 9980, cameraStall: false },
  foxy: { intervalMs: 6010, cameraStall: true }
};

// FNAF 1 Accurate Room Graph
const MOVEMENT_GRAPH = {
  freddy: {
    '1A': ['1B'],
    '1B': ['7'],
    '7': ['6'],
    '6': ['4A'],
    '4A': ['4B'],
    '4B': ['office_door_right']
  },
  bonnie: {
    '1A': ['1B', '5'],
    '1B': ['5', '2A'],
    '5': ['1B', '2A'],
    '2A': ['3', '2B'],
    '3': ['2A', '2B'],
    '2B': ['office_door_left'],
    'office_door_left': ['1B', '1A']
  },
  chica: {
    '1A': ['1B', '7'],
    '1B': ['7', '4A'],
    '7': ['4A', '6'],
    '6': ['4A'],
    '4A': ['4B'],
    '4B': ['office_door_right'],
    'office_door_right': ['1B', '1A']
  }
};

const AI_SCHEDULES = {
  1: [
    { hour: 0, freddy: 0, bonnie: 0, chica: 0, foxy: 0 },
    { hour: 2, freddy: 0, bonnie: 1, chica: 0, foxy: 0 },
    { hour: 3, freddy: 0, bonnie: 2, chica: 1, foxy: 1 },
    { hour: 4, freddy: 0, bonnie: 3, chica: 2, foxy: 2 }
  ],
  2: [
    { hour: 0, freddy: 0, bonnie: 3, chica: 1, foxy: 1 },
    { hour: 3, freddy: 0, bonnie: 4, chica: 2, foxy: 2 },
    { hour: 4, freddy: 0, bonnie: 5, chica: 3, foxy: 3 }
  ],
  3: [
    { hour: 0, freddy: 1, bonnie: 0, chica: 5, foxy: 2 },
    { hour: 2, freddy: 1, bonnie: 1, chica: 5, foxy: 2 },
    { hour: 3, freddy: 1, bonnie: 2, chica: 6, foxy: 3 },
    { hour: 4, freddy: 1, bonnie: 3, chica: 7, foxy: 4 }
  ],
  4: [
    { hour: 0, freddy: 1, bonnie: 2, chica: 4, foxy: 6 },
    { hour: 2, freddy: 1, bonnie: 3, chica: 4, foxy: 6 },
    { hour: 3, freddy: 1, bonnie: 4, chica: 5, foxy: 7 },
    { hour: 4, freddy: 1, bonnie: 5, chica: 6, foxy: 8 }
  ],
  5: [
    { hour: 0, freddy: 3, bonnie: 5, chica: 7, foxy: 5 },
    { hour: 2, freddy: 3, bonnie: 6, chica: 7, foxy: 5 },
    { hour: 3, freddy: 3, bonnie: 7, chica: 8, foxy: 6 },
    { hour: 4, freddy: 3, bonnie: 8, chica: 9, foxy: 7 }
  ],
  6: [
    { hour: 0, freddy: 4, bonnie: 10, chica: 12, foxy: 16 },
    { hour: 2, freddy: 4, bonnie: 11, chica: 12, foxy: 16 },
    { hour: 3, freddy: 4, bonnie: 12, chica: 13, foxy: 17 },
    { hour: 4, freddy: 4, bonnie: 13, chica: 14, foxy: 18 }
  ]
};

const rooms = new Map();
const roomIntervals = new Map();

function getFoxyKnockDrain(knockCount) {
  if (knockCount <= 1) return 1;
  if (knockCount === 2) return 6;
  if (knockCount === 3) return 11;
  if (knockCount === 4) return 16;
  return 21; // 5th or more knock
}

function createRoom(roomId, night, customAI) {
  const initialAI = customAI || getAIForHour({ night: night || 1 }, 0);
  const now = Date.now();
  return {
    id: roomId,
    night: night || 1,
    customAI: customAI || null,
    state: 'waiting',
    hour: 0,
    hourTimerMs: 0,
    broadcastTimerMs: 0,
    lastTickTime: now,
    power: 100.0,
    usage: 1,
    players: [],
    doors: { left: false, right: false },
    lights: { left: false, right: false },
    jammed: { left: false, right: false },
    cameraUp: false,
    selectedCamera: '1A',
    animatronics: {
      freddy: { location: '1A', ai: initialAI.freddy, movementTimerMs: 0, inOffice: false },
      bonnie: { location: '1A', ai: initialAI.bonnie, movementTimerMs: 0, inOffice: false, readyToJumpscare: false },
      chica: { location: '1A', ai: initialAI.chica, movementTimerMs: 0, inOffice: false, readyToJumpscare: false },
      foxy: { location: '1C', ai: initialAI.foxy, movementTimerMs: 0, foxyStage: 0, stallTimerMs: 0, sprintTimerMs: 0, sprinting: false, sprintWindowMs: 0, knockCount: 0 }
    }
  };
}

function getAIForHour(room, hour) {
  if (room.customAI) {
    return { ...room.customAI };
  }
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
  if (room.power <= 0) return;
  const state = room.animatronics[name];
  const config = MOVEMENT_CONFIG[name];

  if (state.ai <= 0) return;

  // Animatronics already in office stay in office
  if (state.location === 'office' || state.inOffice) return;

  // Foxy camera stall check
  if (name === 'foxy' && (room.cameraUp || state.stallTimerMs > 0)) {
    return;
  }

  // Freddy camera stall check
  if (name === 'freddy' && room.cameraUp) {
    return;
  }

  const roll = Math.floor(Math.random() * 20) + 1;
  if (roll > state.ai) return;

  // Freddy won't leave 1A until Bonnie and Chica leave 1A
  if (name === 'freddy' && state.location === '1A') {
    if (room.animatronics.bonnie.location === '1A' || room.animatronics.chica.location === '1A') {
      return;
    }
  }

  // Foxy stage mechanics: Stage 0 (Cove closed) -> Stage 1 (Peeking) -> Stage 2 (Outside) -> Stage 3 (Empty cove)
  if (name === 'foxy') {
    if (state.foxyStage < 3) {
      state.foxyStage++;
      if (state.foxyStage === 3) {
        state.location = '1C'; // Empty cove
        state.sprintTimerMs = 30000; // 30 seconds wait timer
        state.sprinting = false;
        state.sprintWindowMs = 0;
      }
    }
    return;
  }

  // Freddy at 4B corner
  if (name === 'freddy' && state.location === '4B') {
    if (room.doors.right) {
      state.location = '4A'; // Retreat if right door is closed
    } else if (room.selectedCamera === '4B') {
      // Condition 3: Player looking at camera 4B or 4B was selected -> Freddy cannot enter office
      return;
    } else {
      // Enter office!
      state.location = 'office';
      state.inOffice = true;
    }
    return;
  }

  // Bonnie at Left Door
  if (name === 'bonnie' && state.location === 'office_door_left') {
    if (!room.doors.left) {
      // Enter office & jam left buttons and turn off left light
      state.location = 'office';
      state.inOffice = true;
      state.readyToJumpscare = room.cameraUp;
      room.jammed.left = true;
      room.lights.left = false;
    } else {
      state.location = '1B'; // Retreat to Dining Area if blocked
    }
    return;
  }

  // Chica at Right Door
  if (name === 'chica' && state.location === 'office_door_right') {
    if (!room.doors.right) {
      // Enter office & jam right buttons and turn off right light
      state.location = 'office';
      state.inOffice = true;
      state.readyToJumpscare = room.cameraUp;
      room.jammed.right = true;
      room.lights.right = false;
    } else {
      state.location = '1B'; // Retreat to Dining Area if blocked
    }
    return;
  }

  // Graph traversal
  const paths = MOVEMENT_GRAPH[name];
  if (paths && paths[state.location]) {
    const possibleMoves = paths[state.location];
    state.location = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
  }
}

function getRoomStatePayload(room) {
  return {
    hour: room.hour,
    power: Math.floor(room.power),
    usage: room.usage,
    animatronics: room.animatronics,
    doors: room.doors,
    lights: room.lights,
    jammed: room.jammed || { left: false, right: false },
    cameraUp: room.cameraUp
  };
}

function gameTick(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.state !== 'playing') return;

  const now = Date.now();
  const deltaMs = room.lastTickTime ? Math.min(1000, now - room.lastTickTime) : 100;
  room.lastTickTime = now;

  // Hour tracking (60 seconds per hour)
  room.hourTimerMs += deltaMs;
  if (room.hourTimerMs >= 60000) {
    room.hourTimerMs -= 60000;
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

  // Foxy camera stall & Stage 4 timer handling
  const foxy = room.animatronics.foxy;
  if (room.cameraUp) {
    if (foxy.stallTimerMs <= 0) {
      foxy.stallTimerMs = Math.floor((Math.random() * 14 + 3) * 1000); // 3-17s random stall
    }
  }

  if (foxy.foxyStage === 3) {
    if (foxy.sprinting) {
      if (foxy.sprintWindowMs > 0) {
        foxy.sprintWindowMs -= deltaMs;
        if (foxy.sprintWindowMs <= 0) {
          if (!room.doors.left) {
            room.state = 'gameover';
            io.to(roomId).emit('gameOver', { reason: 'foxy' });
          } else {
            foxy.knockCount++;
            const knockDrain = getFoxyKnockDrain(foxy.knockCount);
            room.power = Math.max(0, room.power - knockDrain);
            foxy.foxyStage = 0;
            foxy.sprinting = false;
            foxy.sprintTimerMs = 0;
            foxy.sprintWindowMs = 0;
            io.to(roomId).emit('foxyKnock', { knockCount: foxy.knockCount, powerDrained: knockDrain });
            io.to(roomId).emit('stateUpdate', getRoomStatePayload(room));
          }
        }
      }
    } else if (foxy.sprintTimerMs > 0) {
      foxy.sprintTimerMs -= deltaMs;
      if (foxy.sprintTimerMs <= 0) {
        if (room.cameraUp) {
          room.cameraUp = false;
        }
        if (!room.doors.left) {
          room.state = 'gameover';
          io.to(roomId).emit('gameOver', { reason: 'foxy' });
        } else {
          foxy.knockCount++;
          const knockDrain = getFoxyKnockDrain(foxy.knockCount);
          room.power = Math.max(0, room.power - knockDrain);
          foxy.foxyStage = 0;
          foxy.sprinting = false;
          foxy.sprintTimerMs = 0;
          foxy.sprintWindowMs = 0;
          io.to(roomId).emit('foxyKnock', { knockCount: foxy.knockCount, powerDrained: knockDrain });
          io.to(roomId).emit('stateUpdate', getRoomStatePayload(room));
        }
      }
    }
  }

  // Animatronics movement timers
  for (const [name, config] of Object.entries(MOVEMENT_CONFIG)) {
    const anim = room.animatronics[name];

    if (name === 'foxy' && (anim.stallTimerMs > 0 || anim.foxyStage === 3)) {
      if (anim.stallTimerMs > 0) {
        anim.stallTimerMs = Math.max(0, anim.stallTimerMs - deltaMs);
      }
      anim.movementTimerMs = 0;
      continue;
    }

    anim.movementTimerMs += deltaMs;
    if (anim.movementTimerMs >= config.intervalMs) {
      anim.movementTimerMs -= config.intervalMs;
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

  if (room.power > 0) {
    room.power = Math.max(0, room.power - (POWER_DRAIN_BASE * (deltaMs / 1000) * usage));
    if (room.power <= 0) {
      room.doors.left = false;
      room.doors.right = false;
      room.lights.left = false;
      room.lights.right = false;
      room.cameraUp = false;
      room.usage = 1;
      if (!room.powerOutTriggered) {
        room.powerOutTriggered = true;
        io.to(roomId).emit('gameEnd', { result: 'powerOut' });
      }
    }
  }

  room.broadcastTimerMs += deltaMs;
  if (room.broadcastTimerMs >= 1000) {
    room.broadcastTimerMs = 0;
    io.to(roomId).emit('stateUpdate', getRoomStatePayload(room));
  }
}

function startRoomLoop(roomId) {
  if (roomIntervals.has(roomId)) return;
  const room = rooms.get(roomId);
  if (room) room.lastTickTime = Date.now();
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
    const { roomId, night = 1, customAI = null } = data;
    let room = rooms.get(roomId);

    if (!room || room.state === 'gameover' || room.state === 'won') {
      room = createRoom(roomId, night, customAI);
      rooms.set(roomId, room);
    }

    if (!room.players.includes(socket.id)) {
      room.players.push(socket.id);
    }
    socket.roomId = roomId;
    socket.join(roomId);

    socket.emit('stateUpdate', getRoomStatePayload(room));

    if (room.players.length === 1 && room.state !== 'playing') {
      room.state = 'playing';
      startRoomLoop(roomId);
    } else if (room.state === 'playing' && !roomIntervals.has(roomId)) {
      startRoomLoop(roomId);
    }
  });

  function checkFoxySprintTrigger(room) {
    const foxy = room.animatronics.foxy;
    if (foxy && foxy.foxyStage === 3 && !foxy.sprinting && room.cameraUp && room.selectedCamera === '2A') {
      foxy.sprinting = true;
      foxy.sprintWindowMs = 4000; // 1s sprint + 3s door close window
      io.to(room.id).emit('foxySprint');
    }
  }

  socket.on('playerAction', (action) => {
    const room = rooms.get(socket.roomId);
    if (!room || room.state !== 'playing' || room.power <= 0) return;

    // Freddy office jumpscare condition 5.1 & 5.2:
    if (room.animatronics.freddy.inOffice) {
      if (['toggleDoor', 'toggleLight', 'toggleCamera', 'setCamera', 'selectCamera'].includes(action.type)) {
        room.state = 'gameover';
        io.to(socket.roomId).emit('gameOver', { reason: 'freddy' });
        return;
      }
    }

    if (action.type === 'selectCamera') {
      room.selectedCamera = action.value || '1A';
      checkFoxySprintTrigger(room);
      io.to(socket.roomId).emit('stateUpdate', getRoomStatePayload(room));
      return;
    }

    if (action.type === 'toggleDoor') {
      if (room.jammed?.[action.side]) {
        socket.emit('actionError', { side: action.side, sound: 'error', reason: 'jammed' });
        return;
      }
      room.doors[action.side] = !room.doors[action.side];
    } else if (action.type === 'toggleLight') {
      if (room.jammed?.[action.side]) {
        socket.emit('actionError', { side: action.side, sound: 'error', reason: 'jammed' });
        return;
      }
      const nextLightState = !room.lights[action.side];
      room.lights[action.side] = nextLightState;
      if (nextLightState) {
        const otherSide = action.side === 'left' ? 'right' : 'left';
        room.lights[otherSide] = false;
      }
    } else if (action.type === 'toggleCamera' || action.type === 'setCamera') {
      const prevCameraUp = room.cameraUp;
      let newCameraUp = prevCameraUp;
      if (action.type === 'toggleCamera') {
        newCameraUp = !prevCameraUp;
      } else if (action.type === 'setCamera') {
        newCameraUp = !!action.value;
      }

      // Bonnie & Chica jumpscare condition 4
      for (const name of ['bonnie', 'chica']) {
        const anim = room.animatronics[name];
        if (anim.inOffice) {
          if (newCameraUp) {
            anim.readyToJumpscare = true;
          } else if (!newCameraUp && anim.readyToJumpscare) {
            room.cameraUp = false;
            room.state = 'gameover';
            io.to(socket.roomId).emit('gameOver', { reason: name });
            return;
          }
        }
      }

      room.cameraUp = newCameraUp;
      if (room.cameraUp && room.animatronics.foxy.stallTimerMs <= 0) {
        room.animatronics.foxy.stallTimerMs = Math.floor((Math.random() * 14 + 3) * 1000);
      }
      checkFoxySprintTrigger(room);
    }

    let usage = 1;
    if (room.doors.left) usage++;
    if (room.doors.right) usage++;
    if (room.lights.left) usage++;
    if (room.lights.right) usage++;
    if (room.cameraUp) usage++;
    room.usage = usage;

    io.to(socket.roomId).emit('stateUpdate', getRoomStatePayload(room));
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