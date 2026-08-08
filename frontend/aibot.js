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
    const CHICA_INTERVAL_MS = 4980;
    const FREDDY_INTERVAL_MS = 3020;
    const FOXY_SPRINT_WAIT_MS = 30000;

    /* ---------------------------- Running green ---------------------------
       Every watt the bot spends comes from holding something on longer than it
       strictly has to. The payload carries each animatronic's own countdown —
       `movementTimerMs`, and for Foxy `stallTimerMs` / `sprintTimerMs` — so the
       bot does not have to hold a door for the whole time someone is standing
       at it, or tap the monitor on a fixed rhythm. It can act on the last
       moment that still works.

       A door shut for the final ~0.7s of a 5s interval instead of all 5s is
       roughly an eighth of the cost, and taps triggered by Foxy's actual clock
       land about once per stall-plus-interval rather than twice as often as
       needed. Fewer taps also means proportionally fewer Golden Freddy rolls,
       since he only rolls while the monitor is up — so the saving compounds.

       The leads have to cover the worst case honestly: one tick (100ms), the
       action cooldown, the socket hop, and whatever the state is stale by. The
       staleness is measured rather than assumed — see sinceState(). */
    /* 1200, not the ~300 the round trip alone needs. A tap puts the monitor up
       for roughly a second, and the door controls do not exist while it is up
       (handleButtonClick returns early on isCameraUp). So the lead has to cover
       lowering the monitor as well, or the last moment arrives mid-tap and the
       door shuts too late. TAP_BLACKOUT_MS below is the other half of that. */
    const DOOR_LEAD_MS = 1200;

    // Wider still: a tap can be pushed back by an urgent door close, and unlike
    // a door there is no second chance — once Foxy completes an interval the
    // stage is gone and the knock is coming.
    const TAP_LEAD_MS = 1500;

    /* How long a tap takes the doors away for: flip up, hold, flip down. Never
       start one when a door is due to shut inside that window — the point of
       closing at the last moment is lost if the last moment is spent with the
       monitor in the way. */
    const TAP_BLACKOUT_MS = 1300;

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

    /* How stale the numbers in `currentState` are. Broadcasts are 1Hz, but any
       action of the bot's own triggers one immediately, so this is usually only
       tens of milliseconds — and on a green run, where the bot deliberately does
       nothing for long stretches, it stretches back out toward a second. Every
       countdown below is corrected by it rather than trusted as-is. */
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

    /* Soonest Foxy could advance a stage. His movement timer is pinned at zero
       for as long as the stall runs, so the two add rather than overlap; once
       the stall has lapsed the timer we were told is the real progress. */
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

    /* What each door should be right now.

       Shutting a door only on the ticks it is actually needed is most of where
       the power comes from: one held on suspicion costs several times one held
       on fact. There is deliberately no pre-closing a room early. Whoever is at
       a door stays there for a full movement interval, the server broadcasts
       state every second *and* immediately after any action of the bot's own,
       and the bot acts several times a second — so the reaction window is never
       close to tight. Pre-closing at 2B and 4B would roughly double door duty
       for insurance against a race that cannot happen. */
    /* `lead` is how far ahead to look. The door logic uses DOOR_LEAD_MS; the tap
       gate passes a longer horizon to ask "will this door need shutting before
       a tap would give the controls back?". */
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

    /* Shutting a door late is fatal. Opening one late only wastes power. They
       are not the same kind of pending change and must not be collapsed into
       one "door needs attention" test — doing that starved Foxy's tap window,
       because on a busy night some door almost always wants *opening*, and that
       was enough to keep blocking the monitor until he reached stage 3. */
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

        // Note when this payload landed; every countdown in it is read relative
        // to that instant, not to now.
        if (state !== mem.stateRef) {
            mem.stateRef = state;
            mem.stateAt = Date.now();
        }

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
