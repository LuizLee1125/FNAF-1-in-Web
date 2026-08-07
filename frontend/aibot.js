/* ------------------------------ AI Mode (cheat 10) -------------------------
   A bot that plays the shift, sizing itself to whatever shift it is handed —
   Night 1 through 6, Night 7 at any slider setting including 0/0/0/0 and 4/20,
   with any combination of cheats on top. There is no strength setting: the
   numbers below are derived from the run's own clocks, so a night the server
   has made faster automatically gets a faster bot.

   It plays through the player's controls. Doors, lights and the camera map are
   unavailable while the monitor is up (see handleButtonClick in client.js, and
   the panels script.js hides), so the bot has to put the monitor down before it
   can touch a door. The server has no such guard — reaching past the UI
   straight to sendAction would be cheating — so `controlsAvailable()` is the
   single choke point every door action goes through.

   It does read animatronic positions directly. That is a deliberate reversal of
   this cheat's original "must not know or predict movement" rule, made because
   4/20 with cheats stacked cannot be survived on partial information. The
   honest, player-visible-only version is in git history if it is ever wanted
   back.

   ---------------------------------------------------------------------------
   Four facts out of server.js drive the whole strategy:

   1. Freddy is frozen for as long as 4B is the *selected* camera, and the
      selection survives the monitor coming down. So the selection lives on 4B
      and he is simply never a threat.
   2. Raising the monitor arms Foxy a fresh stall, and he cannot move while it
      runs or while the monitor is up. His movement timer resets on every
      stalled tick, so he needs a full uninterrupted interval to advance.
   3. The right light never reveals Freddy — he steps 4B -> office directly.
      Irrelevant here since positions are read directly, but it is why the
      camera selection matters more than any light.
   4. Nobody in the office runs a kill timer. Freddy makes every control fatal
      and Bonnie/Chica kill on the next monitor flip, but sitting perfectly
      still survives to 6 AM.

   Facts 1 and 2 combine: a short tap of the monitor *while already parked on
   4B* stalls Foxy and keeps Freddy pinned, for about half a second. That is the
   entire camera strategy. There is no sweep — every second spent off 4B is a
   second Freddy can use.

   Loaded after script.js so it can reach that file's top-level bindings.     */

