/* ------------------------------- Cheats -----------------------------------
   Pure state: the registry, its persistence, and the two rules that fall out of
   it (mutually exclusive pairs, and which cheats forfeit stars). No DOM and no
   game bindings, so this loads before client.js and script.js and both can read
   it.

   The menu UI lives in script.js with the other menus; the mechanics live on the
   server, which receives the enabled list at joinGame and stores it on the room.

   `starIndex` is a slot in STAR_KEYS (script.js). Slots 0-2 are the original
   three; 3-8 are the cheat stars, each earned only by clearing Night 7 at 4/20
   with that cheat on.                                                        */

const CHEATS = [
    {
        id: 'mapHacks', num: 1, name: 'MAP HACKS',
        desc: 'Map in the office, animatronic dots, no camera blackout.',
        blocksStars: true, starIndex: null, mutex: null
    },
    {
        id: 'unlimitedPower', num: 2, name: 'UNLIMITED POWER',
        desc: 'Power never drains.',
        blocksStars: true, starIndex: null, mutex: 'powerLoss'
    },
    {
        id: 'goldenFreddy', num: 3, name: 'GOLDEN FREDDY',
        desc: 'AI 50 all night, rolls every 0.5s, 5s respawn cooldown.',
        blocksStars: false, starIndex: 3, mutex: null
    },
    {
        id: 'powerLoss', num: 4, name: 'POWER LOSS',
        desc: 'Nights start at 80% power. Foxy knocks drain 21% at once.',
        blocksStars: false, starIndex: 4, mutex: 'unlimitedPower'
    },
    {
        id: 'instaBonnieChica', num: 5, name: 'INSTA BONNIE CHICA',
        desc: 'Bonnie starts at 2B, Chica at 4B. Blocked doors send them to 2A / 4A.',
        blocksStars: false, starIndex: 5, mutex: null
    },
    {
        id: 'unlucky', num: 6, name: 'UNLUCKY',
        desc: 'Every move succeeds, shortest paths, shortest stalls.',
        blocksStars: false, starIndex: 6, mutex: 'superLucky'
    },
    {
        id: 'superLucky', num: 7, name: 'SUPER LUCKY',
        desc: 'Every move fails below AI 20, endless loops, longest stalls.',
        blocksStars: true, starIndex: null, mutex: 'unlucky'
    },
    {
        id: 'realTime', num: 8, name: 'REAL TIME',
        desc: 'Six real hours per night, with the power drain to match.',
        blocksStars: false, starIndex: 7, mutex: null
    },
    {
        id: 'speed', num: 9, name: 'SPEED',
        desc: 'Every animatronic moves twice as fast.',
        blocksStars: false, starIndex: 8, mutex: null
    },
    {
        id: 'aiMode', num: 10, name: 'AI MODE',
        desc: 'The game plays itself, sizing itself to the night.',
        blocksStars: true, starIndex: null, mutex: null
    }
];

const CHEAT_STORAGE_KEY = 'fnaf_cheats';

/* The AI Mode bot has no strength setting. It sizes itself to the shift at hand
   — the night, the Custom Night sliders, and whichever cheats are on — in
   planFor() in aibot.js. See §6c of system_architecture.md. */

function loadCheats() {
    try {
        const raw = JSON.parse(localStorage.getItem(CHEAT_STORAGE_KEY) || '[]');
        if (!Array.isArray(raw)) return new Set();
        // Drop anything that isn't a live cheat id, so a renamed cheat can't
        // resurrect itself out of an old save.
        return new Set(raw.filter(id => CHEATS.some(c => c.id === id)));
    } catch (err) {
        return new Set();
    }
}

let enabledCheats = loadCheats();

function saveCheats() {
    try {
        localStorage.setItem(CHEAT_STORAGE_KEY, JSON.stringify([...enabledCheats]));
    } catch (err) {
        /* Private mode / full quota — the toggles just don't survive the reload. */
    }
}

function getCheat(id) {
    return CHEATS.find(c => c.id === id) || null;
}

function isCheatOn(id) {
    return enabledCheats.has(id);
}

function getEnabledCheats() {
    return [...enabledCheats];
}

// A cheat is locked, not auto-swapped, while its partner is on: the player has to
// turn the other one off first.
function isCheatLocked(id) {
    const cheat = getCheat(id);
    return !!(cheat && cheat.mutex && enabledCheats.has(cheat.mutex));
}

function setCheat(id, on) {
    const cheat = getCheat(id);
    if (!cheat) return false;
    if (on && isCheatLocked(id)) return false;

    if (on) enabledCheats.add(id);
    else enabledCheats.delete(id);
    saveCheats();
    return true;
}

function toggleCheat(id) {
    return setCheat(id, !isCheatOn(id));
}

/* One rule covers both halves of the requirement: any of these being on forfeits
   the night 5/6/7 stars *and* the cheat stars, since awardStar is the only way
   any star is ever written. */
function anyStarBlockingCheatOn() {
    return CHEATS.some(c => c.blocksStars && enabledCheats.has(c.id));
}

// Cheats that grant a star, restricted to the ones actually on right now.
function activeStarGrantingCheats() {
    return CHEATS.filter(c => c.starIndex !== null && enabledCheats.has(c.id));
}
