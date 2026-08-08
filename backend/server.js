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
const TOTAL_HOURS = 6;

// Night length (80s/hr) and base power drain.
const HOUR_LENGTH_MS = 80000;
const POWER_DRAIN_BASE = 0.104;

// Animatronic movement intervals and camera stall rules.
const MOVEMENT_CONFIG = {
  freddy: { intervalMs: 3020, cameraStall: false },
  bonnie: { intervalMs: 4970, cameraStall: false },
  chica: { intervalMs: 4980, cameraStall: false },
  foxy: { intervalMs: 5010, cameraStall: true }
};

// Golden Freddy rolls while monitor is up.
const GOLDEN_ROLL_INTERVAL_MS = 2000;
const GOLDEN_ROLL_DENOMINATOR = 200;
const GOLDEN_OFFICE_DURATION_MS = 4000;
const GOLDEN_RESPAWN_COOLDOWN_MS = 30000;

// Cheat multipliers and Real Time drain relief.
const REAL_TIME_SCALE = 3600000 / HOUR_LENGTH_MS;
const SPEED_MULTIPLIER = 0.5;
const REAL_TIME_DRAIN_RELIEF = 1.35;

const GOLDEN_CHEAT_AI = 50;
const GOLDEN_CHEAT_DENOMINATOR = 1000;
const GOLDEN_CHEAT_ROLL_INTERVAL_MS = 500;
const GOLDEN_CHEAT_COOLDOWN_MS = 5000;

// Foxy sprint reaction window (3s) and idle wait (30s).
const FOXY_SPRINT_WINDOW_MS = 3000;
const FOXY_SPRINT_WAIT_MS = 30000;

// Distance from office door for pathing rolls (Unlucky / Super Lucky).
const OFFICE_DISTANCE = {
  bonnie: { office_door_left: 0, '2B': 1, '2A': 2, '3': 2, '1B': 3, '5': 3, '1A': 4 },
  chica: { office_door_right: 0, '4B': 1, '4A': 2, '6': 3, '7': 3, '1B': 3, '1A': 4 }
};

function hasCheat(room, id) {
  return !!(room && room.cheats && room.cheats.has(id));
}

// 1-17s normally; the two luck cheats pin it to an end of that range.
function rollFoxyStallMs(room) {
  let seconds;
  if (hasCheat(room, 'unlucky')) seconds = 1;
  else if (hasCheat(room, 'superLucky')) seconds = 17;
  else seconds = Math.random() * 16 + 1;
  return Math.floor(seconds * 1000 * room.clockMult);
}

