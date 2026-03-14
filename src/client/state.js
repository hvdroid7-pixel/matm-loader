import { GAME_SETTINGS } from './config.js';

export const state = {
  ws: null,
  connected: false,
  meName: localStorage.getItem('flee_name_v1') || '',
  meAvatarData: localStorage.getItem('flee_avatar_v1') || '',
  meDescription: localStorage.getItem('flee_description_v1') || '',
  rolesByName: {},
  prevRolesByName: {},
  playersMap: {},
  settings: {
    damageOnHit: GAME_SETTINGS.DAMAGE_ON_HIT,
    healOnGive: GAME_SETTINGS.HEAL_ON_GIVE,
    tasksTotal: GAME_SETTINGS.TASKS_TOTAL
  },
  health: 100,
  tasksRemaining: GAME_SETTINGS.TASKS_TOTAL,
  currentPhase: null,
  roleRevealPlayed: false,
  revealedRoleForMe: false,
  diedOnce: false,
  lastInvestigatedTarget: null,
  
  sprint: {
    max: GAME_SETTINGS.SPRINT_MAX,
    value: GAME_SETTINGS.SPRINT_MAX,
    draining: false,
    exhausted: false,
    regenRate: GAME_SETTINGS.SPRINT_REGEN_RATE,
    drainRate: GAME_SETTINGS.SPRINT_DRAIN_RATE
  },
  
  distractionActive: false,
  cooldowns: {},
  
  coins: [],
  myCoins: 0,
  inventory: [],
  
  currentLobby: null,
  lobbyList: [],
  
  frozen: false,
  frozenUntil: 0,
  abilityBlocked: false,
  abilityBlockedUntil: 0,
  
  publicReveals: {},
  investigatedPlayers: [],
  
  barricades: [],
  usedPsychicExterminate: false,
  usedSheriffReveal: false,
  carpinterBarricadesBuilt: 0,
  
  equipedItems: {
    gauntlets: false,
    dagger: false,
    firstAidKit: false
  }
};

export function resetGameState() {
  state.health = 100;
  state.tasksRemaining = state.settings.tasksTotal;
  state.currentPhase = null;
  state.roleRevealPlayed = false;
  state.revealedRoleForMe = false;
  state.diedOnce = false;
  state.lastInvestigatedTarget = null;
  state.sprint.value = state.sprint.max;
  state.sprint.draining = false;
  state.sprint.exhausted = false;
  state.distractionActive = false;
  state.cooldowns = {};
  state.coins = [];
  state.myCoins = 0;
  state.inventory = [];
  state.frozen = false;
  state.frozenUntil = 0;
  state.abilityBlocked = false;
  state.abilityBlockedUntil = 0;
  state.publicReveals = {};
  state.investigatedPlayers = [];
  state.barricades = [];
  state.usedPsychicExterminate = false;
  state.usedSheriffReveal = false;
  state.carpinterBarricadesBuilt = 0;
  state.equipedItems = {
    gauntlets: false,
    dagger: false,
    firstAidKit: false
  };
}