const AIBot = (() => {
    const TICK_MS = 100;

    // Server-side constants this file has to agree with. If MOVEMENT_CONFIG or
    // the Foxy stall roll in server.js change, change these too.
    const FOXY_INTERVAL_MS = 5010;
    const BONNIE_INTERVAL_MS = 4970;
    const FREDDY_INTERVAL_MS = 3020;

    // Where the camera selection rests. See fact 1.
    const PARK_CAM = '4B';

    const TAP_HOLD_MS = 120;

    // Do not raise the monitor again within this of lowering it: closeCamera
    // only emits `setCamera false` at the end of its flip-down, and a raise that
    // overlaps it makes client and server disagree about `cameraUp`, which
    // trips forceCloseCamera and burns the tap.
    const CAM_RELAUNCH_GAP_MS = 420;

    let timer = null;
    let running = false;
    let plan = null;
    let mem = null;

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    /* ------------------------------ Sizing up ----------------------------- */

    /* How the bot fits itself to the night. Everything here comes off the run's
       own clocks rather than a difficulty label, so it covers combinations
       nobody enumerated — Speed plus Real Time, say, or 4/20 with three cheats.

       The one number that must be right is the tap interval. Foxy needs a full
       uninterrupted movement interval to advance a stage (fact 2), and a tap
       re-arms his stall whenever it has expired, so the longest clear window he
       can ever get is one tap interval. Keep that under his interval and he can
       never advance at all — which is worth far more than it costs, because it
       also retires the knock that drains 1/6/11/16/21% and never resets. */
    function planFor(night, customAI, cheats) {
        const has = id => !!(cheats && cheats.has && cheats.has(id));

        // Mirrors REAL_TIME_SCALE and SPEED_MULTIPLIER in server.js.
        const clockMult = (has('realTime') ? 60 : 1) * (has('speed') ? 0.5 : 1);

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

        /* The Foxy guarantee is binary — the interval is either under his
           movement interval or it is not — so this does NOT tighten with
           pressure. An earlier version scaled it down as the night got harder,
           which bought nothing and cost a great deal: on a Speed run it landed
           at 700ms, which would have held the monitor up about 70% of the time,
           putting the doors out of reach and handing Golden Freddy a roll every
           quarter second. 0.55 is the cheapest fraction that still leaves a
           delayed tap 45% of headroom before the guarantee lapses. */
        const TAP_FRACTION = 0.55;

        return {
            clockMult,
            pressure: Math.round(pressure * 100) / 100,
            foxyMs,
            bonnieMs,
            tapIntervalMs: clamp(foxyMs * TAP_FRACTION, 900, 240000),
            // Fast enough to sit well inside the tightest mover's window.
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
            lastActionAt: 0
        };
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

    /* What each door should be right now.

       Shutting a door only on the ticks it is actually needed is most of where
       the power comes from: one held on suspicion costs several times one held
       on fact. There is deliberately no pre-closing a room early. Whoever is at
       a door stays there for a full movement interval, the server broadcasts
       state every second *and* immediately after any action of the bot's own,
       and the bot acts several times a second — so the reaction window is never
       close to tight. Pre-closing at 2B and 4B would roughly double door duty
       for insurance against a race that cannot happen. */
    function doorWanted(state, side) {
        const a = state.animatronics;
        if (side === 'left') {
            if (a.bonnie.location === 'office_door_left') return true;
            // Stage 3 means the cove is empty and he is coming, on his own timer.
            return a.foxy.foxyStage >= 3;
        }
        if (a.chica.location === 'office_door_right') return true;
        // Insurance only — the selection lives on 4B, so this should never fire.
        return a.freddy.location === '4B' && state.selectedCamera !== PARK_CAM;
    }

    function doorNeedsChange(state) {
        for (const side of ['left', 'right']) {
            if (state.doors[side] === doorWanted(state, side)) continue;
            if (jammedState && jammedState[side]) continue;
            return side;
        }
        return null;
    }

    function manageDoors(state) {
        const side = doorNeedsChange(state);
        if (!side) return false;
        return setDoor(state, side, doorWanted(state, side));
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

    /* Taps exist for exactly one reason: to keep Foxy stalled. So the bot only
       taps when Foxy can actually move. On a night where his AI is 0 — the
       first hours of Night 1, or a 0/0/0/0 custom night — it never raises the
       monitor at all, which also means Golden Freddy never gets a single roll,
       since he only rolls while the camera is up. Sitting still is both the
       cheapest and the safest line available, and it is the whole reason this
       is derived per-tick from the live AI rather than fixed at the start. */
    function needsTaps(state) {
        const foxy = state.animatronics.foxy;
        if (foxy.ai <= 0) return false;
        // Past stalling. The left door is the answer now, not the monitor.
        if (foxy.foxyStage >= 3) return false;
        return true;
    }

    function manageCamera(state) {
        const now = Date.now();
        if (cameraAnimating || !canToggleCamera || isFoxySprinting) return false;

        if (isCameraUp) {
            // Always leave on 4B: that is what pins Freddy once it comes down.
            if (selectedCamera !== PARK_CAM) return goToCam(PARK_CAM);
            if (!mem.camReadyAt) mem.camReadyAt = now;
            // A door that wants changing outranks the rest of the tap, and the
            // controls are unreachable until the monitor is down.
            if (doorNeedsChange(state) !== null || now - mem.camReadyAt >= TAP_HOLD_MS) {
                return lowerMonitor();
            }
            return false;
        }

        if (doorNeedsChange(state) !== null) return false;
        if (now - mem.lastCamLoweredAt < CAM_RELAUNCH_GAP_MS) return false;
        if (!needsTaps(state)) return false;
        if (now - mem.lastCamSessionAt < plan.tapIntervalMs) return false;
        return raiseMonitor('tap');
    }

    /* Golden Freddy is in the office, on screen, and force-closes the monitor
       when he lands. Pulling it back up is what sends him away, and there are
       only four seconds — shorter than any tap interval, so he gets his own
       branch ahead of everything else and skips the action cooldown. */
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

        const a = state.animatronics;

        /* Someone is standing in the office. Freddy makes every control fatal
           and Bonnie or Chica kill on the next monitor flip — but none of them
           run a timer (fact 4), so doing absolutely nothing survives to 6 AM.
           Sitting still is the winning move. */
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
        mem.lastCamSessionAt = Date.now() - plan.tapIntervalMs;
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