// Golden Freddy AI level by night & hour.
const GOLDEN_FREDDY_AI = {
  1: [0, 0, 0, 0, 0, 1],
  2: [0, 0, 0, 0, 1, 1],
  3: [10, 5, 4, 3, 2, 1],
  4: [20, 15, 10, 5, 1, 1],
  5: [10, 10, 10, 10, 10, 10],
  6: [15, 15, 15, 15, 15, 15],
  // Custom night: fixed at 20 whatever the sliders say — he isn't one of them.
  7: [20, 20, 20, 20, 20, 20]
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

// Foxy door knock power drain percentage.
function getFoxyKnockDrain(knockCount, room) {
  if (hasCheat(room, 'powerLoss')) {
    if (knockCount <= 1) return 11;
    if (knockCount === 2) return 16;
    return 21;
  }
  if (knockCount <= 1) return 1;
  if (knockCount === 2) return 6;
  if (knockCount === 3) return 11;
  if (knockCount === 4) return 16;
  return 21; // 5th or more knock
}

function createRoom(roomId, night, customAI, cheats) {
  const initialAI = customAI || getAIForHour({ night: night || 1 }, 0);
  const now = Date.now();
  const cheatSet = new Set(Array.isArray(cheats) ? cheats : []);

  const timeScale = cheatSet.has('realTime') ? REAL_TIME_SCALE : 1;
  const speedMult = cheatSet.has('speed') ? SPEED_MULTIPLIER : 1;

  // Insta Bonnie Chica cheat initialization.
  const instaBC = cheatSet.has('instaBonnieChica');

  return {
    id: roomId,
    night: night || 1,
    customAI: customAI || null,
    cheats: cheatSet,
    timeScale,
    speedMult,
    clockMult: timeScale * speedMult,
    // Power drain divisor calculation.
    drainDivisor: timeScale * (cheatSet.has('realTime') ? REAL_TIME_DRAIN_RELIEF : 1),
    state: 'waiting',
    hour: 0,
    hourTimerMs: 0,
    broadcastTimerMs: 0,
    lastTickTime: now,
    power: cheatSet.has('powerLoss') ? 90.0 : 100.0,
    usage: 1,
    players: [],
    doors: { left: false, right: false },
    lights: { left: false, right: false },
    jammed: { left: false, right: false },
    cameraUp: false,
    selectedCamera: '1A',
    animatronics: {
      freddy: { location: '1A', ai: initialAI.freddy, movementTimerMs: 0, inOffice: false },
      bonnie: { location: instaBC ? '2B' : '1A', ai: initialAI.bonnie, movementTimerMs: 0, inOffice: false, readyToJumpscare: false },
      chica: { location: instaBC ? '4B' : '1A', ai: initialAI.chica, movementTimerMs: 0, inOffice: false, readyToJumpscare: false },
      foxy: { location: '1C', ai: initialAI.foxy, movementTimerMs: 0, foxyStage: 0, stallTimerMs: 0, sprintTimerMs: 0, sprinting: false, sprintWindowMs: 0, knockCount: 0 },
      goldenFreddy: { ai: getGoldenFreddyAI(night || 1, 0, cheatSet.has('goldenFreddy')), rollTimerMs: 0, active: false, activeMs: 0, cooldownMs: 0 }
    }
  };
}

function getGoldenFreddyAI(night, hour, cheatOn) {
  // Cheat 3 flattens the whole table: 50 from 12 AM to 6 AM on every night.
  if (cheatOn) return GOLDEN_CHEAT_AI;
  const table = GOLDEN_FREDDY_AI[night] || GOLDEN_FREDDY_AI[1];
  return table[Math.min(hour, table.length - 1)];
}

function clearGoldenFreddy(room) {
  const golden = room.animatronics.goldenFreddy;
  if (!golden) return;
  golden.active = false;
  golden.activeMs = 0;
  golden.rollTimerMs = 0;
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

  // Freddy camera stall: fails move when selected camera matches his current room.
  if (name === 'freddy' && room.selectedCamera === state.location) return;

  // Unlucky / Super Lucky AI movement roll checks.
  if (hasCheat(room, 'superLucky')) {
    if (state.ai < 20) return;
  } else if (!hasCheat(room, 'unlucky')) {
    const roll = Math.floor(Math.random() * 20) + 1;
    if (roll > state.ai) return;
  }

  // Freddy won't leave 1A until Bonnie and Chica leave 1A
  if (name === 'freddy' && state.location === '1A') {
    if (room.animatronics.bonnie.location === '1A' || room.animatronics.chica.location === '1A') {
      return;
    }
  }

  // Foxy stage progression (0 to 3).
  if (name === 'foxy') {
    if (state.foxyStage < 3) {
      state.foxyStage++;
      if (state.foxyStage === 3) {
        state.location = '1C'; // Empty cove
        state.sprintTimerMs = Math.floor(FOXY_SPRINT_WAIT_MS * room.clockMult);
        state.sprinting = false;
        state.sprintWindowMs = 0;
      }
    }
    return;
  }

  // Freddy at 4B corner: right door open -> office, closed -> 4A.
  if (name === 'freddy' && state.location === '4B') {
    if (room.doors.right) {
      state.location = '4A'; // Retreat — the right door is shut
    } else {
      state.location = 'office';
      state.inOffice = true;
    }
    return;
  }

  // Bonnie at Left Door
  if (name === 'bonnie' && state.location === 'office_door_left') {
    if (!room.doors.left && !hasCheat(room, 'superLucky')) {
      // Enter office & jam left buttons and turn off left light
      state.location = 'office';
      state.inOffice = true;
      state.readyToJumpscare = room.cameraUp;
      room.jammed.left = true;
      room.lights.left = false;
    } else {
      state.location = getDoorRetreat(room, 'bonnie');
    }
    return;
  }

  // Chica at Right Door
  if (name === 'chica' && state.location === 'office_door_right') {
    if (!room.doors.right && !hasCheat(room, 'superLucky')) {
      // Enter office & jam right buttons and turn off right light
      state.location = 'office';
      state.inOffice = true;
      state.readyToJumpscare = room.cameraUp;
      room.jammed.right = true;
      room.lights.right = false;
    } else {
      state.location = getDoorRetreat(room, 'chica');
    }
    return;
  }

  // Graph traversal
  const paths = MOVEMENT_GRAPH[name];
  if (paths && paths[state.location]) {
    state.location = chooseMove(room, name, paths[state.location]);
  }
}

// Door retreat room for Bonnie and Chica.
function getDoorRetreat(room, name) {
  if (!hasCheat(room, 'instaBonnieChica')) return '1B';
  return name === 'bonnie' ? '2A' : '4A';
}

// Movement pathing decision (random, or Unlucky / Super Lucky distance bias).
function chooseMove(room, name, moves) {
  if (!moves.length) return undefined;
  if (moves.length === 1) return moves[0];

  const dist = OFFICE_DISTANCE[name];
  if (dist) {
    const at = key => (dist[key] === undefined ? 99 : dist[key]);
    if (hasCheat(room, 'unlucky')) {
      return moves.reduce((best, m) => (at(m) < at(best) ? m : best));
    }
    if (hasCheat(room, 'superLucky')) {
      const away = key => (dist[key] === undefined ? -1 : dist[key]);
      return moves.reduce((best, m) => (away(m) > away(best) ? m : best));
    }
  }

  return moves[Math.floor(Math.random() * moves.length)];
}

// Power drain handler.
function drainPower(roomId, room, amount) {
  if (hasCheat(room, 'unlimitedPower')) return;
  room.power = Math.max(0, room.power - amount);
  checkPowerOut(roomId, room);
}

function checkPowerOut(roomId, room) {
  if (room.power > 0 || room.powerOutTriggered) return;

  room.power = 0;
  room.doors.left = false;
  room.doors.right = false;
  room.lights.left = false;
  room.lights.right = false;
  room.cameraUp = false;
  room.usage = 1;
  room.powerOutTriggered = true;
  // Clear Golden Freddy on power outage.
  clearGoldenFreddy(room);

  io.to(roomId).emit('stateUpdate', getRoomStatePayload(room));
  io.to(roomId).emit('gameEnd', { result: 'powerOut' });
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
    cameraUp: room.cameraUp,
    selectedCamera: room.selectedCamera,
    // Active run cheats list.
    cheats: room.cheats ? [...room.cheats] : []
  };
}

