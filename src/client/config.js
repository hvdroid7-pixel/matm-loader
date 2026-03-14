export const CONFIG = {
  WS_URL: (window?.FLEE_CFG?.wsUrl) || 'ws://localhost:5000',
  GAME_ID: (window?.FLEE_CFG?.gameId) || 'pony-event-1',
  FORCE_ADMIN: (window?.FLEE_CFG?.forceAdmin) || false
};

export const GAME_SETTINGS = {
  DAMAGE_ON_HIT: 20,
  HEAL_ON_GIVE: 15,
  TASKS_TOTAL: 5,
  SPRINT_MAX: 100,
  SPRINT_DRAIN_RATE: 12,
  SPRINT_REGEN_RATE: 4
};

export const COOLDOWNS = {
  KILLER_ATTACK: 5000,
  MEDIC_HEAL: 8000,
  DETECTIVE_INVESTIGATE: 15000,
  JOKER_DISTRACT: 150000,
  BODYGUARD_PROTECT: 10000,
  PSYCHIC_FREEZE: 30000,
  PSYCHIC_FREEZE_DURATION: 15000,
  SHERIFF_REVEAL: Infinity,
  SHERIFF_SHOOT: 5000,
  JORGUIN_BLOCK: 35000,
  JORGUIN_BLOCK_DURATION: 20000,
  JORGUIN_ATTACK: 10000,
  SPY_INVESTIGATE: 15000,
  SPY_ATTACK: 15000
};

export const SHOP_ITEMS = {
  enfermeria: [
    { id: 'healing_potion', name: 'Poción de sanación', cost: 5, emoji: '🧪' },
    { id: 'first_aid_kit', name: 'Botiquín', cost: 10, emoji: '🩹' }
  ],
  cabana: [
    { id: 'binoculars', name: 'Binoculares', cost: 5, emoji: '🔭' },
    { id: 'smoke_bomb', name: 'Bomba de humo', cost: 5, emoji: '💨' }
  ],
  herreria: [
    { id: 'gauntlets', name: 'Manoplas', cost: 10, emoji: '🥊' },
    { id: 'dagger', name: 'Daga', cost: 25, emoji: '🗡️' }
  ],
  playa: [
    { id: 'hourglass', name: 'Reloj de arena', cost: 7, emoji: '⏳' }
  ]
};

export const LOCATIONS_WITH_SHOPS = {
  4: 'enfermeria',
  16: 'cabana',
  8: 'herreria',
  15: 'playa'
};
