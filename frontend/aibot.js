// AI Mode bot (cheat 10) - Autonomously plays shifts by reading game state and operating player controls.

const AIBot = (() => {
    const TICK_MS = 100;

    // Server-side constants this file has to agree with. If MOVEMENT_CONFIG or
    // the Foxy stall roll in server.js change, change these too.
    const FOXY_INTERVAL_MS = 5010;
    const BONNIE_INTERVAL_MS = 4970;
    const CHICA_INTERVAL_MS = 4980;
    const FREDDY_INTERVAL_MS = 3020;
    const FOXY_SPRINT_WAIT_MS = 30000;

    // Lead time for closing doors before a mover's window expires.
    const DOOR_LEAD_MS = 1200;

    // Wider still: a tap can be pushed back by an urgent door close, and unlike
    // a door there is no second chance — once Foxy completes an interval the
    // stage is gone and the knock is coming.
    const TAP_LEAD_MS = 1500;

    // Blackout duration during monitor tap (flip up, hold, flip down).
    const TAP_BLACKOUT_MS = 1300;

    // Where the camera selection rests. See fact 1.
    const PARK_CAM = '4B';

    const TAP_HOLD_MS = 120;

    // Minimum delay between lowering and raising monitor to prevent state desync.
    const CAM_RELAUNCH_GAP_MS = 420;

    let timer = null;
    let running = false;
    let plan = null;
    let mem = null;

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    /* ------------------------------ Sizing up ----------------------------- */

    // Derives reaction timing and Foxy tap intervals based on night AI levels and active cheats.
    function planFor(night, customAI, cheats) {
        const has = id => !!(cheats && cheats.has && cheats.has(id));

        // Mirrors REAL_TIME_SCALE and SPEED_MULTIPLIER in server.js. Real Time
        // is 45 because the base in-game hour is 80s and it has to come out at
        // one real hour: 80 * 45 = 3600s. Change one, change both.
        const clockMult = (has('realTime') ? 45 : 1) * (has('speed') ? 0.5 : 1);

        const foxyMs = FOXY_INTERVAL_MS * clockMult;
        const bonnieMs = BONNIE_INTERVAL_MS * clockMult;
        const freddyMs = FREDDY_INTERVAL_MS * clockMult;

        // Pressure, only used for how twitchy the bot is. 0 is an empty night,
        // 1 is 4/20, above that is 4/20 with cheats piled on.
        let pressure;
        if (night === 7 && customAI) {
            pressure = (customAI.freddy + customAI.bonnie + customAI.chica + customAI.foxy) / 80;
        } else {
            // Roughly the peak of each night's own AI schedule, over 80.
            pressure = ({ 1: 0.09, 2: 0.16, 3: 0.19, 4: 0.25, 5: 0.34, 6: 0.69 })[night] || 0.5;
        }
        if (has('unlucky')) pressure += 0.35;          // every roll succeeds
        if (has('instaBonnieChica')) pressure += 0.25; // both start at the corners
        if (has('goldenFreddy')) pressure += 0.15;
        if (has('powerLoss')) pressure += 0.15;
        if (has('superLucky')) pressure -= 0.50;
        if (has('unlimitedPower')) pressure -= 0.25;
        pressure = clamp(pressure, 0, 2);

        return {
            clockMult,
            pressure: Math.round(pressure * 100) / 100,
            foxyMs,
            bonnieMs,
            // Fast enough to sit well inside the tightest mover's window, which
            // is what the last-second door and tap timing depends on.
            reactionMs: clamp(freddyMs / 22, 60, 220)
        };
    }

    function freshMemory() {
        return {
            camPurpose: null,       // 'tap' | 'golden'
            camReadyAt: 0,
            lastCamSessionAt: 0,
            lastCamLoweredAt: 0,
            frozen: false,
            lastActionAt: 0,
            // Identity of the last state object seen, and when it arrived. Every
            // countdown in the payload is only correct as of that instant.
            stateRef: null,
            stateAt: 0
        };
    }

    // Returns milliseconds elapsed since current state payload arrived.
    function sinceState() {
        return mem.stateAt ? (Date.now() - mem.stateAt) : 0;
    }

    // Is this animatronic within `lead` of its next movement roll?
    function movesWithin(anim, baseIntervalMs, lead) {
        const interval = baseIntervalMs * plan.clockMult;
        const elapsed = (anim.movementTimerMs || 0) + sinceState();
        const remaining = interval - elapsed;
        // A missing or nonsense timer must fail safe — shut the door, not open it.
        return !isFinite(remaining) || remaining <= lead;
    }

    // Calculates remaining time before Foxy advances a stage.
    function foxyTimeToAdvance(state) {
        const foxy = state.animatronics.foxy;
        const lag = sinceState();
        const interval = FOXY_INTERVAL_MS * plan.clockMult;
        const stallLeft = Math.max(0, (foxy.stallTimerMs || 0) - lag);

        let progressed = 0;
        if (stallLeft <= 0) {
            const sinceStallEnded = Math.max(0, lag - (foxy.stallTimerMs || 0));
            progressed = Math.min(interval, (foxy.movementTimerMs || 0) + sinceStallEnded);
        }
        const total = stallLeft + (interval - progressed);
        return isFinite(total) ? total : 0;
    }

    /* -------------------------------- Actions ----------------------------- */

    function act(fn) {
        mem.lastActionAt = Date.now();
        fn();
    }

    // The player cannot touch a door, a light or the camera map while the
    // monitor is up. Neither may the bot.
    function controlsAvailable() {
        return !isCameraUp && !cameraAnimating;
    }

    function setDoor(state, side, shouldBeClosed) {
        if (!controlsAvailable()) return false;
        if (state.doors[side] === shouldBeClosed) return false;
        if (jammedState && jammedState[side]) return false;
        act(() => {
            sendAction('toggleDoor', side);
            playSound('doorClick');
        });
        return true;
    }

    // Checks if door needs to be closed based on animatronic proximity and movement intervals.
    function doorWanted(state, side, lead) {
        const a = state.animatronics;
        const ahead = lead === undefined ? DOOR_LEAD_MS : lead;

        if (side === 'left') {
            // Standing at the door is not itself a reason to shut it. She only
            // gets in on a movement roll, so the door only has to be down for
            // the moment that roll lands.
            if (a.bonnie.location === 'office_door_left') {
                return movesWithin(a.bonnie, BONNIE_INTERVAL_MS, ahead);
            }
            const foxy = a.foxy;
            if (foxy.foxyStage >= 3) {
                // Already running: the window is short, so no cleverness here.
                if (foxy.sprinting) return true;
                // Otherwise he leaves on his own countdown, which is visible.
                const left = (foxy.sprintTimerMs || FOXY_SPRINT_WAIT_MS * plan.clockMult) - sinceState();
                return !isFinite(left) || left <= ahead;
            }
            return false;
        }

        if (a.chica.location === 'office_door_right') {
            return movesWithin(a.chica, CHICA_INTERVAL_MS, ahead);
        }
        // Insurance only — the selection lives on 4B, so this should never fire.
        return a.freddy.location === '4B' && state.selectedCamera !== PARK_CAM;
    }

    // Would any open door need shutting within `horizon`?
    function doorClosingWithin(state, horizon) {
        for (const side of ['left', 'right']) {
            if (jammedState && jammedState[side]) continue;
            if (!state.doors[side] && doorWanted(state, side, horizon)) return side;
        }
        return null;
    }

    // Checks if doors require closing.
    function doorNeedsClosing(state) {
        for (const side of ['left', 'right']) {
            if (jammedState && jammedState[side]) continue;
            if (!state.doors[side] && doorWanted(state, side)) return side;
        }
        return null;
    }

    function doorNeedsOpening(state) {
        for (const side of ['left', 'right']) {
            if (jammedState && jammedState[side]) continue;
            if (state.doors[side] && !doorWanted(state, side)) return side;
        }
        return null;
    }

    function manageDoors(state) {
        // Closing always outranks opening, including across sides.
        const shut = doorNeedsClosing(state);
        if (shut) return setDoor(state, shut, true);
        const open = doorNeedsOpening(state);
        if (open) return setDoor(state, open, false);
        return false;
    }

    /* -------------------------------- Camera ------------------------------ */

    function goToCam(cam) {
        if (cam === selectedCamera) return false;
        act(() => {
            selectCamera(cam);
            playSound('Blip3');
        });
        return true;
    }

    function raiseMonitor(purpose) {
        act(() => {
            openCamera();
            sendAction('setCamera', null, true);
        });
        mem.camPurpose = purpose;
        mem.camReadyAt = 0;
        return true;
    }

    function lowerMonitor() {
        act(() => closeCamera());
        mem.lastCamSessionAt = Date.now();
        mem.lastCamLoweredAt = Date.now();
        mem.camPurpose = null;
        return true;
    }

    // Determines if camera taps are needed to keep Foxy stalled.
    function needsTaps(state) {
        const foxy = state.animatronics.foxy;
        if (foxy.ai <= 0) return false;
        // Past stalling. The left door is the answer now, not the monitor.
        if (foxy.foxyStage >= 3) return false;
        // Only when his own clock says he is about to get somewhere. Tapping on
        // a fixed rhythm re-armed a stall that still had seconds left on it,
        // paying for the monitor and for a Golden Freddy roll to buy nothing.
        return foxyTimeToAdvance(state) <= TAP_LEAD_MS;
    }

    function manageCamera(state) {
        const now = Date.now();
        if (cameraAnimating || !canToggleCamera || isFoxySprinting) return false;

        if (isCameraUp) {
            // Always leave on 4B: that is what pins Freddy once it comes down.
            if (selectedCamera !== PARK_CAM) return goToCam(PARK_CAM);
            if (!mem.camReadyAt) mem.camReadyAt = now;
            // Only a door that needs *shutting* is worth cutting a tap short
            // for; the controls are unreachable until the monitor is down. A
            // pending open can wait for the tap to finish, which it would have
            // to anyway.
            if (doorNeedsClosing(state) !== null || now - mem.camReadyAt >= TAP_HOLD_MS) {
                return lowerMonitor();
            }
            return false;
        }

        // Not just "is a door wrong now" — is one going to want shutting while
        // the tap has the controls. Starting a tap in front of that is what
        // makes an otherwise correct last-second door arrive late.
        if (doorClosingWithin(state, DOOR_LEAD_MS + TAP_BLACKOUT_MS) !== null) return false;
        if (now - mem.lastCamLoweredAt < CAM_RELAUNCH_GAP_MS) return false;
        if (!needsTaps(state)) return false;
        return raiseMonitor('tap');
    }

    // Raises monitor to dispel Golden Freddy when present.
    function manageGoldenFreddy() {
        const sprite = document.getElementById('goldenFreddy');
        if (!sprite || sprite.style.display === 'none') return false;
        if (isCameraUp || cameraAnimating || !canToggleCamera) return false;
        return raiseMonitor('golden');
    }

    function tick() {
        if (!running) return;

        const state = currentState;
        if (!state || !state.animatronics || state.power <= 0 || isPowerOutage) return;
        if (typeof gameActive !== 'undefined' && !gameActive) return;

        // Note when this payload landed; every countdown in it is read relative
        // to that instant, not to now.
        if (state !== mem.stateRef) {
            mem.stateRef = state;
            mem.stateAt = Date.now();
        }

        const a = state.animatronics;

        // If an animatronic is in office, sit still to survive.
        if (a.freddy.inOffice || a.bonnie.inOffice || a.chica.inOffice) return;

        if (manageGoldenFreddy()) return;

        if (Date.now() - mem.lastActionAt < plan.reactionMs) return;

        // Doors first: a wrong door is fatal, everything else is opportunity
        // cost. manageCamera sits under it because it is what lowers the
        // monitor when a door needs attention.
        if (manageDoors(state)) return;
        manageCamera(state);
    }

    function start() {
        stop();
        plan = planFor(
            typeof currentNight !== 'undefined' ? currentNight : 1,
            typeof currentCustomAI !== 'undefined' ? currentCustomAI : null,
            typeof runCheats !== 'undefined' ? runCheats : new Set()
        );
        mem = freshMemory();
        mem.lastCamSessionAt = 0;
        running = true;
        timer = setInterval(tick, TICK_MS);
    }

    function stop() {
        running = false;
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        mem = null;
    }

    function isRunning() { return running; }
    function getPlan() { return plan; }

    return { start, stop, isRunning, plan: getPlan };
})();