function gameTick(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.state !== 'playing') return;

  const now = Date.now();
  const deltaMs = room.lastTickTime ? Math.min(1000, now - room.lastTickTime) : 100;
  room.lastTickTime = now;

  // Hour tracking (60 seconds per hour, or 60 minutes under Real Time)
  const hourLengthMs = HOUR_LENGTH_MS * room.timeScale;
  room.hourTimerMs += deltaMs;
  if (room.hourTimerMs >= hourLengthMs) {
    room.hourTimerMs -= hourLengthMs;
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
    room.animatronics.goldenFreddy.ai =
      getGoldenFreddyAI(room.night, room.hour, hasCheat(room, 'goldenFreddy'));
  }

  // Golden Freddy state tick.
  const golden = room.animatronics.goldenFreddy;
  if (golden.cooldownMs > 0) {
    golden.cooldownMs = Math.max(0, golden.cooldownMs - deltaMs);
  }

  if (golden.active) {
    golden.activeMs += deltaMs;
    if (golden.activeMs >= GOLDEN_OFFICE_DURATION_MS) {
      clearGoldenFreddy(room);
      room.state = 'gameover';
      io.to(roomId).emit('gameOver', { reason: 'goldenFreddy' });
      stopRoomLoop(roomId);
      return;
    }
  } else if (!room.cameraUp) {
    // Reset roll timer when monitor is down.
    golden.rollTimerMs = 0;
  } else if (golden.cooldownMs <= 0 && golden.ai > 0 && room.power > 0 && !room.animatronics.freddy.inOffice) {
    // Golden Freddy roll eligibility check.
    const goldenCheat = hasCheat(room, 'goldenFreddy');
    const rollIntervalMs =
      (goldenCheat ? GOLDEN_CHEAT_ROLL_INTERVAL_MS : GOLDEN_ROLL_INTERVAL_MS) * room.clockMult;

    golden.rollTimerMs += deltaMs;
    if (golden.rollTimerMs >= rollIntervalMs) {
      golden.rollTimerMs -= rollIntervalMs;

      // Golden Freddy roll odds (Super Lucky / Unlucky).
      const denominator = goldenCheat ? GOLDEN_CHEAT_DENOMINATOR : GOLDEN_ROLL_DENOMINATOR;
      let hit;
      if (hasCheat(room, 'superLucky')) hit = false;
      else if (hasCheat(room, 'unlucky')) hit = true;
      else hit = (Math.floor(Math.random() * denominator) + 1) <= golden.ai;

      if (hit) {
        golden.active = true;
        golden.activeMs = 0;
        golden.rollTimerMs = 0;
        golden.cooldownMs =
          (goldenCheat ? GOLDEN_CHEAT_COOLDOWN_MS : GOLDEN_RESPAWN_COOLDOWN_MS) * room.clockMult;
        room.cameraUp = false;
        io.to(roomId).emit('goldenFreddyAppear');
        io.to(roomId).emit('stateUpdate', getRoomStatePayload(room));
      }
    }
  }

  // Foxy camera stall & Stage 4 timer handling
  const foxy = room.animatronics.foxy;
  if (room.cameraUp) {
    if (foxy.stallTimerMs <= 0) {
      foxy.stallTimerMs = rollFoxyStallMs(room);
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
            const knockDrain = getFoxyKnockDrain(foxy.knockCount, room);
            drainPower(roomId, room, knockDrain);
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
          const knockDrain = getFoxyKnockDrain(foxy.knockCount, room);
          drainPower(roomId, room, knockDrain);
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

    if (name === 'foxy' && anim.stallTimerMs > 0) {
      anim.stallTimerMs = Math.max(0, anim.stallTimerMs - deltaMs);
    }

    const intervalMs = config.intervalMs * room.clockMult;
    anim.movementTimerMs += deltaMs;
    if (anim.movementTimerMs >= intervalMs) {
      anim.movementTimerMs -= intervalMs;
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
    drainPower(roomId, room, POWER_DRAIN_BASE * (deltaMs / 1000) * usage / room.drainDivisor);
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
    const { roomId, night = 1, customAI = null, cheats = [] } = data;
    let room = rooms.get(roomId);

    if (!room || room.state === 'gameover' || room.state === 'won') {
      room = createRoom(roomId, night, customAI, cheats);
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
      foxy.sprintWindowMs = FOXY_SPRINT_WINDOW_MS;
      io.to(room.id).emit('foxySprint');
    }
  }

  socket.on('playerAction', (action) => {
    const room = rooms.get(socket.roomId);
    if (!room || room.state !== 'playing' || room.power <= 0) return;

    // Freddy in-office jumpscare trigger.
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

      // Bonnie & Chica in-office jumpscare trigger.
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

      // Pulling the monitor back up is what sends Golden Freddy away.
      if (newCameraUp && room.animatronics.goldenFreddy.active) {
        clearGoldenFreddy(room);
        io.to(socket.roomId).emit('goldenFreddyVanish');
      }

      room.cameraUp = newCameraUp;
      if (room.cameraUp && room.animatronics.foxy.stallTimerMs <= 0) {
        room.animatronics.foxy.stallTimerMs = rollFoxyStallMs(room);
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

  // Client player death notification.
  socket.on('playerDied', () => {
    const room = rooms.get(socket.roomId);
    if (!room || room.state !== 'playing') return;
    room.state = 'gameover';
    stopRoomLoop(socket.roomId);
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

const PORT = Number(process.env.PORT) || 3000;

server.listen(PORT, () => {
  console.log(`FNAF Backend running on http://localhost:${PORT}`);
});