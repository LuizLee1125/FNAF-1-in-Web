// Cheats registry, local persistence, and star-blocking rules.

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
        desc: 'Nights start at 90% power. Foxy knocks ramp 11% to 21%.',
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

function loadCheats() {
    try {
        const raw = JSON.parse(localStorage.getItem(CHEAT_STORAGE_KEY) || '[]');
        if (!Array.isArray(raw)) return new Set();
        return new Set(raw.filter(id => CHEATS.some(c => c.id === id)));
    } catch (err) {
        return new Set();
    }
}

let enabledCheats = loadCheats();

function saveCheats() {
    try {
        localStorage.setItem(CHEAT_STORAGE_KEY, JSON.stringify([...enabledCheats]));
    } catch (err) { }
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

// Checks if cheat is mutually exclusive with an already enabled cheat.
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

// Checks if any active cheat forfeits star progression.
function anyStarBlockingCheatOn() {
    return CHEATS.some(c => c.blocksStars && enabledCheats.has(c.id));
}

// Cheats that grant a star, restricted to the ones actually on right now.
function activeStarGrantingCheats() {
    return CHEATS.filter(c => c.starIndex !== null && enabledCheats.has(c.id));
}
