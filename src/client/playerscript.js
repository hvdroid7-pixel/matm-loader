/* Sistema de juego Murder at the Meeting con todas las funciones actuales + nuevas mejoras */

const _cfg = (window && window.FLEE_CFG) ? window.FLEE_CFG : {};
const WS_URL = _cfg.wsUrl || 'ws://localhost:3000';
const GAME_ID = _cfg.gameId || 'pony-event-1';

const clamp = (v, a=0, b=100) => Math.max(a, Math.min(b, v));
const $ = (s, root=document) => root.querySelector(s);
const $all = (s, root=document) => Array.from((root||document).querySelectorAll(s));
const escapeHTML = s => s ? String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]) : '';

let ws = null, connected = false;
let meName = localStorage.getItem('flee_name_v1') || '';
let meAvatarData = localStorage.getItem('flee_avatar_v1') || '';
let meDescription = localStorage.getItem('flee_description_v1') || '';
let rolesByName = {};
let prevRolesByName = {};
let playersMap = {};
let settings = { damageOnHit: 20, healOnGive: 15, tasksTotal: 5, coinsEnabled: false };
let health = 100, tasksRemaining = settings.tasksTotal;

let myTasksCompleted = 0;
let myTasksTotal = 0;
let globalTasksCompleted = 0;
let globalTasksTotal = 0;
let currentPhase = null;
let roleRevealPlayed = false;
let revealedRoleForMe = false;
let diedOnce = false;
let lastInvestigatedTarget = null;

const sprint = { max: 100, value: 100, draining: false, exhausted: false, regenRate: 9.6, drainRate: 24 };

let proximityWindows = {}; // { targetName: { element, lastUpdate } }
const trackedPlayerPositions = {};

function ensureNotificationsContainer() {
  let container = $('#flee-notifications-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'flee-notifications-container';
    container.innerHTML = `
      <div id="flee-proximity-stack"></div>
      <div id="flee-toast-stack"></div>
    `;
    document.body.appendChild(container);
  } else {
    if (!$('#flee-proximity-stack', container)) {
      const prox = document.createElement('div');
      prox.id = 'flee-proximity-stack';
      container.prepend(prox);
    }
    if (!$('#flee-toast-stack', container)) {
      const toast = document.createElement('div');
      toast.id = 'flee-toast-stack';
      container.appendChild(toast);
    }
  }
  return container;
}

function getProximityStack() {
  const container = ensureNotificationsContainer();
  return $('#flee-proximity-stack', container) || container;
}

function getToastStack() {
  const container = ensureNotificationsContainer();
  return $('#flee-toast-stack', container) || container;
}

function findMentionedPlayerName(message) {
  if (!message) return null;
  const msg = String(message).toLowerCase();
  const names = new Set([meName, ...Object.keys(playersMap)]);
  for (const name of names) {
    if (!name) continue;
    if (msg.includes(String(name).toLowerCase())) return name;
  }
  return null;
}

function getAvatarForPlayer(name) {
  if (!name) return '';
  if (name === meName && meAvatarData) return meAvatarData;
  const p = playersMap[name];
  if (p && p.avatarUrl) return p.avatarUrl;
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`;
}

function createProximitySystem() {
  const BASE_THRESHOLD = 0.10;
  const SPECIAL_RANGE_MULTIPLIER = 0.25 / 0.12;
  const EXTENDED_THRESHOLD = BASE_THRESHOLD * SPECIAL_RANGE_MULTIPLIER;
  const HYSTERESIS_MARGIN = 0.012;
  let checkInterval = null;

  function getContainer() {
    return getProximityStack();
  }

  function getDetectionThreshold(targetName, hasWindow) {
    const myRole = rolesByName[meName] || revealedRoleForMe || 'innocent';
    const base = (myRole === 'sheriff' || (myRole === 'spy' && spyInvestigatedPlayers.includes(targetName)))
      ? EXTENDED_THRESHOLD
      : BASE_THRESHOLD;
    return hasWindow ? (base + HYSTERESIS_MARGIN) : base;
  }

  function getPlayerPosition(playerName, playerData) {
    if (playerData && playerData.position && typeof playerData.position.x === 'number' && typeof playerData.position.y === 'number') {
      return playerData.position;
    }
    if (trackedPlayerPositions[playerName]) {
      return trackedPlayerPositions[playerName];
    }
    return null;
  }

  function showWindow(playerName, playerData) {
    let win = proximityWindows[playerName];
    if (!win) {
      const el = document.createElement('div');
      el.className = 'flee-proximity-window';
      el.innerHTML = `
        <img src="${playerData.avatarUrl || ''}" class="prox-avatar" alt="${escapeHTML(playerName)}">
        <div class="prox-info">
          <div class="prox-name">${escapeHTML(playerName)}</div>
          <div class="prox-health" aria-hidden="true">
            <div class="prox-health-fill"></div>
            <span class="prox-health-text">100%</span>
          </div>
          <div class="prox-actions" data-player="${escapeHTML(playerName)}"></div>
        </div>
      `;
      getContainer().prepend(el);
      win = { element: el, actionsSignature: '' };
      proximityWindows[playerName] = win;
    }

    if (win.removeTimer) {
      clearTimeout(win.removeTimer);
      win.removeTimer = null;
    }
    win.element.classList.remove('is-leaving');

    const avatar = win.element.querySelector('.prox-avatar');
    if (avatar && playerData.avatarUrl) avatar.src = playerData.avatarUrl;
  }

  function update() {
    const myPos = window.islandPlayerPos || window._lastKnownPosition;
    if (!myPos) return;

    Object.entries(playersMap).forEach(([playerName, playerData]) => {
      if (playerName === meName || !playerData || !playerData.alive || playerData.connected === false) {
        removeProximityWindow(playerName);
        return;
      }

      const targetPos = getPlayerPosition(playerName, playerData);
      if (!targetPos) {
        removeProximityWindow(playerName);
        return;
      }

      const dist = Math.hypot(targetPos.x - myPos.x, targetPos.y - myPos.y);
      const threshold = getDetectionThreshold(playerName, !!proximityWindows[playerName]);

      if (dist <= threshold) {
        showWindow(playerName, playerData);
        showProximityWindow(playerName, playerData);
      } else {
        removeProximityWindow(playerName);
      }
    });
  }

  function start() {
    if (checkInterval) return;
    getContainer();
    checkInterval = setInterval(update, 250);
  }

  return { start, update };
}

const proximitySystem = createProximitySystem();

function updateProximityWindows() {
  proximitySystem.update();
}

function buildActionButtonsSignature(myRole, targetName) {
  if (abilityBlocked) return `blocked:${myRole}:${targetName}`;

  const buttons = [];
  if (myRole === 'killer') buttons.push('attack');
  if (myRole === 'medic') buttons.push('heal');
  if (myRole === 'detective') buttons.push('investigate');
  if (myRole === 'bodyguard') {
    const isProtecting = guardState.protecting === targetName;
    buttons.push(`protect:${isProtecting ? 'off' : 'on'}`);
  }
  if (myRole === 'psychic') {
    buttons.push('freeze');
    if (!cooldowns.psychic_exterminate_used) buttons.push('exterminate');
  }
  if (myRole === 'sheriff') {
    if (!cooldowns.sheriff_reveal_used) buttons.push('reveal');
    buttons.push('shoot');
  }
  if (myRole === 'jorguin') {
    buttons.push('block', 'jorguin_attack');
  }
  if (myRole === 'spy') {
    buttons.push('spy_investigate', 'spy_attack');
  }

  const cooldownSnapshot = buttons.map((type) => {
    const key = getCooldownKeyForType(type.split(':')[0]);
    if (!key || !isOnCooldown(key)) return `${type}:ready`;
    return `${type}:${Math.ceil((cooldowns[key] - Date.now()) / 1000)}`;
  }).join('|');

  return `${myRole}:${targetName}:${cooldownSnapshot}`;
}

function updateMedicHealthInProximity(win, playerData, myRole) {
  const healthWrap = win.element.querySelector('.prox-health');
  const healthFill = win.element.querySelector('.prox-health-fill');
  const healthText = win.element.querySelector('.prox-health-text');
  if (!healthWrap || !healthFill || !healthText) return;

  if (myRole !== 'medic') {
    healthWrap.classList.remove('visible');
    return;
  }

  const hp = Math.max(0, Math.min(100, Number(playerData?.health ?? 100)));
  healthWrap.classList.add('visible');
  healthFill.style.width = `${hp}%`;
  healthText.textContent = `${Math.round(hp)}%`;
}

function showProximityWindow(name, p) {
  let win = proximityWindows[name];
  if (!win) {
    return;
  }

  const actions = win.element.querySelector('.prox-actions');
  if (!actions) return;

  const myRole = rolesByName[meName] || revealedRoleForMe || 'innocent';
  updateMedicHealthInProximity(win, p, myRole);

  const signature = buildActionButtonsSignature(myRole, name);
  if (win.actionsSignature === signature) return;

  actions.innerHTML = '';
  win.actionsSignature = signature;

  if (abilityBlocked) return;

  const buttons = getActionButtonsForRole(myRole, name);
  buttons.forEach(btn => actions.appendChild(btn));
}

function createProxBtn(container, text, onclick) {
  const b = document.createElement('button');
  b.className = 'prox-btn';
  b.textContent = text;
  b.onclick = onclick;
  container.appendChild(b);
  return b;
}

function removeProximityWindow(name) {
  const win = proximityWindows[name];
  if (win) {
    if (win.removeTimer) return;

    win.element.classList.add('is-leaving');
    win.removeTimer = setTimeout(() => {
      if (win.element && win.element.parentNode) {
        win.element.remove();
      }
      delete proximityWindows[name];
    }, 180);

    if (guardState.protecting === name) {
      guardState.protecting = null;
      wsSend({ t: 'protect', target: null });
    }
  }
}

let distractionActive = false;
const JOKER_DISTRACT_DURATION = 8000;
const JOKER_COOLDOWN_MS = 30000;
let jokerCooldownUntil = 0;

const cooldowns = {
  killer: 0,
  medic: 0,
  detective: 0,
  bodyguard: 0,
  psychic_freeze: 0,
  psychic_exterminate_used: false,
  sheriff_reveal_used: false,
  sheriff_shoot: 0,
  jorguin_block: 0,
  jorguin_attack: 0,
  spy_investigate: 0,
  spy_attack: 0,
  carpenter_barricade: 0,
  joker_distract: 0
};

const KILLER_COOLDOWN_MS = 3000;
const MEDIC_COOLDOWN_MS = 5000;
const DETECTIVE_COOLDOWN_MS = 10000;
const BODYGUARD_COOLDOWN_MS = 5000;
const PSYCHIC_FREEZE_COOLDOWN_MS = 30000;
const SHERIFF_SHOOT_COOLDOWN_MS = 5000;
const JORGUIN_BLOCK_COOLDOWN_MS = 35000;
const JORGUIN_ATTACK_COOLDOWN_MS = 10000;
const SPY_INVESTIGATE_COOLDOWN_MS = 15000;
const SPY_ATTACK_COOLDOWN_MS = 15000;

const guardState = { protecting: null, checkInterval: null };
const protectedBy = {};
let jokerCooldownInterval = null;

let _jokerFloatingBtn = null;
let _carpenterFloatingBtn = null;
const CARPENTER_BARRICADE_COOLDOWN_MS = 240000;

let myCoins = 0;
let coinsOnMap = [];
let myInventory = [];
let equippedItems = { gauntlets: false, dagger: false, firstAidKit: false };

let itemEffects = {
  hourglassUntil: 0,
  smokeBombedUntil: 0
};
let targetSelectionMode = { active: false, itemId: null, callback: null };

const ITEM_INFO = {
  pocion_sanacion: { name: 'Poción de sanación', emoji: '🧪', type: 'active', requiresTarget: true },
  botiquin: { name: 'Botiquín', emoji: '🩹', type: 'passive' },
  binoculares: { name: 'Binoculares', emoji: '🔭', type: 'active', requiresTarget: true },
  bomba_humo: { name: 'Bomba de humo', emoji: '💨', type: 'active', requiresTarget: true },
  manoplas: { name: 'Manoplas', emoji: '🥊', type: 'passive' },
  daga: { name: 'Daga', emoji: '🗡️', type: 'passive' },
  reloj_arena: { name: 'Reloj de arena', emoji: '⏳', type: 'active', requiresTarget: false },
  globos_joker: { name: 'Globos', emoji: '🎈', type: 'active', requiresTarget: false, unlimited: true, roleRestricted: 'joker' },
  barricada_carpintero: { name: 'Barricada', emoji: '🧱', type: 'active', requiresTarget: false, unlimited: true, roleRestricted: 'carpenter' }
};

function getInventoryItemCount(itemId) {
  return myInventory.filter(id => id === itemId).length;
}

function hasItem(itemId) {
  return getInventoryItemCount(itemId) > 0;
}

function isJorguinCurseActive() {
  return controlLockState.jorguinCurseUntil > Date.now();
}

function isPsychicFreezeActive() {
  return controlLockState.psychicFrozenUntil > Date.now();
}

function forceSprintExhaustedLock() {
  sprint.value = 0;
  sprint.exhausted = true;
  sprint.draining = false;

  if (!sprintExhaustedTriggered) {
    sprintExhaustedTriggered = true;
    triggerSprintExhaustedActions();
  }

  window.postMessage({ source: 'radar-admin', type: 'setSprintBlocked', blocked: true }, '*');
}

function syncControlLockState() {
  const curseActive = isJorguinCurseActive();
  const freezeActive = isPsychicFreezeActive();

  if (freezeActive) {
    sprint.draining = false;
    window.postMessage({ source: 'radar-admin', type: 'setSprintBlocked', blocked: true }, '*');
  }

  if (curseActive) {
    if (!controlLockState.sprintForcedByCurse) {
      controlLockState.sprintForcedByCurse = true;
      forceSprintExhaustedLock();
      updateSprintUI();
    }
  } else {
    controlLockState.sprintForcedByCurse = false;
  }

  if (!freezeActive && !curseActive && !sprint.exhausted) {
    window.postMessage({ source: 'radar-admin', type: 'setSprintBlocked', blocked: false }, '*');
  }
}

function isJokerActiveRole() {
  return rolesByName[meName] === 'joker' || revealedRoleForMe === 'joker';
}

function isCarpenterActiveRole() {
  return rolesByName[meName] === 'carpenter' || revealedRoleForMe === 'carpenter';
}

function updateInventoryUI() {
  const section = $('#flee-inventory-section');
  const container = $('#flee-inventory-items');
  if (!section || !container) return;

  const showJokerItem = isJokerActiveRole();
  const showCarpenterItem = isCarpenterActiveRole();
  if (myInventory.length === 0 && !showJokerItem && !showCarpenterItem) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';

  const itemCounts = {};
  myInventory.forEach(id => {
    itemCounts[id] = (itemCounts[id] || 0) + 1;
  });

  if (showJokerItem) {
    itemCounts.globos_joker = '∞';
  }
  if (showCarpenterItem) {
    itemCounts.barricada_carpintero = '∞';
  }

  container.innerHTML = '';
  Object.entries(itemCounts).forEach(([itemId, count]) => {
    const info = ITEM_INFO[itemId];
    if (!info) return;

    const item = document.createElement('div');
    item.className = 'flee-inventory-item' + (info.type === 'passive' ? ' passive' : '');

    if (info.type === 'active' && itemEffects.hourglassUntil > Date.now() && itemId === 'reloj_arena') {
      item.classList.add('active-effect');
    }

    item.innerHTML = `
      <span class="item-emoji">${info.emoji}</span>
      <span class="item-name">${info.name}</span>
      <span class="item-count">x${count}</span>
    `;

    if (info.type === 'active') {
      item.onclick = () => startItemUse(itemId);
    }

    container.appendChild(item);
  });
}

function startItemUse(itemId) {
  const info = ITEM_INFO[itemId];
  if (!info || info.type !== 'active') return;

  if (isJorguinCurseActive() || isPsychicFreezeActive()) {
    showNotification('⛔ Bloqueado: no puedes usar objetos', 2000);
    return;
  }
  
  if (itemId === 'globos_joker') {
    triggerJokerDistract();
    return;
  }
  if (itemId === 'barricada_carpintero') {
    triggerCarpenterBuild();
    return;
  }

  if (!hasItem(itemId)) {
    showNotification('No tienes este objeto', 2000);
    return;
  }
  
  if (info.requiresTarget) {
    showTargetSelection(itemId, (targetName) => {
      useItem(itemId, targetName);
    });
  } else {
    useItem(itemId, null);
  }
}

function showTargetSelection(itemId, callback) {
  const overlay = $('#flee-target-select-overlay');
  const list = $('#flee-target-select-list');
  const title = $('#flee-target-select-title');
  
  if (!overlay || !list) return;
  
  const info = ITEM_INFO[itemId];
  title.textContent = `${info.emoji} ${info.name} - Selecciona objetivo`;
  
  targetSelectionMode = { active: true, itemId, callback };
  
  list.innerHTML = '';
  Object.entries(playersMap).forEach(([name, player]) => {
    if (!player.alive || name === meName) return;
    
    const option = document.createElement('div');
    option.className = 'flee-target-option';
    option.innerHTML = `
      <img src="${player.avatarUrl || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%234a9eff%22 width=%22100%22 height=%22100%22/></svg>'}" alt="${escapeHTML(name)}">
      <span>${escapeHTML(name)}</span>
    `;
    option.onclick = () => {
      cancelTargetSelection();
      callback(name);
    };
    list.appendChild(option);
  });
  
  if (itemId === 'pocion_sanacion') {
    const selfOption = document.createElement('div');
    selfOption.className = 'flee-target-option';
    selfOption.innerHTML = `
      <img src="${meAvatarData || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%234a9eff%22 width=%22100%22 height=%22100%22/></svg>'}" alt="Yo">
      <span>Yo mismo</span>
    `;
    selfOption.onclick = () => {
      cancelTargetSelection();
      callback(meName);
    };
    list.insertBefore(selfOption, list.firstChild);
  }
  
  overlay.style.display = 'flex';
}

function cancelTargetSelection() {
  targetSelectionMode = { active: false, itemId: null, callback: null };
  const overlay = $('#flee-target-select-overlay');
  if (overlay) overlay.style.display = 'none';
}

function useItem(itemId, target) {
  if (abilityBlocked && abilityBlockedUntil > Date.now()) {
    showNotification('⛔ ¡Tus habilidades están bloqueadas!', 2000);
    return;
  }
  
  if (itemId === 'globos_joker') {
    triggerJokerDistract();
    return;
  }
  if (itemId === 'barricada_carpintero') {
    triggerCarpenterBuild();
    return;
  }

  if (!hasItem(itemId)) {
    showNotification('No tienes este objeto', 2000);
    return;
  }
  
  wsSend({
    t: 'useItem',
    itemId,
    target
  });
}

function updateSmokeBombTimer() {
  if (itemEffects.smokeBombedUntil <= Date.now()) {
    itemEffects.smokeBombedUntil = 0;
    $('#flee-smokebomb-overlay').style.display = 'none';
    return;
  }
  
  const remaining = Math.max(0, Math.ceil((itemEffects.smokeBombedUntil - Date.now()) / 1000));
  $('#flee-smokebomb-timer').textContent = remaining + 's';
  
  setTimeout(updateSmokeBombTimer, 100);
}

function isHourglassActive() {
  return itemEffects.hourglassUntil > Date.now();
}

function translateRole(role) {
  const translations = {
    killer: 'Asesino',
    medic: 'Médico', 
    innocent: 'Inocente',
    detective: 'Detective',
    joker: 'Joker',
    bodyguard: 'Guardaespaldas',
    psychic: 'Psíquico',
    sheriff: 'Alguacil',
    jorguin: 'Jorguín',
    spy: 'Espía',
    carpenter: 'Carpintero'
  };
  return translations[role] || role;
}

function updateHourglassTimer() {
  const sprintBar = $('#flee-sprint');
  const timerEl = $('#flee-hourglass-timer');
  
  if (itemEffects.hourglassUntil <= Date.now()) {
    itemEffects.hourglassUntil = 0;
    if (sprintBar) sprintBar.classList.remove('hourglass-active');
    if (timerEl) timerEl.style.display = 'none';
    return;
  }
  
  const remaining = Math.max(0, Math.ceil((itemEffects.hourglassUntil - Date.now()) / 1000));
  if (sprintBar) sprintBar.classList.add('hourglass-active');
  if (timerEl) {
    timerEl.style.display = 'block';
    timerEl.textContent = `⏳ ${remaining}s`;
  }
  
  setTimeout(updateHourglassTimer, 100);
}

let exterminateTimerState = { active: false, end: 0, target: '', attacker: '', perspective: '' };
let exterminateTimerInterval = null;

function clearExterminateTimerState() {
  exterminateTimerState = { active: false, end: 0, target: '', attacker: '', perspective: '' };
  if (exterminateTimerInterval) {
    clearInterval(exterminateTimerInterval);
    exterminateTimerInterval = null;
  }
  const timerEl = $('#flee-exterminate-timer');
  if (timerEl) timerEl.style.display = 'none';
}

function updateExterminateTimerUI() {
  const timerEl = $('#flee-exterminate-timer');
  if (!timerEl) return;

  if (!exterminateTimerState.active) {
    timerEl.style.display = 'none';
    return;
  }

  const remaining = Math.max(0, Math.ceil((exterminateTimerState.end - Date.now()) / 1000));
  timerEl.style.display = 'block';

  if (exterminateTimerState.perspective === 'target') {
    timerEl.textContent = `¡Serás exterminado en ${remaining}s! ☄️`;
  } else {
    timerEl.textContent = `El jugador ${exterminateTimerState.target} será exterminado en ${remaining}s ☄️`;
  }

  if (remaining <= 0) {
    clearExterminateTimerState();
  }
}

function startExterminateTimerState(nextState) {
  exterminateTimerState = { ...nextState, active: true };
  updateExterminateTimerUI();
  if (exterminateTimerInterval) clearInterval(exterminateTimerInterval);
  exterminateTimerInterval = setInterval(updateExterminateTimerUI, 1000);
}

let currentLobby = null;
let lobbyList = [];
let currentScreen = 'lobby';

let frozen = false;
let frozenUntil = 0;
let abilityBlocked = false;
let abilityBlockedUntil = 0;
const controlLockState = { jorguinCurseUntil: 0, psychicFrozenUntil: 0, sprintForcedByCurse: false };
let detectiveSpeedBuff = false;
let detectiveSpeedBuffUntil = 0;

let publicReveals = {};
let investigatedPlayers = [];
let spyInvestigatedPlayers = [];
let barricades = [];

let readyState = { isReady: false, readyCount: 0, totalPlayers: 0 };

const DEFAULT_CUSTOM_THEME = {
  bg: '#000000',
  bgOpacity: 0.92,
  border: '#ffffff',
  text: '#ffffff'
};

function sanitizeHexColor(value, fallback) {
  const fallbackNormalized = (fallback || '#ffffff').toLowerCase();
  if (typeof value !== 'string') return fallbackNormalized;

  const trimmed = value.trim();
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(trimmed);
  if (!match) return fallbackNormalized;

  const normalized = match[1].length === 3
    ? match[1].split('').map((ch) => ch + ch).join('')
    : match[1];

  return `#${normalized.toLowerCase()}`;
}

function clampOpacity(value, fallback = DEFAULT_CUSTOM_THEME.bgOpacity) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

const custom = {
  bg: sanitizeHexColor(localStorage.getItem('flee_custom_bg'), DEFAULT_CUSTOM_THEME.bg),
  bgOpacity: clampOpacity(localStorage.getItem('flee_custom_bgOpacity')),
  border: sanitizeHexColor(localStorage.getItem('flee_custom_border'), DEFAULT_CUSTOM_THEME.border),
  text: sanitizeHexColor(localStorage.getItem('flee_custom_text'), DEFAULT_CUSTOM_THEME.text)
};

function setCssVarsForCustom(bg, op, border, text){
  const rgba = hexToRgba(bg, op);
  document.documentElement.style.setProperty('--flee-bg-rgba', rgba);
  document.documentElement.style.setProperty('--flee-bg-solid', bg);
  document.documentElement.style.setProperty('--flee-border', border);
  document.documentElement.style.setProperty('--flee-text', text);
  document.documentElement.style.setProperty('--flee-border-rgb', hexToRgb(border));
  document.documentElement.style.setProperty('--flee-text-rgb', hexToRgb(text));
  document.documentElement.style.setProperty('--flee-bg-rgb', hexToRgb(bg));
}

function hexToRgba(hex, opacity){
  hex = sanitizeHexColor(hex, DEFAULT_CUSTOM_THEME.bg).replace('#','');
  const r = parseInt(hex.substring(0,2),16);
  const g = parseInt(hex.substring(2,4),16);
  const b = parseInt(hex.substring(4,6),16);
  return `rgba(${r},${g},${b},${clampOpacity(opacity)})`;
}

function hexToRgb(hex){
  const clean = sanitizeHexColor(hex, DEFAULT_CUSTOM_THEME.text).replace('#','');
  const r = parseInt(clean.substring(0,2),16);
  const g = parseInt(clean.substring(2,4),16);
  const b = parseInt(clean.substring(4,6),16);
  return `${r},${g},${b}`;
}

function createStyles(){
  setCssVarsForCustom(custom.bg, custom.bgOpacity, custom.border, custom.text);
  const css = `
    :root { 
      --flee-bg-rgba: ${hexToRgba(custom.bg, custom.bgOpacity)};
      --flee-bg-solid: ${custom.bg};
      --flee-border: ${custom.border}; 
      --flee-text: ${custom.text}; 
      --flee-border-rgb: ${hexToRgb(custom.border)};
      --flee-text-rgb: ${hexToRgb(custom.text)};
      --flee-bg-rgb: ${hexToRgb(custom.bg)};
    }
    
    #flee-lobby-screen{position:fixed;inset:0;z-index:100000;background:linear-gradient(135deg,var(--flee-bg-solid),rgba(var(--flee-border-rgb),0.20));display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui}
    
    #flee-notifications-container {position: fixed;top: 20px;right: 20px;z-index: 100030;display:flex;flex-direction:column;gap:12px;pointer-events:none;max-width:320px}
    #flee-proximity-stack{display:flex;flex-direction:column;gap:10px;order:1}
    #flee-toast-stack{display:flex;flex-direction:column;gap:10px;order:2}

    .flee-proximity-window {
      background: linear-gradient(145deg, rgba(8,16,30,0.94), rgba(14,24,42,0.92));
      border: 2px solid rgba(var(--flee-border-rgb),0.55);
      border-radius: 10px;
      padding: 8px 9px;
      display: flex;
      align-items: center;
      gap: 9px;
      min-width: 188px;
      pointer-events: auto;
      color: var(--flee-text);
      box-shadow: 0 10px 24px rgba(0,0,0,0.44), inset 0 1px 0 rgba(255,255,255,0.06);
      transform-origin: top right;
      animation: slideIn 0.2s ease;
      transition: opacity 0.18s ease, transform 0.18s ease;
    }
    .flee-proximity-window.is-leaving { opacity: 0; transform: translateX(10px) scale(0.985); }

    .prox-avatar { width: 38px; height: 38px; border-radius: 50%; border: 1px solid rgba(var(--flee-border-rgb),0.75); object-fit: cover; flex: 0 0 38px; }
    .prox-info { flex: 1; min-width: 0; }
    .prox-name { font-weight: 800; font-size: 13px; margin-bottom: 4px; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .prox-health{display:none;position:relative;height:10px;border-radius:999px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.18);overflow:hidden;margin-bottom:4px}
    .prox-health.visible{display:block}
    .prox-health-fill{height:100%;width:100%;background:linear-gradient(90deg,#2ecc71,#45c35f);transition:width 0.2s ease}
    .prox-health-text{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.7);pointer-events:none}
    .prox-actions { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    .prox-btn { 
      padding: 4px 8px; 
      background: var(--flee-border); 
      color: #000; 
      border: none; 
      border-radius: 4px; 
      font-size: 11px; 
      font-weight: 700; 
      cursor: pointer; 
    }
    .prox-btn.active { background: #2ecc71; color: white; }

    .flee-notification{background:linear-gradient(145deg,rgba(8,20,38,0.96),rgba(18,37,68,0.93));color:var(--flee-text);padding:10px 12px;border-radius:12px;border:2px solid rgba(var(--flee-border-rgb),0.34);font-weight:700;display:flex;align-items:center;gap:10px;pointer-events:auto;box-shadow:0 10px 24px rgba(0,0,0,0.45);backdrop-filter:blur(6px);opacity:1;transform:translateX(0);transition:opacity 0.22s ease,transform 0.22s ease;animation:toastIn 0.24s ease}
    .notif-avatar{width:34px;height:34px;border-radius:50%;border:2px solid var(--flee-border);object-fit:cover;flex:0 0 34px}
    .notif-text{line-height:1.25;font-size:13px;word-break:break-word}

    #flee-lobby-container{width:90%;max-width:1200px;background:rgba(10,22,40,0.95);border:2px solid var(--flee-border);border-radius:20px;padding:40px;box-shadow:0 20px 60px rgba(0,0,0,0.7)}
    #flee-lobby-header{text-align:center;margin-bottom:30px}
    #flee-lobby-header h1{font-size:48px;font-weight:900;color:var(--flee-border);margin:0;text-shadow:0 4px 20px rgba(var(--flee-border-rgb),0.55)}
    #flee-lobby-nav{display:flex;gap:15px;justify-content:center;margin-bottom:30px}
    .flee-nav-btn{padding:12px 24px;background:rgba(var(--flee-border-rgb),0.10);color:var(--flee-text);border:2px solid var(--flee-border);border-radius:12px;cursor:pointer;font-weight:700;transition:all 0.3s}
    .flee-nav-btn:hover{background:rgba(var(--flee-border-rgb),0.30);transform:translateY(-2px)}
    .flee-nav-btn.active{background:var(--flee-border);color:var(--flee-bg-solid)}
    #flee-lobby-content{min-height:400px}
    .flee-lobby-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px}
    .flee-lobby-card{background:rgba(255,255,255,0.05);border:2px solid rgba(var(--flee-border-rgb),0.30);border-radius:12px;padding:20px;cursor:pointer;transition:all 0.3s}
    .flee-lobby-card:hover{border-color:var(--flee-border);transform:scale(1.02);box-shadow:0 8px 25px rgba(var(--flee-border-rgb),0.40)}
    .flee-btn{padding:10px 20px;background:var(--flee-border);color:var(--flee-bg-solid);border:none;border-radius:10px;font-weight:700;cursor:pointer;transition:all 0.3s}
    .flee-btn:hover{background:rgba(var(--flee-border-rgb),0.75);transform:scale(1.05)}
    .flee-input{padding:12px;background:rgba(var(--flee-text-rgb),0.10);border:2px solid rgba(var(--flee-border-rgb),0.30);border-radius:10px;color:var(--flee-text);font-size:14px;width:100%}
    .flee-input:focus{outline:none;border-color:var(--flee-border)}
    
    #flee-profile-editor{display:none}
    #flee-profile-editor.active{display:block}
    #flee-profile-editor-container{max-width:450px;margin:0 auto;padding:25px;background:rgba(10,22,40,0.6);border-radius:16px;max-height:70vh;overflow-y:auto}
    #flee-profile-editor-container::-webkit-scrollbar{width:8px}
    #flee-profile-editor-container::-webkit-scrollbar-track{background:rgba(var(--flee-bg-rgb),0.75);border-radius:4px}
    #flee-profile-editor-container::-webkit-scrollbar-thumb{background:var(--flee-border);border-radius:4px}
    #flee-profile-editor-container::-webkit-scrollbar-thumb:hover{background:rgba(var(--flee-border-rgb),0.75)}
    .flee-avatar-selection{display:flex;flex-direction:column;align-items:center;gap:20px;margin:20px 0;padding:20px;background:rgba(255,255,255,0.03);border-radius:12px;border:1px solid rgba(var(--flee-border-rgb),0.20)}
    .flee-avatar-preview-container{position:relative}
    .flee-avatar-preview-img{width:120px;height:120px;border-radius:50%;border:4px solid var(--flee-border);object-fit:cover;background:rgba(var(--flee-bg-rgb),0.75);transition:all 0.3s}
    .flee-avatar-preview-img:hover{transform:scale(1.05);box-shadow:0 0 20px rgba(var(--flee-border-rgb),0.40)}
    .flee-avatar-options{width:100%;display:flex;flex-direction:column;gap:15px}
    .flee-avatar-option-group{display:flex;flex-direction:column;gap:8px}
    .flee-avatar-option-group label{color:var(--flee-text);font-size:13px;font-weight:600;opacity:0.9}
    .flee-avatar-divider{display:flex;align-items:center;gap:12px;margin:5px 0}
    .flee-avatar-divider::before,.flee-avatar-divider::after{content:'';flex:1;height:1px;background:rgba(var(--flee-border-rgb),0.30)}
    .flee-avatar-divider span{color:var(--flee-text);opacity:0.6;font-size:12px;text-transform:uppercase}
    .flee-file-upload-btn{display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 20px;background:rgba(var(--flee-border-rgb),0.15);border:2px dashed rgba(var(--flee-border-rgb),0.5);border-radius:10px;color:var(--flee-text);cursor:pointer;transition:all 0.3s;font-weight:600}
    .flee-file-upload-btn:hover{background:rgba(var(--flee-border-rgb),0.25);border-color:var(--flee-border)}
    .flee-file-upload-btn input[type="file"]{display:none}
    .flee-avatar-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:15px;margin:20px 0}
    .flee-avatar-option{width:80px;height:80px;border-radius:50%;border:3px solid transparent;cursor:pointer;object-fit:cover;transition:all 0.3s}
    .flee-avatar-option:hover{border-color:var(--flee-border);transform:scale(1.1)}
    .flee-avatar-option.selected{border-color:var(--flee-border);box-shadow:0 0 20px rgba(var(--flee-border-rgb),0.60)}
    .flee-profile-section{margin-bottom:20px}
    .flee-profile-section-title{color:var(--flee-border);font-size:14px;font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:8px}
    .flee-input-enhanced{padding:14px 16px;background:rgba(255,255,255,0.08);border:2px solid rgba(var(--flee-border-rgb),0.30);border-radius:12px;color:var(--flee-text);font-size:14px;width:100%;box-sizing:border-box;transition:all 0.3s}
    .flee-input-enhanced:focus{outline:none;border-color:var(--flee-border);background:rgba(var(--flee-text-rgb),0.12);box-shadow:0 0 15px rgba(var(--flee-border-rgb),0.2)}
    .flee-input-enhanced::placeholder{color:rgba(233,238,247,0.4)}
    .flee-save-btn{width:100%;padding:16px 24px;background:linear-gradient(135deg,var(--flee-border),rgba(var(--flee-text-rgb),0.45));color:white;border:none;border-radius:12px;font-weight:800;font-size:16px;cursor:pointer;transition:all 0.3s;box-shadow:0 4px 15px rgba(var(--flee-border-rgb),0.3);text-transform:uppercase;letter-spacing:0.5px}
    .flee-save-btn:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(var(--flee-border-rgb),0.5);background:linear-gradient(135deg,rgba(var(--flee-border-rgb),0.85),rgba(var(--flee-text-rgb),0.55))}
    
    #flee-ui{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99999;font-family:Inter,system-ui,Arial}
    #flee-box{background:var(--flee-bg-rgba);border:2px solid var(--flee-border);border-radius:10px;padding:10px;width:420px;color:var(--flee-text);box-shadow:0 8px 30px rgba(0,0,0,0.6);position:relative;cursor:grab;user-select:none}
    #flee-role{display:block;text-align:center;font-weight:800;margin-bottom:8px;font-size:18px}
    #flee-health{width:90%;height:24px;background:#222;border-radius:8px;margin:0 auto;overflow:hidden;border:1px solid rgba(255,255,255,0.06)}
    #flee-health-inner{height:100%;width:100%;background:linear-gradient(90deg,#2ecc71,#45c35f);transition:width .25s ease;display:flex;align-items:center;justify-content:center;font-weight:700}
    #flee-sprint{width:90%;height:12px;background:#1a1a1a;border-radius:6px;margin:8px auto;overflow:hidden;border:2px solid #444;box-shadow:inset 0 1px 3px rgba(0,0,0,0.5)}
    #flee-sprint-inner{height:100%;background:linear-gradient(90deg,#cc5500,#ff8c00,#ffa500);transition:width .15s linear;border-radius:4px;box-shadow:0 0 8px rgba(255,140,0,0.4)}
    #flee-sprint-inner.exhausted{animation:pulseSprint 1.2s ease-in-out infinite}
    @keyframes pulseSprint{0%,100%{opacity:0.4;box-shadow:0 0 4px rgba(255,140,0,0.2)}50%{opacity:1;box-shadow:0 0 12px rgba(255,140,0,0.8)}}
    #flee-sprint.hourglass-active{animation:hourglassPulse 1s infinite;box-shadow:0 0 15px #ffd700}
    @keyframes hourglassPulse{0%,100%{box-shadow:0 0 10px #ffd700}50%{box-shadow:0 0 25px #ffd700, 0 0 35px #ff8c00}}
    #flee-hourglass-timer{position:absolute;right:-50px;top:50%;transform:translateY(-50%);color:#ffd700;font-weight:800;font-size:12px;text-shadow:0 0 10px rgba(255,215,0,0.6);display:none}
    #flee-sprint.detective-glow #flee-sprint-inner{background:linear-gradient(90deg, #ffd700, #ffb347) !important;box-shadow:0 0 15px 5px rgba(255, 215, 0, 0.6);animation:detectiveGlowPulse 0.8s ease-in-out infinite alternate}
    @keyframes detectiveGlowPulse{from{box-shadow:0 0 10px 3px rgba(255, 215, 0, 0.4)}to{box-shadow:0 0 20px 8px rgba(255, 215, 0, 0.8)}}
    #flee-tasks{text-align:center;margin-top:8px;font-size:13px}
    .flee-tasks-info{display:flex;justify-content:space-around;align-items:center;margin-top:8px;font-size:13px}
    #flee-my-tasks{color:var(--flee-border);font-weight:600}
    #flee-global-tasks{color:#2ecc71;font-weight:600}
    #flee-coins-display{text-align:center;margin-top:8px;font-size:14px;color:#ffd700;font-weight:800}
    .flee-section{margin-top:12px;padding:10px;background:rgba(255,255,255,0.03);border-radius:10px;border:1px solid rgba(var(--flee-border-rgb),0.15)}
    .flee-section-title{font-size:12px;font-weight:700;color:var(--flee-border);margin-bottom:8px;text-align:center;text-transform:uppercase;letter-spacing:0.5px}
    #flee-players{display:flex;flex-wrap:wrap;gap:8px;padding:5px;max-height:150px;overflow-y:auto;justify-content:center}
    #flee-players::-webkit-scrollbar{width:4px}
    #flee-players::-webkit-scrollbar-track{background:rgba(0,0,0,0.2);border-radius:2px}
    #flee-players::-webkit-scrollbar-thumb{background:var(--flee-border);border-radius:2px}
    .flee-player{display:flex;flex-direction:column;align-items:center;width:50px;font-size:10px;text-align:center;position:relative;cursor:pointer;transition:transform 0.2s,opacity 0.2s}
    .flee-player img{width:40px;height:40px;border-radius:50%;border:2px solid var(--flee-border);object-fit:cover;transition:all 0.2s}
    .flee-player .flee-player-name{margin-top:3px;color:var(--flee-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:50px}
    .flee-player.dead img{opacity:0.6;filter:grayscale(100%)}
    .flee-player.dead .flee-player-name{opacity:0.6;text-decoration:line-through}
    .flee-player .dead-x{position:absolute;top:-4px;right:-4px;background:rgba(0,0,0,0.7);color:#ff4444;font-weight:900;padding:2px 5px;border-radius:50%;font-size:12px;z-index:5}
    .flee-player.disconnected{opacity:0.4}
    .flee-player.disconnected img{border-color:#666;filter:grayscale(50%)}
    .flee-player.disconnected .flee-player-name{font-style:italic}
    
    #flee-center-msg{position:fixed;inset:0;z-index:100010;background:rgba(0,0,0,0.85);display:none;align-items:center;justify-content:center}
    #flee-center-msg-content{background:linear-gradient(135deg,rgba(var(--flee-border-rgb),0.22),var(--flee-bg-solid));border:3px solid var(--flee-border);border-radius:20px;padding:40px;max-width:500px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.9)}
    #center-role{font-size:56px;font-weight:900;color:var(--flee-border);margin:20px 0;text-shadow:0 4px 20px rgba(var(--flee-border-rgb),0.6);transition:all 0.15s}
    
    .flee-roulette-container{position:relative;height:120px;overflow:hidden;border:2px solid var(--flee-border);border-radius:12px;background:rgba(0,0,0,0.5);margin:20px 0}
    .flee-roulette-track{display:flex;gap:20px;align-items:center;height:100%;transition:transform 0.1s linear}
    .flee-roulette-item{min-width:200px;font-size:32px;font-weight:900;text-align:center;padding:20px;border-radius:10px}
    .flee-roulette-pointer{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:4px;height:80%;background:var(--flee-border);box-shadow:0 0 20px var(--flee-border);z-index:10}
    
    #flee-frozen-overlay{position:fixed;inset:0;background:rgba(135,206,250,0.3);z-index:99998;display:none;align-items:center;justify-content:center;pointer-events:none}
    #flee-frozen-msg{background:rgba(0,100,200,0.9);color:white;padding:20px 30px;border-radius:15px;font-weight:800;font-size:20px}
    #flee-blocked-overlay{position:fixed;inset:0;background:rgba(75,0,130,0.4);z-index:99997;display:none;align-items:center;justify-content:center;pointer-events:none}
    #flee-blocked-msg{background:rgba(128,0,128,0.9);color:white;padding:20px 30px;border-radius:15px;font-weight:800;font-size:20px;text-align:center}
    #flee-blocked-timer{font-size:36px;margin-bottom:10px}
    
    #flee-shop-modal{position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:100020;display:none;align-items:center;justify-content:center}
    #flee-shop-content{background:linear-gradient(135deg,rgba(var(--flee-border-rgb),0.22),var(--flee-bg-solid));border:3px solid var(--flee-border);border-radius:20px;padding:30px;max-width:600px;width:90%}
    .flee-shop-item{background:rgba(255,255,255,0.05);border:2px solid rgba(var(--flee-border-rgb),0.30);border-radius:12px;padding:15px;margin:10px 0;display:flex;justify-content:space-between;align-items:center}
    .flee-shop-item:hover{border-color:var(--flee-border);background:rgba(var(--flee-border-rgb),0.10)}
    
    .flee-notification.is-leaving{opacity:0;transform:translateX(12px)}
    @keyframes slideIn{from{transform:translateX(400px);opacity:0}to{transform:translateX(0);opacity:1}}
    @keyframes toastIn{from{transform:translateX(20px);opacity:0}to{transform:translateX(0);opacity:1}}
    
    .flee-effect-buff{animation:buffPulse 0.5s ease}
    @keyframes buffPulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.5) drop-shadow(0 0 10px var(--flee-border))}}
    
    #flee-waiting-room{position:fixed;inset:0;z-index:100001;background:linear-gradient(135deg,var(--flee-bg-solid),rgba(var(--flee-border-rgb),0.20));display:none;align-items:center;justify-content:center;font-family:Inter,system-ui}
    #flee-waiting-container{width:90%;max-width:700px;background:rgba(10,22,40,0.95);border:2px solid var(--flee-border);border-radius:20px;padding:40px;box-shadow:0 20px 60px rgba(0,0,0,0.7)}
    #flee-waiting-header{text-align:center;margin-bottom:25px}
    #flee-waiting-header h2{font-size:32px;font-weight:900;color:var(--flee-border);margin:0;text-shadow:0 4px 20px rgba(var(--flee-border-rgb),0.55)}
    #flee-waiting-header p{color:var(--flee-text);margin:10px 0 0 0;opacity:0.8}
    #flee-waiting-config{display:grid;grid-template-columns:repeat(3,1fr);gap:15px;margin-bottom:25px;padding:15px;background:rgba(255,255,255,0.05);border-radius:12px}
    .flee-config-item{text-align:center;color:var(--flee-text)}
    .flee-config-item span{display:block;font-size:24px;font-weight:800;color:var(--flee-border)}
    .flee-config-item small{opacity:0.7}
    #flee-waiting-players{margin:20px 0}
    #flee-waiting-players h3{color:var(--flee-text);margin-bottom:15px;text-align:center}
    #flee-waiting-players-list{display:flex;flex-wrap:wrap;gap:15px;justify-content:center}
    .flee-waiting-player{display:flex;flex-direction:column;align-items:center;padding:10px 15px;background:rgba(255,255,255,0.05);border:2px solid rgba(var(--flee-border-rgb),0.30);border-radius:12px;min-width:100px}
    .flee-waiting-player.creator{border-color:#ffd700;background:rgba(255,215,0,0.1)}
    .flee-waiting-player img{width:50px;height:50px;border-radius:50%;border:2px solid var(--flee-border);object-fit:cover;margin-bottom:8px}
    .flee-waiting-player.creator img{border-color:#ffd700}
    .flee-waiting-player span{color:var(--flee-text);font-weight:600;font-size:13px}
    .flee-waiting-player small{color:#ffd700;font-size:11px;margin-top:4px}
    #flee-waiting-actions{text-align:center;margin-top:25px}
    #flee-start-game-btn{padding:15px 40px;background:linear-gradient(135deg,#2ecc71,#27ae60);color:white;border:none;border-radius:12px;font-weight:800;font-size:18px;cursor:pointer;transition:all 0.3s;box-shadow:0 4px 15px rgba(46,204,113,0.4)}
    #flee-start-game-btn:hover{transform:scale(1.05);box-shadow:0 6px 20px rgba(46,204,113,0.6)}
    #flee-start-game-btn:disabled{background:linear-gradient(135deg,#555,#444);cursor:not-allowed;box-shadow:none}
    #flee-leave-lobby-btn{padding:12px 30px;background:rgba(231,76,60,0.2);color:#e74c3c;border:2px solid #e74c3c;border-radius:12px;font-weight:700;cursor:pointer;transition:all 0.3s;margin-left:15px}
    #flee-leave-lobby-btn:hover{background:#e74c3c;color:white}
    #flee-waiting-status{color:var(--flee-text);margin-top:15px;text-align:center;opacity:0.8}
    
    #flee-top-left-reset{position:absolute;left:8px;top:8px;width:26px;height:26px;border-radius:6px;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;cursor:pointer;font-weight:800;font-size:12px;color:var(--flee-text);transition:all 0.2s}
    #flee-top-left-reset:hover{background:rgba(255,255,255,0.15)}
    #flee-top-left-reset-screen{position:fixed;left:8px;top:8px;width:26px;height:26px;border-radius:6px;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;cursor:pointer;font-weight:800;font-size:12px;z-index:100010;color:var(--flee-text);transition:all 0.2s}
    #flee-top-left-reset-screen:hover{background:rgba(255,255,255,0.15)}
    #flee-customize-btn{position:absolute;right:8px;top:8px;width:30px;height:30px;border-radius:6px;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;cursor:pointer;font-weight:700;font-size:16px;transition:all 0.2s}
    #flee-customize-btn:hover{background:rgba(255,255,255,0.15)}
    
    #flee-custom-modal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:200000;background:rgba(0,0,0,0.6)}
    #flee-custom-modal .box{background:#0b1220;padding:20px;border-radius:12px;color:#fff;width:560px;max-width:95%;border:2px solid var(--flee-border);box-shadow:0 20px 60px rgba(0,0,0,0.8)}
    #flee-custom-modal h3{margin:0 0 15px 0;font-size:18px;color:var(--flee-border)}
    .flee-form-row{display:flex;gap:10px;align-items:center;margin-top:12px}
    .flee-form-row label{min-width:100px;font-size:13px;color:#cfd8e3}
    .flee-form-row input[type="color"]{width:50px;height:32px;border:none;border-radius:6px;cursor:pointer;background:transparent}
    .flee-form-row input[type="range"]{flex:1;height:8px;border-radius:4px;background:#333;appearance:none;cursor:pointer}
    .flee-form-row input[type="range"]::-webkit-slider-thumb{appearance:none;width:18px;height:18px;border-radius:50%;background:var(--flee-border);cursor:pointer}
    .flee-preview{margin-top:12px;padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02)}
    .flee-small{font-size:13px;padding:8px 14px;border-radius:8px;cursor:pointer;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.05);color:#fff;transition:all 0.2s}
    .flee-small:hover{background:rgba(255,255,255,0.15);border-color:var(--flee-border)}
    
    #flee-toast{position:fixed;bottom:18px;right:18px;background:rgba(10,14,22,0.95);color:#fff;padding:10px 16px;border-radius:8px;z-index:300000;box-shadow:0 6px 18px rgba(0,0,0,0.6);border-left:3px solid var(--flee-border);opacity:0;transition:opacity 0.3s}
    
    .flee-player{cursor:pointer;transition:transform 0.2s,box-shadow 0.2s}
    .flee-player:hover{transform:scale(1.1);z-index:10}
    .flee-player:hover img{box-shadow:0 4px 12px rgba(var(--flee-border-rgb),0.5)}
    .flee-player.protected img{border-color:#3399ff!important;box-shadow:0 0 12px rgba(51,153,255,0.6)}
    .flee-player .protection-indicator{position:absolute;top:-4px;right:-4px;font-size:12px;z-index:5}
    
    #flee-profile-modal{position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.85);display:none;align-items:center;justify-content:center;font-family:Inter,system-ui}
    #flee-profile-modal.active{display:flex}
    #flee-profile-content{background:linear-gradient(135deg,rgba(var(--flee-border-rgb),0.22),var(--flee-bg-solid));border:3px solid var(--flee-border);border-radius:20px;padding:30px;max-width:400px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.9);position:relative}
    #flee-profile-close{position:absolute;top:10px;right:15px;font-size:24px;cursor:pointer;color:var(--flee-text);opacity:0.7;transition:opacity 0.2s}
    #flee-profile-close:hover{opacity:1}
    #flee-profile-avatar{width:120px;height:120px;border-radius:50%;border:4px solid var(--flee-border);object-fit:cover;margin-bottom:15px}
    #flee-profile-name{font-size:24px;font-weight:900;color:var(--flee-text);margin-bottom:5px}
    #flee-profile-desc{font-size:14px;color:var(--flee-text);opacity:0.8;margin-bottom:10px;min-height:20px}
    #flee-profile-role{font-size:16px;font-weight:700;padding:6px 12px;border-radius:8px;display:inline-block;margin-bottom:10px}
    #flee-profile-status{font-size:14px;margin-bottom:20px}
    #flee-profile-actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:15px}
    
    .flee-action-btn{padding:8px 12px;border-radius:9px;font-weight:700;font-size:12px;line-height:1;cursor:pointer;border:1px solid rgba(var(--flee-border-rgb),0.45);background:linear-gradient(135deg,rgba(29,44,70,0.95),rgba(18,30,50,0.92));color:var(--flee-text);transition:transform 0.16s ease,box-shadow 0.16s ease,filter 0.16s ease,opacity 0.16s ease;display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:28px;touch-action:manipulation;user-select:none;-webkit-user-select:none}
    .flee-action-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 14px rgba(0,0,0,0.35);filter:saturate(1.1)}
    .flee-action-btn.is-pressed:not(:disabled){transform:translateY(0);box-shadow:0 2px 6px rgba(0,0,0,0.35);filter:brightness(0.96)}
    .flee-action-btn:disabled{opacity:0.58;cursor:not-allowed;filter:saturate(0.7);box-shadow:none;transform:none;border-color:rgba(var(--flee-border-rgb),0.45)}
    .flee-action-btn.attack{background:linear-gradient(135deg,#ff4444,#cc3333);color:white;border-color:#ff6666}
    .flee-action-btn.heal{background:linear-gradient(135deg,#44ff88,#27ae60);color:white;border-color:#56d364}
    .flee-action-btn.investigate{background:linear-gradient(135deg,#ffcc00,#f39c12);color:#333;border-color:#ffd700}
    .flee-action-btn.protect{background:linear-gradient(135deg,#3399ff,#2980b9);color:white;border-color:#5dade2}
    .flee-action-btn.freeze{background:linear-gradient(135deg,#87ceeb,#5bc0de);color:#333;border-color:#a8e0f0}
    .flee-action-btn.exterminate{background:linear-gradient(135deg,#8a2be2,#6a1b9a);color:white;border-color:#9c27b0}
    .flee-action-btn.reveal{background:linear-gradient(135deg,#daa520,#b8860b);color:white;border-color:#f0c040}
    .flee-action-btn.shoot{background:linear-gradient(135deg,#8b4513,#654321);color:white;border-color:#a0522d}
    .flee-action-btn.build{background:linear-gradient(135deg,#a0522d,#8b4513);color:white;border-color:#cd853f}
    .flee-action-btn.joker{background:linear-gradient(135deg,#aa66ff,#8a2be2);color:white;border-color:#bb77ff}
    .flee-action-btn.block{background:linear-gradient(135deg,#6b2f90,#4b1f69);color:white;border-color:#8d52b0}
    .flee-action-btn.jorguin_attack{background:linear-gradient(135deg,#552233,#381522);color:white;border-color:#7f3a54}
    .flee-action-btn.spy_investigate{background:linear-gradient(135deg,#5b6d7d,#3f4d59);color:white;border-color:#7f94a8}
    .flee-action-btn.spy_attack{background:linear-gradient(135deg,#2c3e50,#1f2b38);color:white;border-color:#4e6a85}
    .flee-proximity-window .flee-action-btn{min-height:24px;padding:6px 9px;font-size:11px;border-radius:8px}
    
    #flee-joker-floating{position:fixed;left:12px;bottom:78px;z-index:100700;padding:10px 14px;border-radius:10px;background:linear-gradient(135deg,#9b59b6,#8e44ad);color:#fff;border:2px solid rgba(0,0,0,0.2);cursor:pointer;font-weight:900;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,0.45);transition:all 0.3s}
    #flee-joker-floating:hover:not(:disabled){transform:scale(1.05);box-shadow:0 10px 30px rgba(155,89,182,0.5)}
    #flee-joker-floating:disabled{opacity:0.7;cursor:not-allowed}
    
    #flee-carpenter-floating{position:fixed;left:12px;bottom:140px;z-index:100700;padding:10px 14px;border-radius:10px;background:linear-gradient(135deg,#8B4513,#A0522D);color:#fff;border:2px solid rgba(0,0,0,0.2);cursor:pointer;font-weight:900;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,0.45);transition:all 0.3s}
    #flee-carpenter-floating:hover:not(:disabled){transform:scale(1.05);box-shadow:0 10px 30px rgba(139,69,19,0.5)}
    #flee-carpenter-floating:disabled{opacity:0.5;cursor:not-allowed}
    
    .joker-balloon{position:fixed;pointer-events:none;z-index:100040;will-change:transform,opacity;font-size:48px;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.3))}
    @keyframes balloonFloat{0%{transform:translateY(100vh) rotate(0deg);opacity:0}10%{opacity:1}90%{opacity:1}100%{transform:translateY(-150px) rotate(360deg);opacity:0}}
    
    #flee-bodyguard-indicator{position:fixed;bottom:20px;left:20px;z-index:100055;padding:12px 20px;border-radius:12px;background:linear-gradient(135deg,#3399ff,#2980b9);color:white;font-weight:700;box-shadow:0 6px 20px rgba(51,153,255,0.5);display:none}
    #flee-bodyguard-indicator.active{display:flex;align-items:center;gap:10px}
    
    .flee-flash-overlay{position:fixed;inset:0;z-index:100080;pointer-events:none;animation:flashFade 0.5s ease-out forwards}
    @keyframes flashFade{0%{opacity:0.6}100%{opacity:0}}
    
    #flee-splintered-overlay{animation:splinteredPulse 1s ease-in-out infinite alternate}
    @keyframes splinteredPulse{from{background:radial-gradient(circle at center,rgba(139,69,19,0.2),rgba(205,133,63,0.4))}to{background:radial-gradient(circle at center,rgba(139,69,19,0.4),rgba(205,133,63,0.6))}}
    
    #flee-ready-overlay{position:fixed;bottom:20px;right:20px;z-index:100015;display:none;font-family:Inter,system-ui;pointer-events:auto}
    #flee-ready-content{background:rgba(10,22,40,0.95);border:2px solid var(--flee-border);border-radius:12px;padding:15px 20px;width:280px;text-align:center;box-shadow:0 8px 25px rgba(0,0,0,0.6);animation:readySlideIn 0.3s ease}
    @keyframes readySlideIn{from{opacity:0;transform:translateX(50px)}to{opacity:1;transform:translateX(0)}}
    #flee-ready-icon{font-size:32px;margin-bottom:8px}
    #flee-ready-title{font-size:16px;font-weight:800;color:var(--flee-border);margin-bottom:8px;text-shadow:0 2px 10px rgba(var(--flee-border-rgb),0.4)}
    #flee-ready-message{font-size:12px;color:var(--flee-text);margin-bottom:12px;line-height:1.4;opacity:0.9}
    #flee-ready-counter{font-size:12px;color:var(--flee-text);margin-bottom:10px;opacity:0.8}
    #flee-ready-counter span{font-weight:800;color:#2ecc71}
    #flee-ready-btn{padding:10px 24px;background:linear-gradient(135deg,#2ecc71,#27ae60);color:white;border:none;border-radius:10px;font-weight:800;font-size:14px;cursor:pointer;transition:all 0.3s;box-shadow:0 4px 12px rgba(46,204,113,0.4);text-transform:uppercase;letter-spacing:0.5px}
    #flee-ready-btn:hover:not(:disabled){transform:scale(1.05);box-shadow:0 6px 18px rgba(46,204,113,0.6);background:linear-gradient(135deg,#3ddc84,#2ecc71)}
    #flee-ready-btn:disabled{background:linear-gradient(135deg,#555,#444);cursor:not-allowed;box-shadow:none;transform:none}
    #flee-ready-btn.clicked{background:linear-gradient(135deg,#3498db,#2980b9);box-shadow:0 4px 12px rgba(52,152,219,0.4)}
    #flee-ready-waiting{display:none;color:#3498db;font-weight:700;margin-top:10px;font-size:11px}
    #flee-ready-waiting.visible{display:block;animation:pulse 1.5s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
    
    .flee-role-config{margin-top:20px;padding:15px;background:rgba(255,255,255,0.05);border-radius:12px;border:1px solid rgba(var(--flee-border-rgb),0.20)}
    .flee-role-config-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;padding-bottom:10px;border-bottom:1px solid rgba(var(--flee-border-rgb),0.2)}
    
    #flee-inventory-items{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:5px}
    .flee-inventory-item{display:flex;flex-direction:column;align-items:center;padding:8px 10px;background:rgba(var(--flee-border-rgb),0.10);border:2px solid rgba(var(--flee-border-rgb),0.30);border-radius:10px;cursor:pointer;transition:all 0.2s;min-width:70px}
    .flee-inventory-item:hover{border-color:var(--flee-border);background:rgba(var(--flee-border-rgb),0.20);transform:scale(1.05)}
    .flee-inventory-item.passive{border-color:rgba(170,102,255,0.5);background:rgba(170,102,255,0.1)}
    .flee-inventory-item .item-emoji{font-size:20px}
    .flee-inventory-item .item-name{font-size:9px;color:var(--flee-text);margin-top:3px;text-align:center}
    .flee-inventory-item .item-count{font-size:10px;color:#ffd700;font-weight:800;margin-top:2px}
    .flee-inventory-item.active-effect{animation:activeItemPulse 1.5s infinite;border-color:#2ecc71}
    @keyframes activeItemPulse{0%,100%{box-shadow:0 0 5px rgba(46,204,113,0.3)}50%{box-shadow:0 0 15px rgba(46,204,113,0.6)}}
    
    #flee-smokebomb-overlay{position:fixed;inset:0;background:rgba(128,128,128,0.85);z-index:99997;display:none;align-items:center;justify-content:center;pointer-events:none;backdrop-filter:blur(10px)}
    #flee-smokebomb-msg{background:rgba(80,80,80,0.9);color:white;padding:20px 30px;border-radius:15px;font-weight:800;font-size:20px;text-shadow:0 2px 4px rgba(0,0,0,0.5)}
    
    #flee-target-select-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:100025;display:none;align-items:center;justify-content:center}
    #flee-target-select-content{background:linear-gradient(135deg,rgba(var(--flee-border-rgb),0.22),var(--flee-bg-solid));border:3px solid var(--flee-border);border-radius:20px;padding:25px;max-width:400px;width:90%;text-align:center}
    #flee-target-select-title{font-size:20px;font-weight:800;color:var(--flee-border);margin-bottom:20px}
    #flee-target-select-list{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;max-height:300px;overflow-y:auto;padding:10px}
    .flee-target-option{display:flex;flex-direction:column;align-items:center;padding:10px 15px;background:rgba(255,255,255,0.05);border:2px solid rgba(var(--flee-border-rgb),0.30);border-radius:12px;cursor:pointer;transition:all 0.2s;min-width:80px}
    .flee-target-option:hover{border-color:var(--flee-border);background:rgba(var(--flee-border-rgb),0.20);transform:scale(1.05)}
    .flee-target-option img{width:50px;height:50px;border-radius:50%;border:2px solid var(--flee-border);object-fit:cover;margin-bottom:5px}
    .flee-target-option span{color:var(--flee-text);font-size:12px;font-weight:600}
    #flee-target-select-cancel{margin-top:20px;padding:12px 25px;background:rgba(231,76,60,0.2);color:#e74c3c;border:2px solid #e74c3c;border-radius:12px;font-weight:700;cursor:pointer;transition:all 0.3s}
    #flee-target-select-cancel:hover{background:#e74c3c;color:white}
    .flee-role-config-header h3{margin:0;color:var(--flee-border);font-size:16px}
    .flee-role-config-toggle{padding:6px 12px;background:rgba(var(--flee-border-rgb),0.20);border:1px solid var(--flee-border);border-radius:6px;color:var(--flee-text);cursor:pointer;font-size:12px;transition:all 0.2s}
    .flee-role-config-toggle:hover{background:rgba(var(--flee-border-rgb),0.40)}
    .flee-role-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;max-height:350px;overflow-y:auto;padding-right:5px}
    .flee-role-list::-webkit-scrollbar{width:6px}
    .flee-role-list::-webkit-scrollbar-track{background:rgba(var(--flee-bg-rgb),0.75);border-radius:3px}
    .flee-role-list::-webkit-scrollbar-thumb{background:var(--flee-border);border-radius:3px}
    .flee-role-item{display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(255,255,255,0.03);border:1px solid rgba(var(--flee-border-rgb),0.15);border-radius:8px;transition:all 0.2s}
    .flee-role-item:hover{background:rgba(255,255,255,0.06);border-color:rgba(var(--flee-border-rgb),0.3)}
    .flee-role-item.disabled{opacity:0.5}
    .flee-role-item.disabled .flee-role-controls{pointer-events:none}
    .flee-role-name{flex:1;display:flex;align-items:center;gap:8px;color:var(--flee-text);font-weight:600;font-size:13px}
    .flee-role-name input[type="checkbox"]{width:16px;height:16px;cursor:pointer;accent-color:var(--flee-border)}
    .flee-role-controls{display:flex;align-items:center;gap:8px}
    .flee-role-count{width:50px;padding:5px 8px;background:rgba(var(--flee-text-rgb),0.10);border:1px solid rgba(var(--flee-border-rgb),0.3);border-radius:6px;color:var(--flee-text);font-size:12px;text-align:center}
    .flee-role-count:focus{outline:none;border-color:var(--flee-border)}
    .flee-role-required{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--flee-text);opacity:0.8}
    .flee-role-required input[type="checkbox"]{width:14px;height:14px;cursor:pointer;accent-color:#ffd700}
    .flee-role-badge{padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase}
    .flee-role-badge.evil{background:rgba(255,68,68,0.2);color:#ff6b6b}
    .flee-role-badge.good{background:rgba(68,255,136,0.2);color:#56d364}
    
    #flee-lobby-toggle{position:fixed;right:12px;bottom:12px;z-index:100010;width:28px;height:28px;border-radius:6px;background:rgba(0,0,0,0.6);color:#fff;border:1px solid rgba(255,255,255,0.2);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:all 0.3s}
    #flee-lobby-toggle:hover{background:rgba(var(--flee-border-rgb),0.8);transform:scale(1.1)}
    
    #flee-create-lobby{max-height:70vh;overflow-y:auto;padding-right:10px}
    #flee-create-lobby::-webkit-scrollbar{width:8px}
    #flee-create-lobby::-webkit-scrollbar-track{background:rgba(var(--flee-bg-rgb),0.75);border-radius:4px}
    #flee-create-lobby::-webkit-scrollbar-thumb{background:var(--flee-border);border-radius:4px}
    #flee-create-lobby::-webkit-scrollbar-thumb:hover{background:rgba(var(--flee-border-rgb),0.75)}
    
    .flee-section-header{display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;user-select:none;transition:all 0.2s}
    .flee-section-header:hover{opacity:0.8}
    .flee-section-toggle{font-size:10px;transition:transform 0.3s}
    .flee-section-toggle.collapsed{transform:rotate(-90deg)}
    .flee-section-content{transition:max-height 0.3s ease,opacity 0.3s ease,padding 0.3s ease}
    .flee-section-content.collapsed{max-height:0!important;opacity:0;padding:0!important;overflow:hidden}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

function createLobbyScreen(){
  const screen = document.createElement('div');
  screen.id = 'flee-lobby-screen';
  screen.innerHTML = `
    <div id="flee-lobby-container">
      <div id="flee-lobby-header">
        <h1>🎭 Murder at the Meeting</h1>
      </div>
      <div id="flee-lobby-nav">
        <button class="flee-nav-btn active" data-tab="join">Unirse a Partida</button>
        <button class="flee-nav-btn" data-tab="create">Crear Partida</button>
        <button class="flee-nav-btn" data-tab="profile">Editar Perfil</button>
        <button class="flee-nav-btn" data-tab="roles">Información de Roles</button>
      </div>
      <div id="flee-lobby-content">
        <div id="flee-join-lobby" class="flee-tab-content active">
          <h2 style="color:var(--flee-text);text-align:center">Lobbies Disponibles</h2>
          <div id="flee-lobby-list" class="flee-lobby-list"></div>
        </div>
        <div id="flee-create-lobby" class="flee-tab-content" style="display:none">
          <h2 style="color:var(--flee-text);text-align:center">Crear Nueva Partida</h2>
          <div style="max-width:700px;margin:0 auto">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
              <div>
                <label style="color:var(--flee-text);display:block;margin:15px 0 5px">Número de jugadores:</label>
                <input type="number" id="lobby-max-players" class="flee-input" value="8" min="2" max="20">
              </div>
              <div>
                <label style="color:var(--flee-text);display:block;margin:15px 0 5px">Número de tareas:</label>
                <input type="number" id="lobby-tasks" class="flee-input" value="5" min="1" max="20">
              </div>
            </div>
            <label style="color:var(--flee-text);display:block;margin:15px 0 5px">Contraseña (opcional):</label>
            <input type="password" id="lobby-password" class="flee-input" placeholder="Dejar vacío para público">
            <label style="color:var(--flee-text);display:block;margin:15px 0 5px">
              <input type="checkbox" id="lobby-coins"> Activar monedas
            </label>
            
            <div class="flee-role-config">
              <div class="flee-role-config-header">
                <h3>⚙️ Configuración de Roles</h3>
                <button type="button" class="flee-role-config-toggle" id="toggle-all-roles">Activar/Desactivar Todos</button>
              </div>
              <div class="flee-role-list" id="role-config-list">
                <div class="flee-role-item" data-role="killer">
                  <div class="flee-role-name">
                    <input type="checkbox" class="role-enabled" data-role="killer" checked>
                    <span>🔪 Asesino</span>
                    <span class="flee-role-badge evil">Malo</span>
                  </div>
                  <div class="flee-role-controls">
                    <input type="number" class="flee-role-count role-count" data-role="killer" value="1" min="0" max="10">
                    <label class="flee-role-required">
                      <input type="checkbox" class="role-required" data-role="killer" checked>
                      Obligatorio
                    </label>
                  </div>
                </div>
                <div class="flee-role-item" data-role="medic">
                  <div class="flee-role-name">
                    <input type="checkbox" class="role-enabled" data-role="medic" checked>
                    <span>💊 Médico</span>
                    <span class="flee-role-badge good">Bueno</span>
                  </div>
                  <div class="flee-role-controls">
                    <input type="number" class="flee-role-count role-count" data-role="medic" value="1" min="0" max="10">
                    <label class="flee-role-required">
                      <input type="checkbox" class="role-required" data-role="medic">
                      Obligatorio
                    </label>
                  </div>
                </div>
                <div class="flee-role-item" data-role="innocent">
                  <div class="flee-role-name">
                    <input type="checkbox" class="role-enabled" data-role="innocent" checked>
                    <span>😇 Inocente</span>
                    <span class="flee-role-badge good">Bueno</span>
                  </div>
                  <div class="flee-role-controls">
                    <input type="number" class="flee-role-count role-count" data-role="innocent" value="2" min="0" max="10">
                    <label class="flee-role-required">
                      <input type="checkbox" class="role-required" data-role="innocent">
                      Obligatorio
                    </label>
                  </div>
                </div>
                <div class="flee-role-item" data-role="detective">
                  <div class="flee-role-name">
                    <input type="checkbox" class="role-enabled" data-role="detective" checked>
                    <span>🔍 Detective</span>
                    <span class="flee-role-badge good">Bueno</span>
                  </div>
                  <div class="flee-role-controls">
                    <input type="number" class="flee-role-count role-count" data-role="detective" value="1" min="0" max="10">
                    <label class="flee-role-required">
                      <input type="checkbox" class="role-required" data-role="detective">
                      Obligatorio
                    </label>
                  </div>
                </div>
                <div class="flee-role-item" data-role="joker">
                  <div class="flee-role-name">
                    <input type="checkbox" class="role-enabled" data-role="joker" checked>
                    <span>🃏 Joker</span>
                    <span class="flee-role-badge evil">Malo</span>
                  </div>
                  <div class="flee-role-controls">
                    <input type="number" class="flee-role-count role-count" data-role="joker" value="1" min="0" max="10">
                    <label class="flee-role-required">
                      <input type="checkbox" class="role-required" data-role="joker">
                      Obligatorio
                    </label>
                  </div>
                </div>
                <div class="flee-role-item" data-role="bodyguard">
                  <div class="flee-role-name">
                    <input type="checkbox" class="role-enabled" data-role="bodyguard" checked>
                    <span>🛡️ Guardaespaldas</span>
                    <span class="flee-role-badge good">Bueno</span>
                  </div>
                  <div class="flee-role-controls">
                    <input type="number" class="flee-role-count role-count" data-role="bodyguard" value="1" min="0" max="10">
                    <label class="flee-role-required">
                      <input type="checkbox" class="role-required" data-role="bodyguard">
                      Obligatorio
                    </label>
                  </div>
                </div>
                <div class="flee-role-item" data-role="psychic">
                  <div class="flee-role-name">
                    <input type="checkbox" class="role-enabled" data-role="psychic" checked>
                    <span>👽 Psíquico</span>
                    <span class="flee-role-badge good">Bueno</span>
                  </div>
                  <div class="flee-role-controls">
                    <input type="number" class="flee-role-count role-count" data-role="psychic" value="1" min="0" max="10">
                    <label class="flee-role-required">
                      <input type="checkbox" class="role-required" data-role="psychic">
                      Obligatorio
                    </label>
                  </div>
                </div>
                <div class="flee-role-item" data-role="sheriff">
                  <div class="flee-role-name">
                    <input type="checkbox" class="role-enabled" data-role="sheriff" checked>
                    <span>⭐ Alguacil</span>
                    <span class="flee-role-badge good">Bueno</span>
                  </div>
                  <div class="flee-role-controls">
                    <input type="number" class="flee-role-count role-count" data-role="sheriff" value="1" min="0" max="10">
                    <label class="flee-role-required">
                      <input type="checkbox" class="role-required" data-role="sheriff">
                      Obligatorio
                    </label>
                  </div>
                </div>
                <div class="flee-role-item" data-role="jorguin">
                  <div class="flee-role-name">
                    <input type="checkbox" class="role-enabled" data-role="jorguin" checked>
                    <span>🖤 Jorguín</span>
                    <span class="flee-role-badge evil">Malo</span>
                  </div>
                  <div class="flee-role-controls">
                    <input type="number" class="flee-role-count role-count" data-role="jorguin" value="1" min="0" max="10">
                    <label class="flee-role-required">
                      <input type="checkbox" class="role-required" data-role="jorguin">
                      Obligatorio
                    </label>
                  </div>
                </div>
                <div class="flee-role-item" data-role="spy">
                  <div class="flee-role-name">
                    <input type="checkbox" class="role-enabled" data-role="spy" checked>
                    <span>🐈‍⬛ Espía</span>
                    <span class="flee-role-badge evil">Malo</span>
                  </div>
                  <div class="flee-role-controls">
                    <input type="number" class="flee-role-count role-count" data-role="spy" value="1" min="0" max="10">
                    <label class="flee-role-required">
                      <input type="checkbox" class="role-required" data-role="spy">
                      Obligatorio
                    </label>
                  </div>
                </div>
                <div class="flee-role-item" data-role="carpenter">
                  <div class="flee-role-name">
                    <input type="checkbox" class="role-enabled" data-role="carpenter" checked>
                    <span>🔨 Carpintero</span>
                    <span class="flee-role-badge good">Bueno</span>
                  </div>
                  <div class="flee-role-controls">
                    <input type="number" class="flee-role-count role-count" data-role="carpenter" value="1" min="0" max="10">
                    <label class="flee-role-required">
                      <input type="checkbox" class="role-required" data-role="carpenter">
                      Obligatorio
                    </label>
                  </div>
                </div>
              </div>
            </div>
            
            <button id="create-lobby-btn" class="flee-btn" style="width:100%;margin-top:20px">Crear Lobby</button>
          </div>
        </div>
        <div id="flee-profile-editor" class="flee-tab-content">
          <h2 style="color:var(--flee-text);text-align:center;margin-bottom:20px">✨ Editar Perfil</h2>
          <div id="flee-profile-editor-container">
            <div class="flee-profile-section">
              <div class="flee-profile-section-title">👤 Información Personal</div>
              <input type="text" id="profile-name" class="flee-input-enhanced" placeholder="Tu nombre de jugador..." value="">
              <textarea id="profile-description" class="flee-input-enhanced" rows="3" style="resize:vertical;margin-top:12px" placeholder="Escribe una descripción sobre ti..."></textarea>
            </div>
            
            <div class="flee-profile-section">
              <div class="flee-profile-section-title">🖼️ Avatar</div>
              <div class="flee-avatar-selection">
                <div class="flee-avatar-preview-container">
                  <img id="profile-avatar-preview" class="flee-avatar-preview-img" src="" alt="Vista previa del avatar">
                </div>
                <div class="flee-avatar-options">
                  <div class="flee-avatar-option-group">
                    <label>URL de imagen:</label>
                    <input type="text" id="profile-avatar-url" class="flee-input-enhanced" placeholder="https://ejemplo.com/imagen.png" value="">
                  </div>
                  <div class="flee-avatar-divider">
                    <span>o</span>
                  </div>
                  <div class="flee-avatar-option-group">
                    <label>Subir archivo:</label>
                    <label class="flee-file-upload-btn">
                      <span>📁 Seleccionar imagen</span>
                      <input type="file" id="profile-avatar-file" accept="image/*">
                    </label>
                    <div id="profile-file-name" style="font-size:12px;color:var(--flee-text);opacity:0.6;text-align:center;margin-top:5px"></div>
                  </div>
                </div>
              </div>
            </div>
            
            <button id="save-profile-btn" class="flee-save-btn">💾 Guardar Perfil</button>
          </div>
        </div>
        <div id="flee-roles-info" class="flee-tab-content" style="display:none">
          <h2 style="color:var(--flee-text);text-align:center">Información de Roles</h2>
          <div style="max-width:800px;max-height:500px;overflow-y:auto;margin:0 auto;color:var(--flee-text);line-height:1.6;padding:0 10px">
            <div style="margin:20px 0;padding:15px;background:rgba(255,68,68,0.1);border-left:4px solid #ff4444;border-radius:8px">
              <h3>🔪 Asesino</h3>
              <p>Tu objetivo es eliminar a todos. Puedes atacar con daño considerable.</p>
            </div>
            <div style="margin:20px 0;padding:15px;background:rgba(68,255,136,0.1);border-left:4px solid #44ff88;border-radius:8px">
              <h3>💊 Médico</h3>
              <p>Puedes curar a otros jugadores y protegerlos del daño.</p>
            </div>
            <div style="margin:20px 0;padding:15px;background:rgba(255,204,0,0.1);border-left:4px solid #ffcc00;border-radius:8px">
              <h3>🔍 Detective</h3>
              <p>Investiga a otros jugadores para descubrir su rol. Ahora también ves su ubicación en el radar y obtienes un buff de velocidad al investigar.</p>
            </div>
            <div style="margin:20px 0;padding:15px;background:rgba(170,102,255,0.1);border-left:4px solid #aa66ff;border-radius:8px">
              <h3>🃏 Joker</h3>
              <p>Causa distracciones que aumentan el daño de TODOS los roles malvados (Asesino, Jorguín, Espía).</p>
            </div>
            <div style="margin:20px 0;padding:15px;background:rgba(51,153,255,0.1);border-left:4px solid #3399ff;border-radius:8px">
              <h3>🛡️ Guardaespaldas</h3>
              <p>Puedes proteger a otros jugadores absorbiendo el daño dirigido a ellos.</p>
            </div>
            <div style="margin:20px 0;padding:15px;background:rgba(138,43,226,0.1);border-left:4px solid #8a2be2;border-radius:8px">
              <h3>👽 Psíquico</h3>
              <p>Congela a jugadores (inmunes a ataques) o extermina a uno (solo una vez por partida).</p>
            </div>
            <div style="margin:20px 0;padding:15px;background:rgba(218,165,32,0.1);border-left:4px solid #daa520;border-radius:8px">
              <h3>⭐ Alguacil</h3>
              <p>Revela públicamente el rol de un jugador (una vez) o dispara causando daño (múltiples veces).</p>
            </div>
            <div style="margin:20px 0;padding:15px;background:rgba(139,69,19,0.1);border-left:4px solid #8b4513;border-radius:8px">
              <h3>🖤 Jorguín</h3>
              <p>Bloquea habilidades y velocidad de otros jugadores. También puede atacar con daño moderado.</p>
            </div>
            <div style="margin:20px 0;padding:15px;background:rgba(75,0,130,0.1);border-left:4px solid #4b0082;border-radius:8px">
              <h3>🐈‍⬛ Espía</h3>
              <p>Investiga anónimamente a jugadores y los rastrea en el radar. Puede atacar con daño moderado.</p>
            </div>
            <div style="margin:20px 0;padding:15px;background:rgba(160,82,45,0.1);border-left:4px solid #a0522d;border-radius:8px">
              <h3>🔨 Carpintero</h3>
              <p>Construye barricadas que protegen a jugadores cercanos. Máximo 3 por partida.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(screen);
  
  $all('.flee-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $all('.flee-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-tab');
      $all('.flee-tab-content').forEach(t => t.style.display = 'none');
      $(`#flee-${tab}-lobby, #flee-${tab}-editor, #flee-${tab}-info`).style.display = 'block';
      if (tab === 'profile') $('#flee-profile-editor').classList.add('active');
      if (tab === 'join') requestLobbyList();
    });
  });
  
  $('#profile-name').value = meName;
  $('#profile-description').value = meDescription;
  $('#profile-avatar-url').value = meAvatarData.startsWith('data:') ? '' : meAvatarData;
  if (meAvatarData) $('#profile-avatar-preview').src = meAvatarData;
  
  $('#profile-avatar-url').addEventListener('input', (e) => {
    const url = e.target.value.trim();
    if (url) {
      const preview = $('#profile-avatar-preview');
      const testImg = new Image();
      testImg.onload = () => {
        preview.src = url;
        window._currentAvatarData = url;
      };
      testImg.onerror = () => {
        preview.src = '';
      };
      testImg.src = url;
    }
  });
  
  $('#profile-avatar-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        showNotification('⚠️ Por favor selecciona un archivo de imagen válido');
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        showNotification('⚠️ La imagen es muy grande (máximo 2MB)');
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target.result;
        $('#profile-avatar-preview').src = base64;
        $('#profile-avatar-url').value = '';
        $('#profile-file-name').textContent = file.name;
        window._currentAvatarData = base64;
      };
      reader.onerror = () => {
        showNotification('⚠️ Error al leer el archivo');
      };
      reader.readAsDataURL(file);
    }
  });
  
  window._currentAvatarData = meAvatarData;
  
  $('#create-lobby-btn').addEventListener('click', () => {
    window.createLobbyNow();
  });
  
  $('#save-profile-btn').addEventListener('click', () => {
    window.saveProfileNow();
  });
  
  $('#toggle-all-roles').addEventListener('click', () => {
    const enabledCheckboxes = $all('.role-enabled');
    const allEnabled = enabledCheckboxes.every(cb => cb.checked);
    enabledCheckboxes.forEach(cb => {
      cb.checked = !allEnabled;
      const roleItem = cb.closest('.flee-role-item');
      if (roleItem) {
        roleItem.classList.toggle('disabled', !cb.checked);
      }
    });
  });
  
  $all('.role-enabled').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const roleItem = e.target.closest('.flee-role-item');
      if (roleItem) {
        roleItem.classList.toggle('disabled', !e.target.checked);
      }
    });
  });
}

function hideLobbyScreen(){
  const screen = $('#flee-lobby-screen');
  if (screen) screen.style.display = 'none';
  updateToggleLobbyButtonIcon();
}

function showLobbyScreen(){
  const screen = $('#flee-lobby-screen');
  if (screen) screen.style.display = 'flex';
  updateToggleLobbyButtonIcon();
}

function toggleLobbyScreen(){
  const screen = $('#flee-lobby-screen');
  if (!screen) return;
  if (screen.style.display === 'none') {
    showLobbyScreen();
  } else {
    hideLobbyScreen();
  }
}

function updateToggleLobbyButtonIcon(){
  const btn = $('#flee-lobby-toggle');
  const screen = $('#flee-lobby-screen');
  if (!btn || !screen) return;
  const isVisible = screen.style.display !== 'none';
  btn.innerHTML = isVisible 
    ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>'
    : '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>';
}

function createToggleLobbyButton(){
  const existing = document.getElementById('flee-lobby-toggle');
  if (existing) existing.remove();
  
  const btn = document.createElement('button');
  btn.id = 'flee-lobby-toggle';
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>';
  btn.title = 'Ocultar/Mostrar Lobby';
  Object.assign(btn.style, {
    position: 'fixed',
    right: '12px',
    bottom: '12px',
    zIndex: '100010',
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    background: 'rgba(0,0,0,0.6)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.2)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0'
  });
  btn.addEventListener('click', handleToggleButtonClick);
  document.body.appendChild(btn);
}

function handleToggleButtonClick(){
  if (currentPhase === 'running' || currentPhase === 'reveal') {
    leaveCurrentGame();
  } else {
    toggleLobbyScreen();
  }
}

function leaveCurrentGame(){
  if (!confirm('¿Estás seguro de que quieres abandonar la partida?')) return;
  
  currentPhase = 'lobby';
  revealedRoleForMe = false;
  GAME_ID = null;
  currentLobby = null;
  
  resetGameState();
  removeJokerButton();
  removeCarpenterButton();
  
  const ui = $('#flee-ui');
  if (ui) ui.style.display = 'none';
  
  window.postMessage({ source: 'radar-admin', type: 'setRadar', on: false }, '*');
  
  updateToggleLobbyButtonMode();
  showLobbyScreen();
  showNotification('🚪 Has abandonado la partida', 3000);
}

function updateToggleLobbyButtonMode(){
  const btn = $('#flee-lobby-toggle');
  if (!btn) return;
  
  if (currentPhase === 'running' || currentPhase === 'reveal') {
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg>';
    btn.title = 'Abandonar Partida';
    btn.style.background = 'rgba(231, 76, 60, 0.8)';
    btn.style.border = '1px solid rgba(192, 57, 43, 0.8)';
  } else {
    updateToggleLobbyButtonIcon();
    btn.style.background = 'rgba(0,0,0,0.6)';
    btn.style.border = '1px solid rgba(255,255,255,0.2)';
  }
}

function createWaitingRoomScreen(){
  const screen = document.createElement('div');
  screen.id = 'flee-waiting-room';
  screen.innerHTML = `
    <div id="flee-waiting-container">
      <div id="flee-waiting-header">
        <h2>🎭 Sala de Espera</h2>
        <p id="flee-waiting-lobby-name">Lobby de ...</p>
      </div>
      <div id="flee-waiting-config">
        <div class="flee-config-item">
          <span id="flee-waiting-players-count">0/8</span>
          <small>Jugadores</small>
        </div>
        <div class="flee-config-item">
          <span id="flee-waiting-tasks-count">5</span>
          <small>Tareas</small>
        </div>
        <div class="flee-config-item">
          <span id="flee-waiting-coins-status">❌</span>
          <small>Monedas</small>
        </div>
      </div>
      <div id="flee-waiting-players">
        <h3>👥 Jugadores en la sala</h3>
        <div id="flee-waiting-players-list"></div>
      </div>
      <div id="flee-waiting-actions">
        <button id="flee-start-game-btn" style="display:none">🚀 Iniciar Partida</button>
        <button id="flee-leave-lobby-btn">🚪 Abandonar Lobby</button>
      </div>
      <div id="flee-waiting-status">Esperando a que el creador inicie la partida...</div>
    </div>
  `;
  document.body.appendChild(screen);
  
  $('#flee-start-game-btn').addEventListener('click', () => {
    if (currentLobby && currentLobby.creatorName === meName) {
      wsSend({ t: 'startGame' });
    }
  });
  
  $('#flee-leave-lobby-btn').addEventListener('click', () => {
    wsSend({ t: 'leaveLobby' });
    hideWaitingRoom();
    showLobbyScreen();
    currentLobby = null;
    requestLobbyList();
  });
}

function showWaitingRoom(){
  const screen = $('#flee-waiting-room');
  if (screen) {
    screen.style.display = 'flex';
    updateWaitingRoomUI();
  }
}

function hideWaitingRoom(){
  const screen = $('#flee-waiting-room');
  if (screen) screen.style.display = 'none';
}

function updateWaitingRoomUI(){
  if (!currentLobby) return;
  
  $('#flee-waiting-lobby-name').textContent = `Lobby de ${currentLobby.creatorName}`;
  $('#flee-waiting-players-count').textContent = `${currentLobby.currentPlayers}/${currentLobby.maxPlayers}`;
  $('#flee-waiting-tasks-count').textContent = currentLobby.tasksTotal;
  $('#flee-waiting-coins-status').textContent = currentLobby.coinsEnabled ? '✅' : '❌';
  
  const playersList = $('#flee-waiting-players-list');
  if (playersList && currentLobby.players) {
    playersList.innerHTML = currentLobby.players.map(p => `
      <div class="flee-waiting-player ${p.name === currentLobby.creatorName ? 'creator' : ''}">
        <img src="${escapeHTML(p.avatarUrl) || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + encodeURIComponent(p.name)}" alt="${escapeHTML(p.name)}">
        <span>${escapeHTML(p.name)}</span>
        ${p.name === currentLobby.creatorName ? '<small>👑 Creador</small>' : ''}
      </div>
    `).join('');
  }
  
  const startBtn = $('#flee-start-game-btn');
  const statusEl = $('#flee-waiting-status');
  
  if (currentLobby.creatorName === meName) {
    startBtn.style.display = 'inline-block';
    if (currentLobby.currentPlayers < 2) {
      startBtn.disabled = true;
      statusEl.textContent = '⚠️ Se necesitan al menos 2 jugadores para iniciar';
    } else {
      startBtn.disabled = false;
      statusEl.textContent = '✅ ¡Listo para iniciar la partida!';
    }
  } else {
    startBtn.style.display = 'none';
    statusEl.textContent = 'Esperando a que el creador inicie la partida...';
  }
}

window.createLobbyNow = function(){
  if (!connected || !ws) return;
  const maxPlayers = parseInt($('#lobby-max-players').value) || 8;
  const tasksTotal = parseInt($('#lobby-tasks').value) || 5;
  const password = $('#lobby-password').value || '';
  const coinsEnabled = $('#lobby-coins').checked;
  
  const roleConfig = {};
  const roles = ['killer', 'medic', 'innocent', 'detective', 'joker', 'bodyguard', 'psychic', 'sheriff', 'jorguin', 'spy', 'carpenter'];
  
  roles.forEach(role => {
    const enabledEl = $(`.role-enabled[data-role="${role}"]`);
    const countEl = $(`.role-count[data-role="${role}"]`);
    const requiredEl = $(`.role-required[data-role="${role}"]`);
    
    roleConfig[role] = {
      enabled: enabledEl ? enabledEl.checked : true,
      count: countEl ? parseInt(countEl.value) || 1 : 1,
      required: requiredEl ? requiredEl.checked : false
    };
  });
  
  const enabledRoles = Object.entries(roleConfig)
    .filter(([_, cfg]) => cfg.enabled)
    .map(([role, _]) => role);
  
  if (enabledRoles.length === 0) {
    showNotification('⚠️ Debes habilitar al menos un rol');
    return;
  }
  
  wsSend({
    t: 'createLobby',
    maxPlayers,
    tasksTotal,
    password,
    coinsEnabled,
    roleConfig
  });
};

window.saveProfileNow = function(){
  const name = $('#profile-name').value.trim();
  const description = $('#profile-description').value.trim();
  const urlInput = $('#profile-avatar-url').value.trim();
  const avatar = urlInput || window._currentAvatarData || '';
  
  if (!name) {
    showNotification('⚠️ Por favor ingresa un nombre');
    return;
  }
  
  meName = name;
  localStorage.setItem('flee_name_v1', name);
  
  meDescription = description;
  localStorage.setItem('flee_description_v1', description);
  
  if (avatar) {
    const testImg = new Image();
    testImg.onload = () => {
      meAvatarData = avatar;
      localStorage.setItem('flee_avatar_v1', avatar);
      window._currentAvatarData = avatar;
      $('#profile-avatar-preview').src = avatar;
      
      showNotification('✅ Perfil guardado correctamente');
      
      if (connected) {
        wsSend({ t: 'updateProfile', name: meName, avatarUrl: meAvatarData, description: meDescription });
      }
    };
    testImg.onerror = () => {
      showNotification('⚠️ La URL de imagen no es válida');
    };
    testImg.src = avatar;
  } else {
    meAvatarData = '';
    localStorage.setItem('flee_avatar_v1', '');
    window._currentAvatarData = '';
    
    showNotification('✅ Perfil guardado correctamente');
    
    if (connected) {
      wsSend({ t: 'updateProfile', name: meName, avatarUrl: meAvatarData, description: meDescription });
    }
  }
};

function requestLobbyList(){
  if (!connected || !ws) return;
  wsSend({ t: 'getLobbyList' });
}

function renderLobbyList(lobbies){
  const list = $('#flee-lobby-list');
  if (!list) return;
  
  if (lobbies.length === 0) {
    list.innerHTML = '<p style="text-align:center;color:var(--flee-text);margin-top:40px">No hay lobbies disponibles. ¡Crea uno!</p>';
    return;
  }
  
  list.innerHTML = lobbies.map(lobby => `
    <div class="flee-lobby-card" data-lobby-id="${lobby.id}">
      <h3 style="margin:0 0 10px 0;color:var(--flee-border)">${lobby.creatorName}'s Lobby</h3>
      <p style="margin:5px 0;color:var(--flee-text)">👥 ${lobby.currentPlayers}/${lobby.maxPlayers} jugadores</p>
      <p style="margin:5px 0;color:var(--flee-text)">📋 ${lobby.tasksTotal} tareas</p>
      <p style="margin:5px 0;color:var(--flee-text)">${lobby.hasPassword ? '🔒 Privado' : '🌐 Público'}</p>
      <p style="margin:5px 0;color:var(--flee-text)">💰 ${lobby.coinsEnabled ? 'Monedas activas' : 'Sin monedas'}</p>
    </div>
  `).join('');
  
  document.querySelectorAll('.flee-lobby-card').forEach(card => {
    card.addEventListener('click', () => {
      const lobbyId = card.getAttribute('data-lobby-id');
      window.joinLobbyById(lobbyId);
    });
  });
}

window.joinLobbyById = function(lobbyId){
  const lobby = lobbyList.find(l => l.id === lobbyId);
  if (!lobby) return;
  
  if (lobby.hasPassword) {
    const password = prompt('Esta partida requiere contraseña:');
    if (!password) return;
    wsSend({ t: 'joinLobby', lobbyId, password });
  } else {
    wsSend({ t: 'joinLobby', lobbyId, password: '' });
  }
};

function showToast(txt) {
  const t = $('#flee-toast');
  if (!t) return;
  t.textContent = txt;
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; }, 2500);
}

function refreshPlayersUI() {
  const playersEl = $('#flee-players');
  if (!playersEl) return;
  playersEl.innerHTML = '';
  
  Object.keys(playersMap).sort((a, b) => a.localeCompare(b)).forEach(name => {
    const p = playersMap[name] || {};
    const d = document.createElement('div');
    d.className = 'flee-player';
    
    if (p.alive === false) {
      d.classList.add('dead');
    }
    
    if (p.disconnected === true || p.connected === false) {
      d.classList.add('disconnected');
    }
    
    if (protectedBy[name]) {
      d.classList.add('protected');
    }
    
    const img = document.createElement('img');
    img.src = p.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`;
    img.alt = name;
    img.title = name;
    
    const nm = document.createElement('div');
    nm.className = 'flee-player-name';
    nm.textContent = name.length > 7 ? name.slice(0, 6) + '…' : name;
    nm.title = name;
    
    d.appendChild(img);
    
    if (p.alive === false) {
      const x = document.createElement('div');
      x.className = 'dead-x';
      x.innerText = '✖';
      d.appendChild(x);
    }
    
    if (protectedBy[name]) {
      const shield = document.createElement('div');
      shield.className = 'protection-indicator';
      shield.innerText = '🛡️';
      d.appendChild(shield);
    }
    
    d.appendChild(nm);
    playersEl.appendChild(d);
    
    d.addEventListener('click', () => openProfileModal(name));
  });
}

function createProfileModal() {
  if ($('#flee-profile-modal')) return;
  
  const modal = document.createElement('div');
  modal.id = 'flee-profile-modal';
  modal.innerHTML = `
    <div id="flee-profile-content">
      <span id="flee-profile-close">&times;</span>
      <img id="flee-profile-avatar" src="" alt="Avatar">
      <div id="flee-profile-name">Jugador</div>
      <div id="flee-profile-desc"></div>
      <div id="flee-profile-role" style="display:none"></div>
      <div id="flee-profile-status"></div>
      <div id="flee-profile-actions"></div>
    </div>
  `;
  document.body.appendChild(modal);
  
  $('#flee-profile-close').addEventListener('click', closeProfileModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeProfileModal();
  });
}

function openProfileModal(targetName) {
  const modal = $('#flee-profile-modal');
  if (!modal) return;
  
  const player = playersMap[targetName] || {};
  $('#flee-profile-avatar').src = player.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(targetName)}`;
  $('#flee-profile-name').textContent = targetName;
  $('#flee-profile-desc').textContent = player.description || '';
  
  const roleEl = $('#flee-profile-role');
  const knownRole = publicReveals[targetName] || (investigatedPlayers.includes(targetName) ? rolesByName[targetName] : null);
  if (knownRole) {
    roleEl.style.display = 'inline-block';
    const roleInfo = getRoleInfo(knownRole);
    roleEl.textContent = roleInfo.text;
    roleEl.style.background = roleInfo.color;
    roleEl.style.color = '#fff';
  } else {
    roleEl.style.display = 'none';
  }
  
  const statusEl = $('#flee-profile-status');
  if (player.alive === false) {
    statusEl.innerHTML = '<span style="color:#ff4444">💀 Muerto</span>';
  } else if (player.disconnected === true || player.connected === false) {
    statusEl.innerHTML = '<span style="color:#999">📴 Desconectado</span>';
  } else {
    statusEl.innerHTML = '<span style="color:#44ff88">💚 Vivo</span>';
  }
  
  const actionsEl = $('#flee-profile-actions');
  actionsEl.innerHTML = '';
  
  modal.classList.add('active');
}

function closeProfileModal() {
  const modal = $('#flee-profile-modal');
  if (modal) modal.classList.remove('active');
}

function getRoleInfo(role) {
  const roles = {
    killer: { text: '🔪 Asesino', color: '#ff4444' },
    medic: { text: '💊 Médico', color: '#44ff88' },
    innocent: { text: '👤 Inocente', color: '#4499ff' },
    detective: { text: '🔍 Detective', color: '#ffcc00' },
    joker: { text: '🃏 Joker', color: '#aa66ff' },
    bodyguard: { text: '🛡️ Guardaespaldas', color: '#3399ff' },
    psychic: { text: '👽 Psíquico', color: '#8a2be2' },
    sheriff: { text: '⭐ Alguacil', color: '#daa520' },
    jorguin: { text: '🖤 Jorguín', color: '#8b4513' },
    spy: { text: '🐈‍⬛ Espía', color: '#4b0082' },
    carpenter: { text: '🔨 Carpintero', color: '#a0522d' }
  };
  return roles[role] || roles.innocent;
}

function getActionButtonsForRole(myRole, targetName) {
  const buttons = [];
  
  if (myRole === 'killer') {
    buttons.push(createActionButton('🔪 Atacar', 'attack', () => doAttack(targetName, myRole)));
  }
  
  if (myRole === 'medic') {
    buttons.push(createActionButton('💊 Curar', 'heal', () => doHeal(targetName)));
  }
  
  if (myRole === 'detective') {
    buttons.push(createActionButton('🔍 Investigar', 'investigate', () => doInvestigate(targetName)));
  }
  
  if (myRole === 'bodyguard') {
    const isProtecting = guardState.protecting === targetName;
    const btnText = isProtecting ? '🛡️ Dejar de Proteger' : '🛡️ Proteger';
    buttons.push(createActionButton(btnText, 'protect', () => toggleProtection(targetName)));
  }
  
  if (myRole === 'psychic') {
    buttons.push(createActionButton('❄️ Congelar', 'freeze', () => doFreeze(targetName)));
    if (!cooldowns.psychic_exterminate_used) {
      buttons.push(createActionButton('💀 Exterminar', 'exterminate', () => doExterminate(targetName)));
    }
  }
  
  if (myRole === 'sheriff') {
    if (!cooldowns.sheriff_reveal_used) {
      buttons.push(createActionButton('📢 Revelar', 'reveal', () => doReveal(targetName)));
    }
    buttons.push(createActionButton('🔫 Disparar', 'shoot', () => doShoot(targetName)));
  }
  
  if (myRole === 'jorguin') {
    buttons.push(createActionButton('⛔ Bloquear', 'block', () => doJorguinBlock(targetName)));
    buttons.push(createActionButton('🖤 Atacar', 'jorguin_attack', () => doJorguinAttack(targetName)));
  }
  
  if (myRole === 'spy') {
    buttons.push(createActionButton('🔎 Investigar', 'spy_investigate', () => doSpyInvestigate(targetName)));
    buttons.push(createActionButton('🐈‍⬛ Atacar', 'spy_attack', () => doSpyAttack(targetName)));
  }
  
  
  
  return buttons;
}

function createActionButton(text, type, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `flee-action-btn ${type}`;
  btn.innerHTML = text;
  
  const cooldownKey = getCooldownKeyForType(type);
  if (cooldownKey && isOnCooldown(cooldownKey)) {
    btn.disabled = true;
    const remaining = Math.ceil((cooldowns[cooldownKey] - Date.now()) / 1000);
    btn.innerHTML = `${text} (${remaining}s)`;
  }

  const clearPressedState = () => btn.classList.remove('is-pressed');
  btn.addEventListener('pointerdown', () => {
    if (!btn.disabled) btn.classList.add('is-pressed');
  });
  btn.addEventListener('pointerup', clearPressedState);
  btn.addEventListener('pointercancel', clearPressedState);
  btn.addEventListener('mouseleave', clearPressedState);
  btn.addEventListener('blur', clearPressedState);
  
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (btn.disabled) return;
    onClick();
  });
  
  return btn;
}

function getCooldownKeyForType(type) {
  const mapping = {
    attack: 'killer',
    heal: 'medic',
    investigate: 'detective',
    protect: 'bodyguard',
    freeze: 'psychic_freeze',
    shoot: 'sheriff_shoot',
    block: 'jorguin_block',
    jorguin_attack: 'jorguin_attack',
    spy_investigate: 'spy_investigate',
    spy_attack: 'spy_attack',
    joker: 'joker_distract'
  };
  return mapping[type] || null;
}

function isOnCooldown(key) {
  if (typeof cooldowns[key] === 'number' && cooldowns[key] > Date.now()) {
    return true;
  }
  return false;
}

function setCooldown(key, durationMs) {
  cooldowns[key] = Date.now() + durationMs;
}

function flashOverlay(color, duration = 500) {
  const flash = document.createElement('div');
  flash.className = 'flee-flash-overlay';
  flash.style.background = color;
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), duration);
}

function showSplinteredOverlay(duration) {
  let overlay = document.getElementById('flee-splintered-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'flee-splintered-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      background: 'radial-gradient(circle at center, rgba(139, 69, 19, 0.3), rgba(205, 133, 63, 0.5))',
      zIndex: '99997',
      pointerEvents: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    });
    
    const content = document.createElement('div');
    content.innerHTML = `
      <div style="text-align: center; color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,0.5);">
        <div style="font-size: 48px; margin-bottom: 10px;">🪵</div>
        <div style="font-size: 24px; font-weight: bold;">¡ASTILLADO!</div>
        <div id="flee-splintered-timer" style="font-size: 18px; margin-top: 10px;"></div>
      </div>
    `;
    overlay.appendChild(content);
    document.body.appendChild(overlay);
  }
  
  overlay.style.display = 'flex';
  
  const timerEl = overlay.querySelector('#flee-splintered-timer');
  
  const updateTimer = () => {
    const remaining = Math.max(0, Math.ceil((abilityBlockedUntil - Date.now()) / 1000));
    if (timerEl) timerEl.textContent = `${remaining}s restantes`;
    
    if (remaining <= 0 || Date.now() >= abilityBlockedUntil) {
      overlay.style.display = 'none';
      abilityBlocked = false;
      abilityBlockedUntil = 0;
      updateJokerButtonVisuals();
      updateCarpenterButtonVisuals();
      return;
    }
    setTimeout(updateTimer, 100);
  };
  updateTimer();
}

const processedNotif = new WeakSet();
const AFTER_ACCEPT_DELAY = 450;

function extractGiverFromNotification(node) {
  try {
    let name = null;
    const bolds = node.querySelectorAll ? node.querySelectorAll('b') : [];
    for (const b of bolds) {
      const t = (b.textContent || '').trim();
      if (!t) continue;
      if (/giving item/i.test(t)) continue;
      name = t;
      break;
    }
    if (!name) {
      const a = node.querySelector('a[href]');
      if (a) name = (a.textContent || '').trim();
    }
    if (!name) {
      const em = node.querySelector('emoji-span span');
      if (em) name = (em.textContent || '').trim();
    }
    if (!name) {
      const txt = (node.textContent || '').trim();
      const m = txt.match(/([A-Za-z0-9_\- ]+)\s+is giving/i) || txt.match(/([A-Za-z0-9_\- ]+)\s+está dando/i);
      if (m) name = m[1].trim();
    }
    return name;
  } catch(e) {
    return null;
  }
}

function aplicarHitOrHealFrom(giver) {
  const giverRole = rolesByName[giver] || 'innocent';
  
  if (giverRole === 'killer') {
    if (rolesByName[meName] === 'bodyguard' && guardState.protecting) {
      showNotification('🛡️ Tu custodia bloqueó el ataque.', 2000);
      return;
    }
    
    const dmg = settings.damageOnHit || 20;
    health = Math.max(0, health - dmg);
    updateHealthUI();
    flashOverlay('rgba(255,0,0,0.45)', 900);
    wsSend({ t: 'updateMyPlayer', gameId: GAME_ID, patch: { health } });
    
    if (health <= 0) {
      diedOnce = true;
      showNotification('💀 Has muerto', 5000);
    }
  } else if (giverRole === 'medic') {
    const heal = settings.healOnGive || 15;
    health = Math.min(100, health + heal);
    updateHealthUI();
    flashOverlay('rgba(0,200,0,0.28)', 900);
    wsSend({ t: 'updateMyPlayer', gameId: GAME_ID, patch: { health } });
  }
}

function showBottomCenterMessage(giver) {
  showNotification(`👋 ${escapeHTML(giver)} interactuó contigo`, 3000);
}

function enviarMensaje(text) {
  try {
    const campo = document.querySelector('.chat-textarea.chat-commons.hide-scrollbar');
    const boton = document.querySelector('ui-button[title="Send message (hold Shift to send without closing input)"] button');
    if (campo && boton) {
      if ('value' in campo) {
        campo.value = text;
        campo.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        campo.textContent = text;
        campo.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }
      boton.click();
      return true;
    }
  } catch(e) {
    console.warn('[MM] enviarMensaje error', e);
  }
  return false;
}

async function processNotificationNode(node) {
  try {
    if (!node || processedNotif.has(node)) return;
    processedNotif.add(node);
    
    if (currentPhase !== 'running') return;
    
    const txt = (node.textContent || '').toLowerCase();
    if (!(/giving.*item|está dando|is giving|is giving you an item/i.test(txt))) return;
    
    const giver = extractGiverFromNotification(node);
    if (!giver) return;
    
    const giverRole = rolesByName[giver] || 'innocent';
    
    if (!(giverRole === 'killer' || giverRole === 'medic' || giverRole === 'detective')) return;
    
    const acceptBtn = node.querySelector('button.notification-button.btn-success') || 
      Array.from(node.querySelectorAll('button.notification-button')).find(b => /accept|aceptar/i.test(b.textContent || ''));
    
    if (!acceptBtn) return;
    if (acceptBtn.disabled || acceptBtn.getAttribute('aria-disabled') === 'true' || acceptBtn.classList.contains('disabled')) return;
    
    try {
      acceptBtn.click();
    } catch(e) {
      console.warn('[MM] auto accept failed', e);
    }
    
    if (giverRole === 'killer' || giverRole === 'medic') {
      aplicarHitOrHealFrom(giver);
    }
    
    showBottomCenterMessage(giver);
    
    setTimeout(() => enviarMensaje('/drop'), AFTER_ACCEPT_DELAY);
  } catch(e) {
    console.warn('[MM] processNotificationNode error', e);
  }
}

function setupNotificationObservers() {
  try {
    const root = document.querySelector('.notification-scroll-area') || document.body;
    
    const mo = new MutationObserver((muts) => {
      try {
        for (const m of muts) {
          for (const node of m.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            
            if (node.matches && (node.matches('notification-item') || node.matches('.notification') || node.matches('.notification-popover'))) {
              processNotificationNode(node);
            } else {
              const items = node.querySelectorAll ? node.querySelectorAll('notification-item, .notification, .notification-popover') : [];
              items.forEach(item => processNotificationNode(item));
            }
          }
        }
      } catch(e) {
        console.warn('[MM] MutationObserver callback error', e);
      }
    });
    
    mo.observe(root, { childList: true, subtree: true });
    
    const existing = root.querySelectorAll ? root.querySelectorAll('notification-item, .notification, .notification-popover') : [];
    existing.forEach(n => processNotificationNode(n));
    
    console.log('[MM] Notification observers set up successfully');
  } catch(e) {
    console.warn('[MM] setupNotificationObservers error', e);
  }
}

function setupPonyTownProfileObserver() {
  try {
    const profileSelectors = [
      '.profile-popup',
      '.pony-profile',
      'profile-popover',
      '.character-info',
      '.player-profile',
      '.profile-modal',
      '.popover-content',
      '.entity-info',
      '.character-popover',
      '[class*="profile"]',
      '[class*="popover"]'
    ];
    
    const mo = new MutationObserver((muts) => {
      try {
        for (const m of muts) {
          for (const node of m.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            processPotentialProfile(node, profileSelectors);
          }
        }
      } catch(e) {
        console.warn('[MM] Profile observer error', e);
      }
    });
    
    mo.observe(document.body, { childList: true, subtree: true });
    console.log('[MM] Pony Town profile observer set up successfully');
  } catch(e) {
    console.warn('[MM] setupPonyTownProfileObserver error', e);
  }
}

function setupPonyBoxButtonsObserver() {
  try {
    const isInMurderMysteryUI = (el) => {
      if (!el || !el.closest) return false;
      return el.closest('#flee-ui') || 
             el.closest('#flee-players') || 
             el.closest('#flee-profile-modal') ||
             el.closest('.flee-player') ||
             el.closest('#flee-lobby-screen') ||
             el.closest('#flee-waiting-room') ||
             el.closest('#flee-center-msg') ||
             el.closest('#flee-shop-modal') ||
             el.closest('#flee-target-select-overlay');
    };
    
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          
          if (isInMurderMysteryUI(node)) {
            continue;
          }
          
          const box = node.matches && node.matches('.pony-box-buttons-box') ? node : node.querySelector && node.querySelector('.pony-box-buttons-box');
          if (box && !isInMurderMysteryUI(box)) {
            const ponyBox = box.closest('.pony-box');
            if (ponyBox && ponyBox.querySelector('.pony-profile, .profile-content, .pony-avatar, .profile-name')) {
              const btnGroup = box.querySelector('.btn-group.btn-group-shadow.dropdown') || box.querySelector('.btn-group.btn-group-shadow');
              if (btnGroup) createPonyBoxInteractButton(btnGroup);
            }
          }
          
          const groups = node.querySelectorAll ? node.querySelectorAll('.pony-box-buttons-box .btn-group.btn-group-shadow.dropdown, .pony-box-buttons-box .btn-group.btn-group-shadow') : [];
          groups.forEach(g => {
            if (!isInMurderMysteryUI(g)) {
              createPonyBoxInteractButton(g);
            }
          });
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    
    setTimeout(() => {
      try {
        const boxes = document.querySelectorAll('.pony-box-buttons-box');
        boxes.forEach(b => {
          if (isInMurderMysteryUI(b)) return;
          
          const ponyBox = b.closest('.pony-box');
          if (ponyBox && ponyBox.querySelector('.pony-profile, .profile-content, .pony-avatar, .profile-name')) {
            const g = b.querySelector('.btn-group.btn-group-shadow.dropdown') || b.querySelector('.btn-group.btn-group-shadow');
            if (g) createPonyBoxInteractButton(g);
          }
        });
      } catch(e) {}
    }, 800);
    
    console.log('[MM] Pony box buttons observer set up successfully');
  } catch(e) {
    console.warn('[MM] setupPonyBoxButtonsObserver error', e);
  }
}

function createPonyBoxInteractButton(btnGroup) {
  if (!btnGroup || btnGroup.dataset.mmInteractAdded) return;
  
  const isInMurderMystery = btnGroup.closest('#flee-ui') || 
                            btnGroup.closest('#flee-players') || 
                            btnGroup.closest('#flee-profile-modal') ||
                            btnGroup.closest('.flee-player') ||
                            btnGroup.closest('#flee-lobby-screen') ||
                            btnGroup.closest('#flee-waiting-room') ||
                            btnGroup.closest('#flee-center-msg') ||
                            btnGroup.closest('#flee-shop-modal') ||
                            btnGroup.closest('#flee-target-select-overlay');
  if (isInMurderMystery) return;
  
  // Only proceed if game is running
  if (currentPhase !== 'running' || !revealedRoleForMe) return;
  
  const ponyBox = btnGroup.closest('.pony-box');
  if (!ponyBox) return;
  
  // Verify this is a player profile, not a game object
  // Player profiles have specific elements like profile images and names
  const hasPlayerProfile = ponyBox.querySelector('.pony-profile, .profile-content, [class*="profile"]');
  const hasAvatar = ponyBox.querySelector('.pony-avatar, .avatar, img[class*="avatar"], img[class*="profile"]');
  
  if (!hasPlayerProfile && !hasAvatar) {
    return;
  }
  
  const dropdownMenu = btnGroup.querySelector('.dropdown-menu') || btnGroup.closest('.dropdown')?.querySelector('.dropdown-menu');
  if (!dropdownMenu) return;
  
  // Critical check: only add buttons if there's a "Give item" button - this indicates a player profile
  const giveItemBtn = dropdownMenu.querySelector('button[title*="Give item"], button[title*="Dar item"], button[title*="Dar objeto"]');
  if (!giveItemBtn) return;
  
  btnGroup.dataset.mmInteractAdded = 'true';
  
  const nameEl = ponyBox.querySelector('.profile-name, .player-name, h3, h2, .entity-name');
  const targetName = nameEl ? (nameEl.textContent || '').trim() : null;
  
  if (!targetName || targetName === meName || !isValidPlayerName(targetName)) return;
  
  const myRole = rolesByName[meName] || 'innocent';
  const buttons = getRoleActionsForProfile(myRole, targetName);
  
  if (buttons.length === 0) return;
  
  const divider = document.createElement('div');
  divider.className = 'dropdown-divider';
  dropdownMenu.appendChild(divider);
  
  const header = document.createElement('div');
  header.style.cssText = 'padding: 4px 12px; font-size: 11px; color: #888; font-weight: 600; text-transform: uppercase;';
  header.textContent = '🎭 Murder Mystery';
  dropdownMenu.appendChild(header);
  
  buttons.forEach(btn => {
    const button = document.createElement('button');
    button.className = 'dropdown-item';
    button.innerHTML = `<span style="margin-right: 6px">${btn.label.split(' ')[0]}</span>${btn.label.split(' ').slice(1).join(' ')}`;
    button.style.cssText = 'display: flex; align-items: center; padding: 6px 12px; cursor: pointer;';
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!isButtonUnavailable(giveItemBtn)) {
        btn.action(targetName);
      } else {
        showNotification('⚠️ Necesitas tener un objeto para interactuar', 2000);
      }
    });
    dropdownMenu.appendChild(button);
  });
  
  console.log('[MM] Added interact buttons for:', targetName);
}

function isButtonUnavailable(btn) {
  if (!btn) return true;
  try {
    if (btn.disabled || btn.hasAttribute('disabled')) return true;
    if (btn.getAttribute('aria-disabled') === 'true') return true;
    const cls = btn.className || '';
    if (/\bdisabled\b/i.test(cls) || /\binactive\b/i.test(cls)) return true;
    const cs = window.getComputedStyle(btn);
    const op = parseFloat(cs.opacity || '1');
    if (!isNaN(op) && op < 0.6) return true;
    if (cs.pointerEvents === 'none') return true;
    const title = (btn.getAttribute('title') || '').toLowerCase();
    if (/(disabled|not|no|too far|too close|distance|sin objeto|no estás|muy lejos)/i.test(title)) return true;
  } catch(e) {}
  return false;
}

function processPotentialProfile(node, selectors) {
  if (!node || !node.querySelector) return;
  
  for (const selector of selectors) {
    try {
      if ((node.matches && node.matches(selector)) || node.querySelector(selector)) {
        const profileEl = node.matches && node.matches(selector) ? node : node.querySelector(selector);
        if (profileEl && !profileEl.dataset.mmInjected) {
          extractAndInjectProfileButtons(profileEl);
        }
      }
    } catch(e) {
    }
  }
  
  const nameEl = node.querySelector('[class*="name"]') || 
                 node.querySelector('.player-name') || 
                 node.querySelector('.character-name') ||
                 node.querySelector('.entity-name') ||
                 node.querySelector('h3') ||
                 node.querySelector('h4');
                 
  if (nameEl && !node.dataset.mmInjected) {
    const text = (nameEl.textContent || '').trim();
    if (text && text !== meName && isValidPlayerName(text)) {
      injectRoleButtonsToProfile(node, text);
    }
  }
}

function isValidPlayerName(name) {
  if (!name || name.length < 2 || name.length > 25) return false;
  if (/^[0-9]+$/.test(name)) return false;
  if (name.toLowerCase().includes('close') || 
      name.toLowerCase().includes('cancel') ||
      name.toLowerCase().includes('ok') ||
      name.toLowerCase() === 'profile') return false;
  return true;
}

function extractAndInjectProfileButtons(profileEl) {
  const nameEl = profileEl.querySelector('[class*="name"]') || 
                 profileEl.querySelector('.player-name') || 
                 profileEl.querySelector('.character-name') ||
                 profileEl.querySelector('.entity-name') ||
                 profileEl.querySelector('h3') ||
                 profileEl.querySelector('h4') ||
                 profileEl.querySelector('strong');
                 
  if (nameEl) {
    const text = (nameEl.textContent || '').trim();
    if (text && text !== meName && isValidPlayerName(text)) {
      injectRoleButtonsToProfile(profileEl, text);
    }
  }
}

function injectRoleButtonsToProfile(profileEl, targetName) {
  if (profileEl.dataset.mmInjected) return;
  profileEl.dataset.mmInjected = 'true';
  
  const myRole = rolesByName[meName] || 'innocent';
  const buttons = getRoleActionsForProfile(myRole, targetName);
  
  if (buttons.length === 0) return;
  
  const container = document.createElement('div');
  container.className = 'mm-profile-actions';
  container.style.cssText = `
    display: flex;
    gap: 6px;
    margin-top: 8px;
    padding: 8px;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 8px;
    justify-content: center;
    flex-wrap: wrap;
  `;
  
  buttons.forEach(btn => {
    const button = document.createElement('button');
    button.textContent = btn.label;
    button.style.cssText = `
      padding: 6px 12px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      font-weight: bold;
      font-size: 12px;
      background: ${btn.color};
      color: white;
      transition: transform 0.1s, opacity 0.1s;
    `;
    button.addEventListener('mouseenter', () => { button.style.opacity = '0.8'; });
    button.addEventListener('mouseleave', () => { button.style.opacity = '1'; });
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.action(targetName);
    });
    container.appendChild(button);
  });
  
  const insertTarget = profileEl.querySelector('.profile-buttons') || 
                       profileEl.querySelector('.actions') ||
                       profileEl.querySelector('.buttons') ||
                       profileEl;
                       
  if (insertTarget.lastChild) {
    insertTarget.insertBefore(container, insertTarget.lastChild.nextSibling);
  } else {
    insertTarget.appendChild(container);
  }
  
  console.log('[MM] Injected role buttons for:', targetName, 'as', myRole);
}

function getRoleActionsForProfile(role, targetName) {
  const buttons = [];
  
  switch(role) {
    case 'killer':
      buttons.push({
        label: '🔪 Atacar',
        color: 'linear-gradient(135deg, #e74c3c, #c0392b)',
        action: (name) => doAttack(name, 'killer')
      });
      break;
    case 'medic':
      buttons.push({
        label: '💊 Curar',
        color: 'linear-gradient(135deg, #2ecc71, #27ae60)',
        action: (name) => doHeal(name)
      });
      break;
    case 'detective':
      buttons.push({
        label: '🔍 Investigar',
        color: 'linear-gradient(135deg, #f1c40f, #f39c12)',
        action: (name) => doInvestigate(name)
      });
      break;
    case 'joker':
      break;
    case 'bodyguard':
      buttons.push({
        label: '🛡️ Proteger',
        color: 'linear-gradient(135deg, #3498db, #2980b9)',
        action: (name) => doProtect(name)
      });
      break;
    case 'psychic':
      buttons.push({
        label: '❄️ Congelar',
        color: 'linear-gradient(135deg, #00bcd4, #0097a7)',
        action: (name) => doFreeze(name)
      });
      buttons.push({
        label: '💀 Exterminar',
        color: 'linear-gradient(135deg, #673ab7, #512da8)',
        action: (name) => doExterminate(name)
      });
      break;
    case 'sheriff':
      buttons.push({
        label: '📢 Revelar',
        color: 'linear-gradient(135deg, #ff9800, #f57c00)',
        action: (name) => doRevealRole(name)
      });
      buttons.push({
        label: '🔫 Disparar',
        color: 'linear-gradient(135deg, #795548, #5d4037)',
        action: (name) => doShoot(name)
      });
      break;
    case 'jorguin':
      buttons.push({
        label: '⛔ Bloquear',
        color: 'linear-gradient(135deg, #607d8b, #455a64)',
        action: (name) => doBlockAbility(name)
      });
      buttons.push({
        label: '👹 Atacar',
        color: 'linear-gradient(135deg, #8b4513, #654321)',
        action: (name) => doAttack(name, 'jorguin')
      });
      break;
    case 'spy':
      buttons.push({
        label: '🕵️ Investigar',
        color: 'linear-gradient(135deg, #4b0082, #3a0066)',
        action: (name) => doSpyInvestigate(name)
      });
      buttons.push({
        label: '🗡️ Atacar',
        color: 'linear-gradient(135deg, #4b0082, #3a0066)',
        action: (name) => doAttack(name, 'spy')
      });
      break;
    case 'carpenter':
      break;
  }
  
  return buttons;
}

function doJokerDistract(targetName) {
  if (isOnCooldown('joker')) {
    showNotification('⏳ Habilidad en cooldown', 1500);
    return;
  }
  setCooldown('joker', 30000);
  wsSend({ t: 'jokerDistract', target: targetName, by: meName });
  showNotification(`🃏 Distrayendo a ${targetName}`, 2000);
}

function doProtect(targetName) {
  if (isOnCooldown('bodyguard')) {
    showNotification('⏳ Habilidad en cooldown', 1500);
    return;
  }
  setCooldown('bodyguard', 45000);
  wsSend({ t: 'protect', target: targetName, by: meName });
  showNotification(`🛡️ Protegiendo a ${targetName}`, 2000);
}

function doFreeze(targetName) {
  if (isOnCooldown('psychic_freeze')) {
    showNotification('⏳ Habilidad en cooldown', 1500);
    return;
  }
  setCooldown('psychic_freeze', 60000);
  wsSend({ t: 'freeze', target: targetName, by: meName });
  showNotification(`❄️ Congelando a ${targetName}`, 2000);
}

function doExterminate(targetName) {
  if (isOnCooldown('psychic_exterminate')) {
    showNotification('⏳ Habilidad en cooldown', 1500);
    return;
  }
  setCooldown('psychic_exterminate', 120000);
  wsSend({ t: 'exterminate', target: targetName, by: meName });
  showNotification(`💀 Exterminando a ${targetName}`, 2000);
}

function doRevealRole(targetName) {
  if (isOnCooldown('sheriff_reveal')) {
    showNotification('⏳ Habilidad en cooldown', 1500);
    return;
  }
  setCooldown('sheriff_reveal', 45000);
  wsSend({ t: 'revealRole', target: targetName, by: meName });
  showNotification(`📢 Revelando rol de ${targetName}`, 2000);
}

function doShoot(targetName) {
  if (isOnCooldown('sheriff_shoot')) {
    showNotification('⏳ Habilidad en cooldown', 1500);
    return;
  }
  setCooldown('sheriff_shoot', 90000);
  wsSend({ t: 'shoot', target: targetName, by: meName });
  showNotification(`🔫 Disparando a ${targetName}`, 2000);
}

function doBlockAbility(targetName) {
  if (isOnCooldown('jorguin_block')) {
    showNotification('⏳ Habilidad en cooldown', 1500);
    return;
  }
  setCooldown('jorguin_block', 60000);
  wsSend({ t: 'blockAbility', target: targetName, by: meName });
  showNotification(`⛔ Bloqueando habilidades de ${targetName}`, 2000);
}

function doSpyInvestigate(targetName) {
  if (isOnCooldown('spy_investigate')) {
    showNotification('⏳ Habilidad en cooldown', 1500);
    return;
  }
  setCooldown('spy_investigate', 45000);
  wsSend({ t: 'spyInvestigate', target: targetName, by: meName });
  showNotification(`🕵️ Investigando a ${targetName}`, 2000);
}

function doBuildBarricade(targetName) {
  if (isOnCooldown('carpenter')) {
    showNotification('⏳ Habilidad en cooldown', 1500);
    return;
  }
  setCooldown('carpenter', 30000);
  wsSend({ t: 'buildBarricade', target: targetName, by: meName });
  showNotification(`🔨 Construyendo barricada cerca de ${targetName}`, 2000);
}

function doAttack(targetName, myRole) {
  if (abilityBlocked && abilityBlockedUntil > Date.now()) {
    showNotification('⛔ ¡Tus habilidades están bloqueadas!', 2000);
    return;
  }
  
  let cooldownKey = 'killer';
  let cooldownMs = KILLER_COOLDOWN_MS;
  
  if (myRole === 'jorguin') {
    cooldownKey = 'jorguin_attack';
    cooldownMs = JORGUIN_ATTACK_COOLDOWN_MS;
  } else if (myRole === 'spy') {
    cooldownKey = 'spy_attack';
    cooldownMs = SPY_ATTACK_COOLDOWN_MS;
  }
  
  if (isOnCooldown(cooldownKey)) {
    showNotification('⏳ Habilidad en cooldown', 1500);
    return;
  }
  
  setCooldown(cooldownKey, cooldownMs);
  wsSend({ t: 'attack', target: targetName, by: meName });
  flashOverlay('rgba(255, 60, 60, 0.4)');
  showNotification(`🔪 Atacando a ${targetName}`, 2000);
  closeProfileModal();
}

function doHeal(targetName) {
  if (abilityBlocked && abilityBlockedUntil > Date.now()) {
    showNotification('⛔ ¡Tus habilidades están bloqueadas!', 2000);
    return;
  }
  
  if (isOnCooldown('medic')) {
    showNotification('⏳ Habilidad en cooldown', 1500);
    return;
  }
  
  setCooldown('medic', MEDIC_COOLDOWN_MS);
  wsSend({ t: 'heal', target: targetName, by: meName });
  flashOverlay('rgba(60, 255, 120, 0.4)');
  showNotification(`💊 Curando a ${targetName}`, 2000);
  closeProfileModal();
}

function doInvestigate(targetName) {
  if (abilityBlocked && abilityBlockedUntil > Date.now()) {
    showNotification('⛔ ¡Tus habilidades están bloqueadas!', 2000);
    return;
  }
  
  if (isOnCooldown('detective')) {
    showNotification('⏳ Habilidad en cooldown', 1500);
    return;
  }
  
  setCooldown('detective', DETECTIVE_COOLDOWN_MS);
  wsSend({ t: 'investigate', target: targetName, by: meName });
  showNotification(`🔍 Investigando a ${targetName}...`, 2000);
  closeProfileModal();
}

function toggleProtection(targetName) {
  if (guardState.protecting === targetName) {
    stopProtecting();
    showNotification('🛡️ Protección cancelada', 2000);
  } else {
    startProtecting(targetName);
    showNotification(`🛡️ Protegiendo a ${targetName}`, 2000);
  }
  closeProfileModal();
}

function startProtecting(targetName) {
  if (abilityBlocked && abilityBlockedUntil > Date.now()) {
    showNotification('⛔ ¡Tus habilidades están bloqueadas!', 2000);
    return;
  }
  
  guardState.protecting = targetName;
  wsSend({ t: 'protect', target: targetName, by: meName, active: true });
  updateBodyguardIndicator();
  refreshPlayersUI();
  
  if (guardState.checkInterval) clearInterval(guardState.checkInterval);
  guardState.checkInterval = setInterval(() => {
    if (rolesByName[meName] !== 'bodyguard' || !playersMap[targetName] || playersMap[targetName].alive === false) {
      stopProtecting();
    }
  }, 1000);
}

function stopProtecting() {
  if (guardState.protecting) {
    const prev = guardState.protecting;
    guardState.protecting = null;
    wsSend({ t: 'protect', target: prev, by: meName, active: false });
  }
  if (guardState.checkInterval) {
    clearInterval(guardState.checkInterval);
    guardState.checkInterval = null;
  }
  updateBodyguardIndicator();
  refreshPlayersUI();
}

function updateBodyguardIndicator() {
  const indicator = $('#flee-bodyguard-indicator');
  if (!indicator) return;
  
  if (guardState.protecting) {
    indicator.classList.add('active');
    indicator.innerHTML = `🛡️ Protegiendo: <strong>${escapeHTML(guardState.protecting)}</strong> <button id="stop-protect-btn" style="margin-left:10px;padding:4px 8px;background:#ff4444;border:none;border-radius:6px;color:white;cursor:pointer">Cancelar</button>`;
    const stopBtn = indicator.querySelector('#stop-protect-btn');
    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        stopProtecting();
        showNotification('🛡️ Protección cancelada', 2000);
      });
    }
  } else {
    indicator.classList.remove('active');
  }
}

function doFreeze(targetName) {
  if (isOnCooldown('psychic_freeze')) {
    showNotification('⏳ Habilidad en cooldown', 1500);
    return;
  }
  if (abilityBlocked) {
    showNotification('⛔ Tu habilidad está bloqueada', 1500);
    return;
  }
  
  setCooldown('psychic_freeze', PSYCHIC_FREEZE_COOLDOWN_MS);
  wsSend({ t: 'freezePlayer', target: targetName, by: meName });
  flashOverlay('rgba(135, 206, 250, 0.5)');
  showNotification(`❄️ Congelando a ${targetName}`, 2000);
  closeProfileModal();
}

function doExterminate(targetName) {
  if (cooldowns.psychic_exterminate_used) {
    showNotification('❌ Ya usaste Exterminar esta partida', 1500);
    return;
  }
  if (abilityBlocked) {
    showNotification('⛔ Tu habilidad está bloqueada', 1500);
    return;
  }
  
  cooldowns.psychic_exterminate_used = true;
  wsSend({ t: 'exterminatePlayer', target: targetName, by: meName });
  flashOverlay('rgba(138, 43, 226, 0.5)');
  showNotification(`💀 Exterminando a ${targetName}`, 2000);
  closeProfileModal();
}

function doReveal(targetName) {
  if (cooldowns.sheriff_reveal_used) {
    showNotification('❌ Ya usaste Revelar esta partida', 1500);
    return;
  }
  if (abilityBlocked) {
    showNotification('⛔ Tu habilidad está bloqueada', 1500);
    return;
  }
  
  cooldowns.sheriff_reveal_used = true;
  wsSend({ t: 'revealRole', target: targetName, by: meName });
  showNotification(`📢 Revelando el rol de ${targetName}`, 2000);
  closeProfileModal();
}

function doShoot(targetName) {
  if (isOnCooldown('sheriff_shoot')) {
    showNotification('⏳ Habilidad en cooldown', 1500);
    return;
  }
  if (abilityBlocked) {
    showNotification('⛔ Tu habilidad está bloqueada', 1500);
    return;
  }
  
  setCooldown('sheriff_shoot', SHERIFF_SHOOT_COOLDOWN_MS);
  wsSend({ t: 'sheriffShoot', target: targetName, by: meName });
  flashOverlay('rgba(139, 69, 19, 0.5)');
  showNotification(`🔫 Disparando a ${targetName}`, 2000);
  closeProfileModal();
}

function doBuildBarricade(targetName) {
  triggerCarpenterBuild();
  closeProfileModal();
}

function doJorguinBlock(targetName) {
  if (isOnCooldown('jorguin_block')) {
    showNotification('⏳ Habilidad en cooldown', 1500);
    return;
  }
  if (abilityBlocked) {
    showNotification('⛔ Tu habilidad está bloqueada', 1500);
    return;
  }
  
  setCooldown('jorguin_block', JORGUIN_BLOCK_COOLDOWN_MS);
  wsSend({ t: 'jorguinBlock', target: targetName, by: meName });
  flashOverlay('rgba(139, 69, 19, 0.5)');
  showNotification(`🖤 Bloqueando a ${targetName}`, 2000);
  closeProfileModal();
}

function doJorguinAttack(targetName) {
  if (isOnCooldown('jorguin_attack')) {
    showNotification('⏳ Habilidad en cooldown', 1500);
    return;
  }
  if (abilityBlocked) {
    showNotification('⛔ Tu habilidad está bloqueada', 1500);
    return;
  }
  
  setCooldown('jorguin_attack', JORGUIN_ATTACK_COOLDOWN_MS);
  wsSend({ t: 'jorguinAttack', target: targetName, by: meName });
  flashOverlay('rgba(139, 69, 19, 0.4)');
  showNotification(`🖤 Atacando a ${targetName}`, 2000);
  closeProfileModal();
}

function doSpyInvestigate(targetName) {
  if (isOnCooldown('spy_investigate')) {
    showNotification('⏳ Habilidad en cooldown', 1500);
    return;
  }
  if (abilityBlocked) {
    showNotification('⛔ Tu habilidad está bloqueada', 1500);
    return;
  }
  
  setCooldown('spy_investigate', SPY_INVESTIGATE_COOLDOWN_MS);
  wsSend({ t: 'spyInvestigate', target: targetName, by: meName });
  flashOverlay('rgba(75, 0, 130, 0.4)');
  showNotification(`🐈‍⬛ Investigando a ${targetName}...`, 2000);
  closeProfileModal();
}

function doSpyAttack(targetName) {
  if (isOnCooldown('spy_attack')) {
    showNotification('⏳ Habilidad en cooldown', 1500);
    return;
  }
  if (abilityBlocked) {
    showNotification('⛔ Tu habilidad está bloqueada', 1500);
    return;
  }
  
  setCooldown('spy_attack', SPY_ATTACK_COOLDOWN_MS);
  wsSend({ t: 'spyAttack', target: targetName, by: meName });
  flashOverlay('rgba(75, 0, 130, 0.4)');
  showNotification(`🐈‍⬛ Atacando a ${targetName}`, 2000);
  closeProfileModal();
}

function triggerJokerDistract() {
  if (abilityBlocked && abilityBlockedUntil > Date.now()) {
    showNotification('⛔ ¡Tus habilidades están bloqueadas!', 2000);
    return;
  }
  
  if (distractionActive) {
    showNotification('🃏 Ya hay una distracción activa', 1500);
    return;
  }
  
  if (isOnCooldown('joker_distract') || Date.now() < jokerCooldownUntil) {
    const remaining = Math.ceil((jokerCooldownUntil - Date.now()) / 1000);
    showNotification(`⏳ Cooldown: ${remaining}s`, 1500);
    return;
  }
  
  distractionActive = true;
  jokerCooldownUntil = Date.now() + JOKER_COOLDOWN_MS;
  setCooldown('joker_distract', JOKER_COOLDOWN_MS);
  
  spawnJokerBalloons(80);
  wsSend({ t: 'distract', duration: JOKER_DISTRACT_DURATION, by: meName });
  
  updateJokerButton();
  startJokerCooldownTicker();
  
  flashOverlay('rgba(170, 102, 255, 0.3)');
  showNotification('🃏 ¡Distracción activada!', 2000);
  closeProfileModal();
  
  setTimeout(() => { distractionActive = false; }, JOKER_DISTRACT_DURATION);
}

function spawnJokerBalloons(count = 80) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  
  for (let i = 0; i < count; i++) {
    const balloon = document.createElement('div');
    balloon.className = 'flee-joker-balloon';
    const size = 40 + Math.random() * 60;
    const left = Math.random() * vw;
    const hue = Math.floor(Math.random() * 360);
    
    Object.assign(balloon.style, {
      position: 'fixed',
      left: left + 'px',
      bottom: '-100px',
      width: size + 'px',
      height: (size * 1.2) + 'px',
      borderRadius: '50% 50% 50% 50% / 40% 40% 60% 60%',
      background: `hsl(${hue}, 70%, 60%)`,
      zIndex: '100500',
      pointerEvents: 'none',
      opacity: '0.9',
      transition: 'transform 4s ease-out, opacity 0.3s'
    });
    
    const string = document.createElement('div');
    Object.assign(string.style, {
      position: 'absolute',
      bottom: '-20px',
      left: '50%',
      width: '2px',
      height: '30px',
      background: '#666',
      transform: 'translateX(-50%)'
    });
    balloon.appendChild(string);
    
    document.body.appendChild(balloon);
    
    setTimeout(() => {
      const targetY = vh + 200 + Math.random() * 200;
      const drift = (Math.random() - 0.5) * 200;
      balloon.style.transform = `translateY(-${targetY}px) translateX(${drift}px) rotate(${Math.random() * 30 - 15}deg)`;
    }, 50 + i * 30);
    
    setTimeout(() => {
      balloon.style.opacity = '0';
      setTimeout(() => balloon.remove(), 500);
    }, 4000 + Math.random() * 1000);
  }
}

function createJokerButton() {
  removeJokerButton();
  if (!revealedRoleForMe || rolesByName[meName] !== 'joker') return;
  if (currentPhase !== 'running') return;
  
  const btn = document.createElement('button');
  btn.id = 'flee-joker-floating';
  btn.textContent = '🃏 ¡Haha!';
  Object.assign(btn.style, {
    position: 'fixed',
    left: '12px',
    bottom: '78px',
    zIndex: '100700',
    padding: '10px 14px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #9b59b6, #8e44ad)',
    color: '#fff',
    border: '2px solid rgba(0,0,0,0.2)',
    cursor: 'pointer',
    fontWeight: '900',
    fontSize: '14px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.45)'
  });
  
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (abilityBlocked && abilityBlockedUntil > Date.now()) {
      showNotification('⛔ ¡Tus habilidades están bloqueadas!', 2000);
      return;
    }
    if (Date.now() < jokerCooldownUntil) {
      showNotification('¡La habilidad aún no está lista!', 2000);
      return;
    }
    triggerJokerDistract();
  });
  
  document.body.appendChild(btn);
  _jokerFloatingBtn = btn;
  updateJokerButtonVisuals();
}

function removeJokerButton() {
  if (_jokerFloatingBtn && _jokerFloatingBtn.parentNode) {
    _jokerFloatingBtn.remove();
  }
  _jokerFloatingBtn = null;
}

function updateJokerButton() {
  updateJokerButtonVisuals();
}

function updateJokerButtonVisuals() {
  if (!_jokerFloatingBtn) return;
  
  // Check if ability is blocked
  if (abilityBlocked && abilityBlockedUntil > Date.now()) {
    const blockRemaining = Math.max(0, Math.ceil((abilityBlockedUntil - Date.now()) / 1000));
    _jokerFloatingBtn.textContent = `🃏 ⛔ Bloqueado (${blockRemaining}s)`;
    _jokerFloatingBtn.style.opacity = '0.5';
    _jokerFloatingBtn.style.background = 'linear-gradient(135deg, #666, #444)';
    _jokerFloatingBtn.disabled = true;
    return;
  }
  
  // Reset background to normal
  _jokerFloatingBtn.style.background = 'linear-gradient(135deg, #9b59b6, #8e44ad)';
  
  const remaining = Math.max(0, Math.ceil((jokerCooldownUntil - Date.now()) / 1000));
  if (Date.now() < jokerCooldownUntil) {
    _jokerFloatingBtn.textContent = `🃏 ¡Haha! (${remaining}s)`;
    _jokerFloatingBtn.style.opacity = '0.7';
    _jokerFloatingBtn.disabled = true;
  } else {
    _jokerFloatingBtn.textContent = '🃏 ¡Haha!';
    _jokerFloatingBtn.style.opacity = '1';
    _jokerFloatingBtn.disabled = false;
  }
}

function startJokerCooldownTicker() {
  if (jokerCooldownInterval) clearInterval(jokerCooldownInterval);
  
  jokerCooldownInterval = setInterval(() => {
    updateJokerButtonVisuals();
    if (Date.now() >= jokerCooldownUntil) {
      clearInterval(jokerCooldownInterval);
      jokerCooldownInterval = null;
      updateJokerButtonVisuals();
    }
  }, 1000);
}

function createCarpenterButton() {
  removeCarpenterButton();
  if (!revealedRoleForMe || rolesByName[meName] !== 'carpenter') return;
  if (currentPhase !== 'running') return;
  
  const btn = document.createElement('button');
  btn.id = 'flee-carpenter-floating';
  btn.innerHTML = '🧱 Barricada';
  Object.assign(btn.style, {
    position: 'fixed',
    left: '12px',
    bottom: '140px',
    zIndex: '100700',
    padding: '10px 14px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #8B4513, #A0522D)',
    color: '#fff',
    border: '2px solid rgba(0,0,0,0.2)',
    cursor: 'pointer',
    fontWeight: '900',
    fontSize: '14px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.45)'
  });
  
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (abilityBlocked && abilityBlockedUntil > Date.now()) {
      showNotification('⛔ ¡Tus habilidades están bloqueadas!', 2000);
      return;
    }
    triggerCarpenterBuild();
  });
  
  document.body.appendChild(btn);
  _carpenterFloatingBtn = btn;
  updateCarpenterButtonVisuals();
}

function removeCarpenterButton() {
  if (_carpenterFloatingBtn && _carpenterFloatingBtn.parentNode) {
    _carpenterFloatingBtn.remove();
  }
  _carpenterFloatingBtn = null;
}

function updateCarpenterButton() {
  updateCarpenterButtonVisuals();
}

function updateCarpenterButtonVisuals() {
  if (!_carpenterFloatingBtn) return;
  
  // Check if ability is blocked
  if (abilityBlocked && abilityBlockedUntil > Date.now()) {
    const blockRemaining = Math.max(0, Math.ceil((abilityBlockedUntil - Date.now()) / 1000));
    _carpenterFloatingBtn.innerHTML = `🔨 ⛔ Bloqueado (${blockRemaining}s)`;
    _carpenterFloatingBtn.style.opacity = '0.5';
    _carpenterFloatingBtn.style.background = 'linear-gradient(135deg, #666, #444)';
    _carpenterFloatingBtn.disabled = true;
    return;
  }
  
  // Reset background to normal
  _carpenterFloatingBtn.style.background = 'linear-gradient(135deg, #8B4513, #A0522D)';
  
  const remaining = Math.max(0, Math.ceil((cooldowns.carpenter_barricade - Date.now()) / 1000));
  if (isOnCooldown('carpenter_barricade')) {
    _carpenterFloatingBtn.innerHTML = `🧱 Barricada (${remaining}s)`;
    _carpenterFloatingBtn.style.opacity = '0.7';
    _carpenterFloatingBtn.disabled = true;
  } else {
    _carpenterFloatingBtn.innerHTML = '🧱 Barricada';
    _carpenterFloatingBtn.style.opacity = '1';
    _carpenterFloatingBtn.disabled = false;
  }
}

function triggerCarpenterBuild() {
  if (abilityBlocked && abilityBlockedUntil > Date.now()) {
    showNotification('⛔ Tu habilidad está bloqueada', 1500);
    return;
  }

  if (isOnCooldown('carpenter_barricade')) {
    const remaining = Math.ceil((cooldowns.carpenter_barricade - Date.now()) / 1000);
    showNotification(`⏳ Cooldown: ${remaining}s`, 1500);
    return;
  }

  setCooldown('carpenter_barricade', CARPENTER_BARRICADE_COOLDOWN_MS);

  const currentPosition = window._lastKnownPosition || { x: 0.5, y: 0.5 };

  wsSend({
    t: 'carpenterBuild',
    by: meName,
    position: currentPosition
  });
  showNotification('🧱 Barricada desplegada globalmente', 2000);
  flashOverlay('rgba(160, 82, 45, 0.3)');
}

function createBodyguardIndicator() {
  if ($('#flee-bodyguard-indicator')) return;
  
  const indicator = document.createElement('div');
  indicator.id = 'flee-bodyguard-indicator';
  document.body.appendChild(indicator);
}

function resetGameState() {
  cooldowns.killer = 0;
  cooldowns.medic = 0;
  cooldowns.detective = 0;
  cooldowns.bodyguard = 0;
  cooldowns.psychic_freeze = 0;
  cooldowns.psychic_exterminate_used = false;
  cooldowns.sheriff_reveal_used = false;
  cooldowns.sheriff_shoot = 0;
  cooldowns.jorguin_block = 0;
  cooldowns.jorguin_attack = 0;
  cooldowns.spy_investigate = 0;
  cooldowns.spy_attack = 0;
  cooldowns.carpenter_barricade = 0;
  cooldowns.joker_distract = 0;
  
  myTasksCompleted = 0;
  myTasksTotal = 0;
  globalTasksCompleted = 0;
  globalTasksTotal = 0;
  
  readyState.isReady = false;
  readyState.readyCount = 0;
  readyState.totalPlayers = 0;
  hideReadyOverlay();
  
  guardState.protecting = null;
  if (guardState.checkInterval) {
    clearInterval(guardState.checkInterval);
    guardState.checkInterval = null;
  }
  
  jokerCooldownUntil = 0;
  if (jokerCooldownInterval) {
    clearInterval(jokerCooldownInterval);
    jokerCooldownInterval = null;
  }
  
  distractionActive = false;
  revealedRoleForMe = false;
  controlLockState.jorguinCurseUntil = 0;
  controlLockState.psychicFrozenUntil = 0;
  controlLockState.sprintForcedByCurse = false;
  clearExterminateTimerState();
  window.postMessage({ source: 'radar-admin', type: 'setSprintBlocked', blocked: false }, '*');
  
  Object.keys(protectedBy).forEach(k => delete protectedBy[k]);
  investigatedPlayers.length = 0;
  spyInvestigatedPlayers.length = 0;
  Object.keys(publicReveals).forEach(k => delete publicReveals[k]);
  
  removeJokerButton();
  removeCarpenterButton();
  updateBodyguardIndicator();
}

function populateCustomizePreview() {
  const preview = $('#cust-preview');
  if (!preview) return;
  
  const bg = $('#cust-bg').value;
  const op = parseFloat($('#cust-opacity').value);
  const border = $('#cust-border').value;
  const text = $('#cust-text').value;
  
  const rgba = hexToRgba(bg, op);
  preview.style.background = rgba;
  preview.style.border = `2px solid ${border}`;
  preview.style.color = text;
  preview.innerHTML = `
    <div style="font-weight:800;margin-bottom:8px">Panel - Vista previa</div>
    <div style="height:16px;background:#222;border-radius:6px;overflow:hidden">
      <div style="width:65%;height:100%;background:linear-gradient(90deg,#2ecc71,#45c35f)"></div>
    </div>
    <div style="margin-top:6px;font-size:12px">Texto de ejemplo</div>
  `;
}

function setupDragAndDrop(uiWrap, resetScreen) {
  const storedPos = (() => {
    try {
      return JSON.parse(localStorage.getItem('flee_ui_pos_v1') || 'null');
    } catch(e) {
      return null;
    }
  })();
  
  if (storedPos && typeof storedPos.x === 'number') {
    uiWrap.style.left = storedPos.x + 'px';
    uiWrap.style.top = storedPos.y + 'px';
    uiWrap.style.transform = 'none';
    uiWrap.style.position = 'fixed';
  }
  
  let dragging = false;
  let dragOffset = { x: 0, y: 0 };
  const boxEl = $('#flee-box');
  
  boxEl.addEventListener('mousedown', (ev) => {
    if (ev.target.closest('#flee-customize-btn') || 
        ev.target.closest('#flee-top-left-reset') || 
        ev.target.closest('#flee-custom-modal')) {
      return;
    }
    dragging = true;
    const rect = uiWrap.getBoundingClientRect();
    dragOffset.x = ev.clientX - rect.left;
    dragOffset.y = ev.clientY - rect.top;
    uiWrap.style.cursor = 'grabbing';
    boxEl.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  });
  
  window.addEventListener('mousemove', (ev) => {
    if (!dragging) return;
    uiWrap.style.left = (ev.clientX - dragOffset.x) + 'px';
    uiWrap.style.top = (ev.clientY - dragOffset.y) + 'px';
    uiWrap.style.transform = 'none';
    uiWrap.style.position = 'fixed';
  });
  
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    uiWrap.style.cursor = '';
    boxEl.style.cursor = 'grab';
    document.body.style.userSelect = '';
    const r = uiWrap.getBoundingClientRect();
    localStorage.setItem('flee_ui_pos_v1', JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) }));
  });
  
  function resetPosition() {
    localStorage.removeItem('flee_ui_pos_v1');
    uiWrap.style.left = '50%';
    uiWrap.style.top = '8px';
    uiWrap.style.transform = 'translateX(-50%)';
    uiWrap.style.position = 'fixed';
    showToast('Posición restablecida');
  }
  
  $('#flee-top-left-reset').addEventListener('click', resetPosition);
  resetScreen.addEventListener('click', resetPosition);
}

function setupCustomizationModal() {
  $('#flee-customize-btn').addEventListener('click', () => {
    $('#flee-custom-modal').style.display = 'flex';
    $('#cust-bg').value = custom.bg;
    $('#cust-opacity').value = custom.bgOpacity;
    $('#cust-border').value = custom.border;
    $('#cust-text').value = custom.text;
    populateCustomizePreview();
  });
  
  $('#cust-close').addEventListener('click', () => {
    $('#flee-custom-modal').style.display = 'none';
  });
  
  $('#cust-reset').addEventListener('click', () => {
    custom.bg = DEFAULT_CUSTOM_THEME.bg;
    custom.bgOpacity = DEFAULT_CUSTOM_THEME.bgOpacity;
    custom.border = DEFAULT_CUSTOM_THEME.border;
    custom.text = DEFAULT_CUSTOM_THEME.text;
    
    $('#cust-bg').value = DEFAULT_CUSTOM_THEME.bg;
    $('#cust-opacity').value = DEFAULT_CUSTOM_THEME.bgOpacity;
    $('#cust-border').value = DEFAULT_CUSTOM_THEME.border;
    $('#cust-text').value = DEFAULT_CUSTOM_THEME.text;
    
    localStorage.setItem('flee_custom_bg', DEFAULT_CUSTOM_THEME.bg);
    localStorage.setItem('flee_custom_bgOpacity', DEFAULT_CUSTOM_THEME.bgOpacity.toString());
    localStorage.setItem('flee_custom_border', DEFAULT_CUSTOM_THEME.border);
    localStorage.setItem('flee_custom_text', DEFAULT_CUSTOM_THEME.text);
    
    setCssVarsForCustom(custom.bg, custom.bgOpacity, custom.border, custom.text);
    populateCustomizePreview();
    showToast('Valores por defecto restaurados');
  });
  
  $('#cust-save').addEventListener('click', () => {
    custom.bg = sanitizeHexColor($('#cust-bg').value, DEFAULT_CUSTOM_THEME.bg);
    custom.bgOpacity = clampOpacity($('#cust-opacity').value);
    custom.border = sanitizeHexColor($('#cust-border').value, DEFAULT_CUSTOM_THEME.border);
    custom.text = sanitizeHexColor($('#cust-text').value, DEFAULT_CUSTOM_THEME.text);
    
    localStorage.setItem('flee_custom_bg', custom.bg);
    localStorage.setItem('flee_custom_bgOpacity', custom.bgOpacity.toString());
    localStorage.setItem('flee_custom_border', custom.border);
    localStorage.setItem('flee_custom_text', custom.text);
    
    setCssVarsForCustom(custom.bg, custom.bgOpacity, custom.border, custom.text);
    $('#flee-custom-modal').style.display = 'none';
    showToast('Personalización guardada');
  });
  
  ['cust-bg', 'cust-opacity', 'cust-border', 'cust-text'].forEach(id => {
    const el = $('#' + id);
    if (el) {
      el.addEventListener('input', () => {
        const bg = sanitizeHexColor($('#cust-bg').value, DEFAULT_CUSTOM_THEME.bg);
        const op = clampOpacity($('#cust-opacity').value);
        const border = sanitizeHexColor($('#cust-border').value, DEFAULT_CUSTOM_THEME.border);
        const text = sanitizeHexColor($('#cust-text').value, DEFAULT_CUSTOM_THEME.text);
        setCssVarsForCustom(bg, op, border, text);
        populateCustomizePreview();
      });
    }
  });
  
  populateCustomizePreview();
}

function createUI(){
  const ui = document.createElement('div');
  ui.id = 'flee-ui';
  ui.innerHTML = `
    <div id="flee-box">
      <div id="flee-top-left-reset" title="Resetear posición">⟲</div>
      <div id="flee-customize-btn" title="Personalizar panel">⚙️</div>
      <div id="flee-role">Cargando...</div>
      <div id="flee-health">
        <div id="flee-health-inner">100%</div>
      </div>
      <div id="flee-sprint" style="position:relative;">
        <div id="flee-sprint-inner"></div>
        <div id="flee-hourglass-timer"></div>
      </div>
      <div id="flee-coins-display" style="display:none">💰 <span id="flee-coins-count">0</span> monedas</div>
      <div class="flee-tasks-info">
        <div id="flee-my-tasks">📋 Tareas: 0/0</div>
        <div id="flee-global-tasks">🌍 Total: 0/0</div>
      </div>
      <div class="flee-section" id="flee-players-section">
        <div class="flee-section-header" id="flee-players-header">
          <span class="flee-section-title" style="margin-bottom:0">👥 Jugadores</span>
          <span class="flee-section-toggle" id="flee-players-toggle">▼</span>
        </div>
        <div id="flee-players" class="flee-section-content"></div>
      </div>
      <div class="flee-section" id="flee-inventory-section" style="display:none">
        <div class="flee-section-header" id="flee-inventory-header">
          <span class="flee-section-title" style="margin-bottom:0">🎒 Inventario</span>
          <span class="flee-section-toggle" id="flee-inventory-toggle">▼</span>
        </div>
        <div id="flee-inventory-items" class="flee-section-content"></div>
      </div>
    </div>
  `;
  document.body.appendChild(ui);
  
  const smokeBombOverlay = document.createElement('div');
  smokeBombOverlay.id = 'flee-smokebomb-overlay';
  smokeBombOverlay.innerHTML = '<div id="flee-smokebomb-msg">💨 Visión nublada <span id="flee-smokebomb-timer"></span></div>';
  document.body.appendChild(smokeBombOverlay);
  
  const targetSelectOverlay = document.createElement('div');
  targetSelectOverlay.id = 'flee-target-select-overlay';
  targetSelectOverlay.innerHTML = `
    <div id="flee-target-select-content">
      <div id="flee-target-select-title">Selecciona un objetivo</div>
      <div id="flee-target-select-list"></div>
      <button id="flee-target-select-cancel">Cancelar</button>
    </div>
  `;
  document.body.appendChild(targetSelectOverlay);
  
  $('#flee-target-select-cancel').addEventListener('click', cancelTargetSelection);
  
  const resetScreen = document.createElement('div');
  resetScreen.id = 'flee-top-left-reset-screen';
  resetScreen.title = 'Resetear posición (pantalla)';
  resetScreen.innerText = '⟲';
  document.body.appendChild(resetScreen);
  
  const centerMsg = document.createElement('div');
  centerMsg.id = 'flee-center-msg';
  centerMsg.innerHTML = `
    <div id="flee-center-msg-content">
      <div class="flee-roulette-container">
        <div class="flee-roulette-track" id="flee-roulette-track"></div>
        <div class="flee-roulette-pointer"></div>
      </div>
      <div id="center-role">Esperando...</div>
      <div id="center-role-desc" style="color:var(--flee-text);margin-top:10px"></div>
    </div>
  `;
  document.body.appendChild(centerMsg);
  
  const frozenOverlay = document.createElement('div');
  frozenOverlay.id = 'flee-frozen-overlay';
  frozenOverlay.innerHTML = '<div id="flee-frozen-msg">❄️ CONGELADO - Inmune a ataques <span id="flee-frozen-timer"></span></div>';
  document.body.appendChild(frozenOverlay);
  
  const blockedOverlay = document.createElement('div');
  blockedOverlay.id = 'flee-blocked-overlay';
  blockedOverlay.innerHTML = '<div id="flee-blocked-msg"><div id="flee-blocked-timer">0s</div><div>⛔ Hechizado - Habilidades bloqueadas</div></div>';
  document.body.appendChild(blockedOverlay);

  const exterminateTimer = document.createElement('div');
  exterminateTimer.id = 'flee-exterminate-timer';
  exterminateTimer.style.display = 'none';
  document.body.appendChild(exterminateTimer);
  
  const readyOverlay = document.createElement('div');
  readyOverlay.id = 'flee-ready-overlay';
  readyOverlay.innerHTML = `
    <div id="flee-ready-content">
      <div id="flee-ready-icon">📍</div>
      <div id="flee-ready-title">¡Prepárate para comenzar!</div>
      <div id="flee-ready-message">Dirígete al punto rojo de inicio para activar el radar.</div>
      <div id="flee-ready-counter">Jugadores listos: <span id="flee-ready-count">0</span>/<span id="flee-ready-total">0</span></div>
      <button id="flee-ready-btn">¡Listo!</button>
      <div id="flee-ready-waiting">Esperando a los demás jugadores...</div>
    </div>
  `;
  document.body.appendChild(readyOverlay);
  
  $('#flee-ready-btn').addEventListener('click', handleReadyClick);
  
  const customModal = document.createElement('div');
  customModal.id = 'flee-custom-modal';
  customModal.innerHTML = `
    <div class="box">
      <h3>⚙️ Personalizar panel</h3>
      <div class="flee-form-row">
        <label>Fondo</label>
        <input type="color" id="cust-bg" value="${custom.bg}">
        <label style="margin-left:10px">Opacidad</label>
        <input id="cust-opacity" type="range" min="0" max="1" step="0.01" value="${custom.bgOpacity}">
      </div>
      <div class="flee-form-row">
        <label>Borde</label>
        <input type="color" id="cust-border" value="${custom.border}">
      </div>
      <div class="flee-form-row">
        <label>Color texto</label>
        <input type="color" id="cust-text" value="${custom.text}">
      </div>
      <div class="flee-form-row">
        <label>Vista previa</label>
      </div>
      <div class="flee-preview" id="cust-preview"></div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px">
        <button id="cust-reset" class="flee-small">Reset por defecto</button>
        <button id="cust-close" class="flee-small">Cerrar</button>
        <button id="cust-save" class="flee-small" style="background:var(--flee-border);color:var(--flee-bg-solid)">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(customModal);
  
  const toast = document.createElement('div');
  toast.id = 'flee-toast';
  document.body.appendChild(toast);
  
  setupDragAndDrop(ui, resetScreen);
  setupCustomizationModal();
  
  createProfileModal();
  createBodyguardIndicator();
  setupSectionToggles();
}

function setupSectionToggles(){
  const playersCollapsed = localStorage.getItem('flee_players_collapsed') === 'true';
  const inventoryCollapsed = localStorage.getItem('flee_inventory_collapsed') === 'true';
  
  const playersHeader = $('#flee-players-header');
  const playersContent = $('#flee-players');
  const playersToggle = $('#flee-players-toggle');
  
  const inventoryHeader = $('#flee-inventory-header');
  const inventoryContent = $('#flee-inventory-items');
  const inventoryToggle = $('#flee-inventory-toggle');
  
  if (playersCollapsed && playersContent && playersToggle) {
    playersContent.classList.add('collapsed');
    playersToggle.classList.add('collapsed');
    playersToggle.textContent = '▶';
  }
  
  if (inventoryCollapsed && inventoryContent && inventoryToggle) {
    inventoryContent.classList.add('collapsed');
    inventoryToggle.classList.add('collapsed');
    inventoryToggle.textContent = '▶';
  }
  
  if (playersHeader) {
    playersHeader.addEventListener('click', () => {
      const isCollapsed = playersContent.classList.toggle('collapsed');
      playersToggle.classList.toggle('collapsed', isCollapsed);
      playersToggle.textContent = isCollapsed ? '▶' : '▼';
      localStorage.setItem('flee_players_collapsed', isCollapsed.toString());
    });
  }
  
  if (inventoryHeader) {
    inventoryHeader.addEventListener('click', () => {
      const isCollapsed = inventoryContent.classList.toggle('collapsed');
      inventoryToggle.classList.toggle('collapsed', isCollapsed);
      inventoryToggle.textContent = isCollapsed ? '▶' : '▼';
      localStorage.setItem('flee_inventory_collapsed', isCollapsed.toString());
    });
  }
}

function updateHealthUI(){
  const inner = $('#flee-health-inner');
  if (!inner) return;
  const pct = Math.max(0, Math.min(100, health));
  inner.style.width = pct + '%';
  inner.textContent = Math.round(pct) + '%';
  if (pct < 30) inner.style.background = 'linear-gradient(90deg,#e74c3c,#c0392b)';
  else if (pct < 60) inner.style.background = 'linear-gradient(90deg,#f39c12,#e67e22)';
  else inner.style.background = 'linear-gradient(90deg,#2ecc71,#45c35f)';
}

function updateSprintUI(){
  const inner = $('#flee-sprint-inner');
  if (!inner) return;
  const pct = Math.max(0, Math.min(100, sprint.value));
  inner.style.width = pct + '%';
  
  if (sprint.exhausted) {
    inner.classList.add('exhausted');
  } else {
    inner.classList.remove('exhausted');
  }
}

function simulateKeyJ(){
  try {
    const keyDownEvent = new KeyboardEvent('keydown', {
      key: 'j',
      code: 'KeyJ',
      keyCode: 74,
      which: 74,
      bubbles: true,
      cancelable: true
    });
    const keyUpEvent = new KeyboardEvent('keyup', {
      key: 'j',
      code: 'KeyJ',
      keyCode: 74,
      which: 74,
      bubbles: true,
      cancelable: true
    });
    
    document.dispatchEvent(keyDownEvent);
    setTimeout(() => document.dispatchEvent(keyUpEvent), 50);
    
    const activeElement = document.activeElement;
    if (activeElement && activeElement !== document.body) {
      activeElement.dispatchEvent(keyDownEvent);
      setTimeout(() => activeElement.dispatchEvent(keyUpEvent), 50);
    }
    
    const gameCanvas = document.querySelector('canvas') || document.querySelector('.game-container') || document.querySelector('#game');
    if (gameCanvas) {
      gameCanvas.dispatchEvent(keyDownEvent);
      setTimeout(() => gameCanvas.dispatchEvent(keyUpEvent), 50);
    }
    
    console.log('[Sprint] Simulated J key press');
  } catch(e) {
    console.warn('[Sprint] Error simulating J key:', e);
  }
}

function clickPlayButton(){
  try {
    const playButtonSelectors = [
      '.play-button',
      'button.play',
      '[class*="play"]',
      'button[aria-label*="play"]',
      'button[title*="play"]',
      '.btn-play',
      '#play-button',
      'ui-button[title*="Play"] button',
      '.action-button.play',
      'button.action-bar-button',
      '.game-button.play'
    ];
    
    for (const selector of playButtonSelectors) {
      const btn = document.querySelector(selector);
      if (btn && btn.offsetParent !== null) {
        btn.click();
        console.log('[Sprint] Clicked play button:', selector);
        return true;
      }
    }
    
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
      const text = (btn.textContent || '').toLowerCase();
      const title = (btn.getAttribute('title') || '').toLowerCase();
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      
      if ((text.includes('play') || title.includes('play') || ariaLabel.includes('play')) && btn.offsetParent !== null) {
        btn.click();
        console.log('[Sprint] Clicked play button by text match');
        return true;
      }
    }
    
    console.log('[Sprint] No play button found');
    return false;
  } catch(e) {
    console.warn('[Sprint] Error clicking play button:', e);
    return false;
  }
}

function triggerSprintExhaustedActions(){
  flashOverlay('rgba(255, 140, 0, 0.6)', 600);
  
  setTimeout(() => simulateKeyJ(), 100);
  
  setTimeout(() => clickPlayButton(), 200);
  
  showNotification('⚡ Sprint agotado - Regenerando...', 2000);
}

function updateTasksUI(){
  const num = $('#flee-tasks-num');
  const total = $('#flee-tasks-total');
  if (num) num.textContent = settings.tasksTotal - tasksRemaining;
  if (total) total.textContent = settings.tasksTotal;
  
  const myTasksEl = $('#flee-my-tasks');
  const globalTasksEl = $('#flee-global-tasks');
  
  if (myTasksEl) {
    myTasksEl.textContent = `📋 Tareas: ${myTasksCompleted}/${myTasksTotal}`;
    if (myTasksCompleted >= myTasksTotal && myTasksTotal > 0) {
      myTasksEl.style.color = '#2ecc71';
    } else {
      myTasksEl.style.color = 'var(--flee-border)';
    }
  }
  
  if (globalTasksEl) {
    globalTasksEl.textContent = `🌍 Total: ${globalTasksCompleted}/${globalTasksTotal}`;
  }
}

function updateCoinsUI(){
  const display = $('#flee-coins-display');
  const count = $('#flee-coins-count');
  if (!display || !count) return;
  if (settings.coinsEnabled) {
    display.style.display = 'block';
    count.textContent = myCoins;
  } else {
    display.style.display = 'none';
  }
}

let activeNotifications = [];

function removeNotificationElement(notif) {
  if (!notif || notif.dataset.removing === '1') return;
  notif.dataset.removing = '1';
  if (notif._dismissTimer) {
    clearTimeout(notif._dismissTimer);
    notif._dismissTimer = null;
  }
  notif.classList.add('is-leaving');
  setTimeout(() => {
    notif.remove();
    activeNotifications = activeNotifications.filter(n => n !== notif);
  }, 220);
}

function showNotification(message, duration = 3000){
  const notif = document.createElement('div');
  notif.className = 'flee-notification';

  const mentionedPlayer = findMentionedPlayerName(message);
  if (mentionedPlayer) {
    const avatar = document.createElement('img');
    avatar.className = 'notif-avatar';
    avatar.src = getAvatarForPlayer(mentionedPlayer);
    avatar.alt = mentionedPlayer;
    notif.appendChild(avatar);
  }

  const text = document.createElement('div');
  text.className = 'notif-text';
  text.textContent = message;
  notif.appendChild(text);

  const stack = getToastStack();
  stack.appendChild(notif);
  activeNotifications.push(notif);

  const MAX_NOTIFICATIONS = 5;
  if (activeNotifications.length > MAX_NOTIFICATIONS) {
    removeNotificationElement(activeNotifications[0]);
  }

  notif._dismissTimer = setTimeout(() => {
    removeNotificationElement(notif);
  }, duration);
}

function showDeathThenReload(){
  const deathNote = $('#flee-death-note');
  if (deathNote) deathNote.style.display = 'block';
  
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.85);
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: Inter, system-ui;
  `;
  overlay.innerHTML = `
    <div style="text-align:center;color:white;padding:40px;background:rgba(20,0,0,0.9);border:3px solid #ff4444;border-radius:20px;box-shadow:0 0 60px rgba(255,0,0,0.3)">
      <div style="font-size:64px;margin-bottom:20px">💀</div>
      <h1 style="font-size:36px;margin:0 0 15px 0;color:#ff4444">¡Has muerto!</h1>
      <p style="opacity:0.8;margin:0">Espera a que la partida termine e inicie una nueva...</p>
      <p style="margin-top:20px;font-size:14px;opacity:0.6">Recargando página...</p>
    </div>
  `;
  document.body.appendChild(overlay);
  
  setTimeout(() => {
    try { location.reload(); } catch(e) {}
  }, 2000);
}

function showVictoryScreen(title, subtitle, color) {
  const existing = $('#flee-victory-screen');
  if (existing) existing.remove();
  
  const screen = document.createElement('div');
  screen.id = 'flee-victory-screen';
  screen.innerHTML = `
    <div class="flee-victory-content">
      <h1 style="color:${color}">${title}</h1>
      <p>${subtitle}</p>
      <button class="flee-btn" onclick="this.parentElement.parentElement.remove(); resetGameState();">Cerrar</button>
    </div>
  `;
  screen.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 999999;
    background: rgba(0,0,0,0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: Inter, system-ui;
  `;
  
  const content = screen.querySelector('.flee-victory-content');
  content.style.cssText = `
    text-align: center;
    padding: 40px;
    background: rgba(10,22,40,0.95);
    border: 3px solid ${color};
    border-radius: 20px;
    box-shadow: 0 0 60px ${color}40;
  `;
  
  const h1 = content.querySelector('h1');
  h1.style.cssText = `
    font-size: 48px;
    font-weight: 900;
    margin: 0 0 20px 0;
    text-shadow: 0 4px 20px ${color}80;
  `;
  
  const p = content.querySelector('p');
  p.style.cssText = `
    font-size: 24px;
    color: var(--flee-text);
    margin: 0 0 30px 0;
  `;
  
  document.body.appendChild(screen);
}

function syncRadarCoins() {
  window.postMessage({
    type: 'FLEE_RADAR_UPDATE',
    coins: coinsOnMap.filter(c => !c.collected)
  }, '*');
}

let lastPositionSentTime = 0;
const POSITION_SEND_INTERVAL = 200; // Send position every 200ms

window.addEventListener('message', (ev) => {
  if (!ev.data) return;
  
  if (ev.data.source === 'radar-admin' && ev.data.type === 'positionUpdate') {
    window._lastKnownPosition = ev.data.position;
    window.islandPlayerPos = ev.data.position;
    
    // Send position to server periodically for tracking
    const now = Date.now();
    if (now - lastPositionSentTime > POSITION_SEND_INTERVAL && ws && ws.readyState === 1 && currentPhase === 'running') {
      lastPositionSentTime = now;
      wsSend({
        t: 'updatePosition',
        x: ev.data.position.x,
        y: ev.data.position.y
      });
    }
    return;
  }
  
  if (ev.data.source !== 'ft-radar') return;
  
  if (ev.data.type === 'taskComplete') {
    console.log('[TASKS] Tarea completada desde radar, index:', ev.data.index);
    wsSend({ t: 'taskCompleted', index: ev.data.index });
  }
  
  if (ev.data.type === 'purchaseItem') {
    console.log('[SHOP] Compra solicitada desde radar:', ev.data.itemId);
    wsSend({
      t: 'purchaseItem',
      gameId: GAME_ID,
      shopKey: ev.data.shopKey,
      itemId: ev.data.itemId,
      price: ev.data.price
    });
  }
  
  if (ev.data.type === 'collectCoin') {
    wsSend({
      t: 'collectCoin',
      gameId: GAME_ID,
      coinId: ev.data.coinId
    });
  }
});

function handleReadyClick() {
  if (readyState.isReady) return;
  
  readyState.isReady = true;
  wsSend({ t: 'playerReady' });
  
  const btn = $('#flee-ready-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '✓ ¡Listo!';
    btn.classList.add('clicked');
  }
  
  const waiting = $('#flee-ready-waiting');
  if (waiting) {
    waiting.classList.add('visible');
  }
  
  showNotification('✓ Esperando a los demás jugadores...', 3000);
}

function showReadyOverlay() {
  const overlay = $('#flee-ready-overlay');
  if (!overlay) return;
  
  readyState.isReady = false;
  
  const btn = $('#flee-ready-btn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = '¡Listo!';
    btn.classList.remove('clicked');
  }
  
  const waiting = $('#flee-ready-waiting');
  if (waiting) {
    waiting.classList.remove('visible');
  }
  
  overlay.style.display = 'flex';
}

function hideReadyOverlay() {
  const overlay = $('#flee-ready-overlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
}

function updateReadyCounter(readyCount, totalPlayers) {
  readyState.readyCount = readyCount;
  readyState.totalPlayers = totalPlayers;
  
  const countEl = $('#flee-ready-count');
  const totalEl = $('#flee-ready-total');
  
  if (countEl) countEl.textContent = readyCount;
  if (totalEl) totalEl.textContent = totalPlayers;
}

async function playRoleRoulette(){
  if (roleRevealPlayed) return;
  roleRevealPlayed = true;
  
  const center = $('#flee-center-msg');
  const roleEl = $('#center-role');
  if (!center || !roleEl) return;
  
  center.style.display = 'flex';
  
  const roles = [
    { key: 'killer', text: 'Asesino', color: '#ff4444' },
    { key: 'medic', text: 'Médico', color: '#44ff88' },
    { key: 'innocent', text: 'Inocente', color: '#4499ff' },
    { key: 'detective', text: 'Detective', color: '#ffcc00' },
    { key: 'joker', text: 'Joker', color: '#aa66ff' },
    { key: 'bodyguard', text: 'Guardaespaldas', color: '#3399ff' },
    { key: 'psychic', text: 'Psíquico', color: '#8a2be2' },
    { key: 'sheriff', text: 'Alguacil', color: '#daa520' },
    { key: 'jorguin', text: 'Jorguín', color: '#8b4513' },
    { key: 'spy', text: 'Espía', color: '#4b0082' },
    { key: 'carpenter', text: 'Carpintero', color: '#a0522d' }
  ];
  
  const track = $('#flee-roulette-track');
  track.innerHTML = roles.map(r => 
    `<div class="flee-roulette-item" style="color:${r.color}">${r.text}</div>`
  ).join('');
  
  const startTime = Date.now();
  const spinDuration = 3000;
  let currentIndex = 0;
  
  const spinInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    if (elapsed >= spinDuration) {
      clearInterval(spinInterval);
      setTimeout(() => showFinalRole(), 500);
      return;
    }
    
    const speed = 50 + (elapsed / spinDuration) * 150;
    currentIndex = (currentIndex + 1) % roles.length;
    roleEl.textContent = roles[currentIndex].text;
    roleEl.style.color = roles[currentIndex].color;
  }, 100);
}

function showFinalRole(){
  const roleEl = $('#center-role');
  const myRole = rolesByName[meName] || 'innocent';
  const roleInfo = {
    killer: { text: 'Asesino', color: '#ff4444', desc: '🔪 Elimina a todos los jugadores' },
    medic: { text: 'Médico', color: '#44ff88', desc: '💊 Cura y protege a otros' },
    innocent: { text: 'Inocente', color: '#4499ff', desc: '👤 Completa tareas para ganar' },
    detective: { text: 'Detective', color: '#ffcc00', desc: '🔍 Investiga y descubre roles' },
    joker: { text: 'Joker', color: '#aa66ff', desc: '🃏 Causa distracciones' },
    bodyguard: { text: 'Guardaespaldas', color: '#3399ff', desc: '🛡️ Protege a otros jugadores' },
    psychic: { text: 'Psíquico', color: '#8a2be2', desc: '👽 Congela o extermina' },
    sheriff: { text: 'Alguacil', color: '#daa520', desc: '⭐ Revela roles y dispara' },
    jorguin: { text: 'Jorguín', color: '#8b4513', desc: '🖤 Bloquea habilidades' },
    spy: { text: 'Espía', color: '#4b0082', desc: '🐈‍⬛ Investiga en secreto' },
    carpenter: { text: 'Carpintero', color: '#a0522d', desc: '🔨 Construye barricadas' }
  };
  
  const info = roleInfo[myRole] || roleInfo.innocent;
  roleEl.textContent = info.text;
  roleEl.style.color = info.color;
  roleEl.style.transform = 'scale(1.2)';
  $('#center-role-desc').textContent = info.desc;
  
  setTimeout(() => {
    $('#flee-center-msg').style.display = 'none';
    setRoleText(myRole);
    revealedRoleForMe = true;
    createJokerButton();
    removeCarpenterButton();
    refreshPlayersUI();
    showReadyOverlay();
  }, 3000);
}

function setRoleText(role){
  const roleEl = $('#flee-role');
  if (!roleEl) return;
  const roleInfo = {
    killer: { text: '🔪 Asesino', color: '#ff4444' },
    medic: { text: '💊 Médico', color: '#44ff88' },
    innocent: { text: '👤 Inocente', color: '#4499ff' },
    detective: { text: '🔍 Detective', color: '#ffcc00' },
    joker: { text: '🃏 Joker', color: '#aa66ff' },
    bodyguard: { text: '🛡️ Guardaespaldas', color: '#3399ff' },
    psychic: { text: '👽 Psíquico', color: '#8a2be2' },
    sheriff: { text: '⭐ Alguacil', color: '#daa520' },
    jorguin: { text: '🖤 Jorguín', color: '#8b4513' },
    spy: { text: '🐈‍⬛ Espía', color: '#4b0082' },
    carpenter: { text: '🔨 Carpintero', color: '#a0522d' }
  };
  const info = roleInfo[role] || roleInfo.innocent;
  roleEl.textContent = info.text;
  roleEl.style.color = info.color;
}

function wsConnect(){
  try {
    ws = new WebSocket(WS_URL);
  } catch(e) {
    scheduleReconnect();
    return;
  }
  
  ws.onopen = () => {
    connected = true;
    console.log('[WS] Conectado');
    if (meName) doRegister();
  };
  
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      handleWsMessage(msg);
    } catch(e) {
      console.warn('[WS] Parse error', e);
    }
  };
  
  ws.onclose = () => {
    connected = false;
    console.log('[WS] Desconectado');
    scheduleReconnect();
  };
  
  ws.onerror = (e) => {
    console.warn('[WS] Error', e);
  };
}

let reconnectTimer = null;
function scheduleReconnect(){
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    wsConnect();
  }, 2000);
}

function wsSend(obj){
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  } catch(e) {
    console.error('[WS] Send error', e);
  }
}

function doRegister(){
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  wsSend({
    t: 'register',
    gameId: GAME_ID,
    name: meName,
    avatarUrl: meAvatarData || '',
    clientType: 'player'
  });
}

function handleWsMessage(msg){
  switch (msg.t) {
    case 'welcome':
      console.log('[WS]', msg.message);
      break;
    case 'gameState':
      if (msg.phase) currentPhase = msg.phase;
      if (msg.role) rolesByName[meName] = msg.role;
      if (typeof msg.health === 'number') {
        health = msg.health;
        updateHealthUI();
      }
      if (typeof msg.coins === 'number') {
        myCoins = msg.coins;
        updateCoinsUI();
      }
      if (msg.inventory) {
        myInventory = msg.inventory;
        updateInventoryUI();
      }
      if (msg.passiveItems) {
        equippedItems.gauntlets = msg.passiveItems.hasGauntlets || false;
        equippedItems.dagger = msg.passiveItems.hasDagger || false;
        equippedItems.firstAidKit = msg.passiveItems.hasFirstAid || false;
      }
      console.log('[WS] Estado del juego sincronizado (reconexión)');
      break;
    case 'registered':
      console.log('[WS] Registrado como', msg.name);
      requestLobbyList();
      break;
    case 'lobbyList':
      lobbyList = msg.lobbies;
      renderLobbyList(lobbyList);
      break;
    case 'lobbyCreated':
    case 'joinedLobby':
      currentLobby = msg.lobby;
      showNotification('✓ Unido al lobby');
      hideLobbyScreen();
      showWaitingRoom();
      break;
    case 'lobbyUpdate':
      currentLobby = msg.lobby;
      updateWaitingRoomUI();
      break;
    case 'gameStarted':
      resetGameState();
      settings = msg.settings;
      tasksRemaining = settings.tasksTotal;
      hideWaitingRoom();
      updateTasksUI();
      if (settings.coinsEnabled) {
        $('#flee-coins-display').style.display = 'block';
      }
      showNotification('🎮 ¡La partida ha comenzado!');
      break;
    case 'phaseChange':
      currentPhase = msg.phase;
      updateToggleLobbyButtonMode();
      if (msg.phase === 'reveal') {
        setTimeout(() => playRoleRoulette(), 500);
      }
      break;
    case 'yourRole':
      rolesByName[meName] = msg.role;
      updateInventoryUI();
      break;
    case 'coinsSpawned':
      if (msg.enabled || msg.coins) {
        coinsOnMap = msg.coins || [];
        syncRadarCoins();
      }
      break;
    case 'coinsState':
      coinsOnMap = msg.coins || [];
      syncRadarCoins();
      break;
    case 'coinCollected':
      myCoins = msg.totalCoins;
      updateCoinsUI();
      showNotification(`💰 +1 moneda (${myCoins} total)`);
      syncRadarCoins();
      break;
    case 'coinRemoved':
      coinsOnMap = coinsOnMap.filter(c => c.id !== msg.coinId);
      syncRadarCoins();
      break;
    case 'itemPurchased':
      myInventory = msg.inventory;
      myCoins = msg.coinsRemaining;
      updateCoinsUI();
      updateInventoryUI();
      showNotification('✓ Objeto comprado');
      break;
    case 'itemUsedSuccess':
      myInventory = msg.inventory;
      updateInventoryUI();
      showNotification(`✓ ${ITEM_INFO[msg.itemId]?.emoji || '🎒'} Objeto usado`, 2000);
      break;
    case 'itemError':
      showNotification(`❌ ${msg.message}`, 3000);
      break;
    case 'binocularsResult':
      myInventory = msg.inventory;
      updateInventoryUI();
      investigatedPlayers.push(msg.target);
      showNotification(`🔭 ${msg.target} es ${translateRole(msg.role)}`, 5000);
      window.postMessage({ source: 'radar-admin', type: 'trackPlayer', name: msg.target, role: msg.role }, '*');
      break;
    case 'smokeBombed':
      itemEffects.smokeBombedUntil = Date.now() + msg.duration;
      $('#flee-smokebomb-overlay').style.display = 'flex';
      updateSmokeBombTimer();
      showNotification(`💨 Tu visión fue nublada por ${msg.from}`, 3000);
      break;
    case 'hourglassActive':
      myInventory = msg.inventory;
      updateInventoryUI();
      itemEffects.hourglassUntil = Date.now() + msg.duration;
      showNotification(`⏳ Reloj de arena activo (${msg.duration/1000}s)`, 3000);
      flashOverlay('rgba(255, 215, 0, 0.3)', 800);
      updateHourglassTimer();
      break;
    case 'revived':
      health = msg.health;
      myInventory = msg.inventory;
      updateHealthUI();
      updateInventoryUI();
      flashOverlay('rgba(46, 204, 113, 0.5)', 1500);
      showNotification('🩹 ¡Botiquín te revivió automáticamente!', 4000);
      break;
    case 'gauntletReflect':
      health = Math.max(0, msg.health);
      updateHealthUI();
      flashOverlay('rgba(170, 102, 255, 0.4)', 800);
      showNotification(`🥊 Las manoplas de ${msg.from} te devolvieron ${msg.damage} daño`, 3000);
      break;
    case 'daggerRevenge':
      flashOverlay('rgba(255, 0, 0, 0.6)', 1500);
      showNotification(`🗡️ La daga de ${msg.from} te mató al morir`, 4000);
      break;
    case 'damaged':
      health = Math.max(0, msg.health);
      updateHealthUI();
      flashOverlay('rgba(255, 0, 0, 0.45)', 900);
      showNotification(`💔 Recibiste ${msg.amount} de daño`, 2000);
      break;
    case 'healed':
      health = Math.min(100, msg.health);
      updateHealthUI();
      flashOverlay('rgba(0, 200, 0, 0.35)', 900);
      showNotification(`💚 Fuiste curado (+${msg.amount})`, 2000);
      break;
    case 'frozen':
      frozen = true;
      frozenUntil = Date.now() + msg.duration;
      controlLockState.psychicFrozenUntil = frozenUntil;
      syncControlLockState();
      $('#flee-frozen-overlay').style.display = 'flex';
      simulateKeyJ();
      setTimeout(() => clickPlayButton(), 150);
      updateFrozenTimer();
      break;
    case 'exterminateTimer': {
      const isTarget = !msg.target && !!msg.attacker;
      startExterminateTimerState({
        end: msg.end || (Date.now() + 60000),
        target: msg.target || meName,
        attacker: msg.attacker || meName,
        perspective: isTarget ? 'target' : 'attacker'
      });
      break;
    }
    case 'notification':
      showNotification(msg.msg || msg.message || 'Aviso', 4000);
      break;
    case 'abilityBlocked':
      abilityBlocked = true;
      abilityBlockedUntil = Date.now() + msg.duration;
      controlLockState.jorguinCurseUntil = abilityBlockedUntil;
      syncControlLockState();
      $('#flee-blocked-overlay').style.display = 'flex';
      updateBlockedTimer();
      showNotification('⛔ Tu habilidad fue bloqueada', 3000);
      break;
    case 'distraction':
      distractionActive = true;
      setTimeout(() => { distractionActive = false; }, msg.duration);
      break;
    case 'distractionBoost':
      showNotification(msg.message, 3000);
      break;
    case 'investigationResult':
      showNotification(`🔍 ${msg.target} es ${translateRole(msg.role)}`, 5000);
      investigatedPlayers.push(msg.target);
      detectiveSpeedBuff = true;
      detectiveSpeedBuffUntil = Date.now() + 5000;
      
      {
        const sprintBar = $('#flee-sprint');
        if (sprintBar) {
          sprintBar.classList.add('hourglass-active');
        }
        
        const timerEl = $('#flee-hourglass-timer');
        let remaining = 5;
        if (timerEl) {
          timerEl.style.display = 'block';
          timerEl.textContent = `🔍 ${remaining}s`;
        }
        
        const timerInterval = setInterval(() => {
          remaining--;
          if (remaining <= 0) {
            clearInterval(timerInterval);
            detectiveSpeedBuff = false;
            if (sprintBar) sprintBar.classList.remove('hourglass-active');
            if (timerEl) timerEl.style.display = 'none';
          } else if (timerEl) {
            timerEl.textContent = `🔍 ${remaining}s`;
          }
        }, 1000);
      }
      
      window.postMessage({ source: 'radar-admin', type: 'trackPlayer', name: msg.target, role: translateRole(msg.role) }, '*');
      break;
    case 'spyInvestigationResult':
      showNotification(`🐈‍⬛ ${msg.target} es ${translateRole(msg.role)}`, 5000);
      investigatedPlayers.push(msg.target);
      if (!spyInvestigatedPlayers.includes(msg.target)) spyInvestigatedPlayers.push(msg.target);
      window.postMessage({ source: 'radar-admin', type: 'trackPlayer', name: msg.target, role: msg.role }, '*');
      break;
    case 'trackedPlayerPosition':
      if (msg.name && msg.position) {
        trackedPlayerPositions[msg.name] = msg.position;
        if (playersMap[msg.name]) {
          playersMap[msg.name].position = msg.position;
        }
      }
      window.postMessage({
        source: 'radar-admin',
        type: 'updateTrackedPlayerPosition',
        name: msg.name,
        position: msg.position
      }, '*');
      break;
    case 'playerPositionUpdate':
      if (msg.name && msg.position) {
        trackedPlayerPositions[msg.name] = msg.position;
        if (playersMap[msg.name]) {
          playersMap[msg.name].position = msg.position;
        }
      }
      break;
    case 'publicRoleReveal':
      publicReveals[msg.target] = msg.role;
      showNotification(`📢 ${msg.revealer} reveló que ${msg.target} es ${translateRole(msg.role)}`, 6000);
      break;
    case 'playerDied':
      if (playersMap[msg.name]) {
        playersMap[msg.name].alive = false;
      }
      if (exterminateTimerState.active && (msg.name === exterminateTimerState.target || msg.name === meName)) {
        clearExterminateTimerState();
      }
      refreshPlayersUI();
      if (msg.name === meName) {
        health = 0;
        updateHealthUI();
        diedOnce = true;
        showDeathThenReload();
      } else {
        showNotification(`💀 ${msg.name} ha muerto`, 3000);
      }
      break;
    case 'barricadeCreated':
      barricades.push(msg.barricade);
      window.postMessage({ source: 'radar-admin', type: 'barricadeCreated', barricade: msg.barricade }, '*');
      showNotification(`🔨 ${msg.barricade.owner} construyó una barricada`, 3000);
      break;
    case 'barricadeBuilt':
      barricades.push(msg.barricade);
      window.postMessage({ source: 'radar-admin', type: 'barricadeCreated', barricade: msg.barricade }, '*');
      updateCarpenterButtonVisuals();
      showNotification('🧱 Barricada desplegada', 2000);
      break;
    case 'barricadeUpdate':
      {
        const b = barricades.find(b => b.id === msg.barricadeId);
        if (b) b.health = msg.health;
        window.postMessage({ source: 'radar-admin', type: 'barricadeUpdate', barricadeId: msg.barricadeId, health: msg.health, maxHealth: msg.maxHealth }, '*');
      }
      break;
    case 'barricadeDestroyed':
      barricades = barricades.filter(b => b.id !== msg.barricadeId);
      window.postMessage({ source: 'radar-admin', type: 'barricadeDestroyed', barricadeId: msg.barricadeId }, '*');
      showNotification(`💥 Una barricada ${msg.owner ? 'de ' + msg.owner : ''} fue destruida`, 3000);
      break;
    case 'barricadeProtecting':
      showNotification(`🛡️ Estás siendo protegido por una barricada (${msg.health}/${msg.maxHealth})`, 2000);
      break;
    case 'splintered':
      abilityBlocked = true;
      abilityBlockedUntil = Date.now() + msg.duration;
      showSplinteredOverlay(msg.duration);
      showNotification('🪵 ¡Estás astillado! Tus habilidades están bloqueadas.', 3000);
      break;
    case 'taskUpdate':
      tasksRemaining = msg.total - msg.completed;
      updateTasksUI();
      break;
    case 'taskProgress':
      myTasksCompleted = msg.myCompleted || 0;
      myTasksTotal = msg.myTotal || 0;
      globalTasksCompleted = msg.globalCompleted || 0;
      globalTasksTotal = msg.globalTotal || 0;
      updateTasksUI();
      break;
    case 'gameEnded':
      if (msg.winner === 'good') {
        showVictoryScreen('¡Los buenos han ganado!', 'Todas las tareas completadas', '#2ecc71');
      } else if (msg.winner === 'evil') {
        showVictoryScreen('¡Los malvados han ganado!', 'Todos los buenos eliminados', '#e74c3c');
      }
      break;
    case 'gameOver':
      showNotification(`🎮 Fin del juego - Ganador: ${msg.winner}`, 10000);
      resetGameState();
      break;
    case 'protectionUpdate':
      if (msg.active) {
        protectedBy[msg.target] = msg.by;
      } else {
        delete protectedBy[msg.target];
      }
      refreshPlayersUI();
      updateBodyguardIndicator();
      break;
    case 'guardedHit':
      if (msg.target === meName) {
        health = Math.max(0, msg.health);
        updateHealthUI();
        flashOverlay('rgba(255, 60, 60, 0.5)');
        showNotification(`🛡️ Absorbiste daño protegiendo a ${msg.protectedPlayer}`, 3000);
      }
      break;
    case 'jokerDistract':
    case 'jokerDistraction':
      distractionActive = true;
      spawnJokerBalloons(80);
      setTimeout(() => { distractionActive = false; }, msg.duration || JOKER_DISTRACT_DURATION);
      if (msg.by && msg.by !== meName) {
        showNotification(`🃏 ${msg.by} ha causado una distracción!`, 3000);
      }
      break;
    case 'playersUpdate':
      if (msg.players) {
        Object.entries(msg.players).forEach(([cid, p]) => {
          if (p && p.name) playersMap[p.name] = p;
        });
      }
      updateProximityWindows();
      refreshPlayersUI();
      break;
    case 'playerDisconnected':
      if (playersMap[msg.name]) {
        playersMap[msg.name].disconnected = true;
        playersMap[msg.name].connected = false;
      }
      refreshPlayersUI();
      showNotification(`⚠️ ${msg.name} se desconectó`, 3000);
      break;
    case 'playerReconnected':
      if (playersMap[msg.name]) {
        playersMap[msg.name].disconnected = false;
        playersMap[msg.name].connected = true;
      }
      refreshPlayersUI();
      showNotification(`✓ ${msg.name} se reconectó`, 3000);
      break;
    case 'rolesUpdate':
      if (msg.roles && msg.roles.byName) {
        rolesByName = msg.roles.byName;
      }
      updateJokerButton();
      updateCarpenterButton();
      updateInventoryUI();
      break;
    case 'readyUpdate':
      updateReadyCounter(msg.readyCount, msg.totalPlayers);
      break;
    case 'allPlayersReady':
      hideReadyOverlay();
      showNotification('🚀 ¡Todos listos! El radar se ha activado.', 4000);
      flashOverlay('rgba(46, 204, 113, 0.4)', 800);
      window.postMessage({ source: 'radar-admin', type: 'setRadar', on: true }, '*');
      break;
    case 'radarState':
      if (msg.on !== undefined) {
        window.postMessage({ source: 'radar-admin', type: 'setRadar', on: !!msg.on }, '*');
      }
      if (Array.isArray(msg.tasks)) {
        window.postMessage({ source: 'radar-admin', type: 'setTasks', tasks: msg.tasks }, '*');
      }
      break;
  }
}

function updateFrozenTimer(){
  if (!frozen) {
    $('#flee-frozen-overlay').style.display = 'none';
    return;
  }
  
  const remaining = Math.max(0, Math.ceil((frozenUntil - Date.now()) / 1000));
  $('#flee-frozen-timer').textContent = remaining + 's';
  
  if (remaining <= 0) {
    frozen = false;
    controlLockState.psychicFrozenUntil = 0;
    syncControlLockState();
    $('#flee-frozen-overlay').style.display = 'none';
  } else {
    setTimeout(updateFrozenTimer, 100);
  }
}

function updateBlockedTimer(){
  if (!abilityBlocked) {
    $('#flee-blocked-overlay').style.display = 'none';
    return;
  }
  
  const remaining = Math.max(0, Math.ceil((abilityBlockedUntil - Date.now()) / 1000));
  $('#flee-blocked-timer').textContent = remaining + 's';
  
  if (remaining <= 0) {
    abilityBlocked = false;
    abilityBlockedUntil = 0;
    if (controlLockState.jorguinCurseUntil <= Date.now()) {
      controlLockState.jorguinCurseUntil = 0;
    }
    syncControlLockState();
    $('#flee-blocked-overlay').style.display = 'none';
    // Restore floating buttons to normal state
    updateJokerButtonVisuals();
    updateCarpenterButtonVisuals();
  } else {
    setTimeout(updateBlockedTimer, 100);
  }
}

let sprintExhaustedTriggered = false;
const SPRINT_RECOVERY_THRESHOLD = 30;

function sprintLoop(ts){
  const dt = 0.016;

  syncControlLockState();

  if (frozen || abilityBlocked) {
    sprint.draining = false;
  }

  if (isJorguinCurseActive()) {
    sprint.value = 0;
    sprint.exhausted = true;
    sprint.draining = false;
    updateSprintUI();
    requestAnimationFrame(sprintLoop);
    return;
  }
  
  if (sprint.exhausted) {
    sprint.draining = false;
  }
  
  const hourglassActive = isHourglassActive();
  
  if (detectiveSpeedBuff && Date.now() >= detectiveSpeedBuffUntil) {
    detectiveSpeedBuff = false;
  }
  
  const hasSpeedBuff = hourglassActive || detectiveSpeedBuff;
  
  if (hasSpeedBuff) {
    sprint.value = sprint.max;
    if (sprint.exhausted || sprintExhaustedTriggered) {
      window.postMessage({ source: 'radar-admin', type: 'setSprintBlocked', blocked: false }, '*');
    }
    sprint.exhausted = false;
    sprintExhaustedTriggered = false;
  } else if (sprint.draining && sprint.value > 0) {
    sprint.value = Math.max(0, sprint.value - (sprint.drainRate * dt));
    if (sprint.value <= 0) {
      sprint.value = 0;
      sprint.exhausted = true;
      sprint.draining = false;
      
      if (!sprintExhaustedTriggered) {
        sprintExhaustedTriggered = true;
        triggerSprintExhaustedActions();
        // Block sprint in radar
        window.postMessage({ source: 'radar-admin', type: 'setSprintBlocked', blocked: true }, '*');
      }
    }
  } else {
    if (sprint.exhausted) {
      sprint.draining = false;
    }
    if (sprint.value < sprint.max) {
      sprint.value = Math.min(sprint.max, sprint.value + (sprint.regenRate * dt));
      if (sprint.exhausted && sprint.value >= sprint.max && !isJorguinCurseActive()) {
        sprint.exhausted = false;
        sprintExhaustedTriggered = false;
        // Unblock sprint in radar after minimum recovery threshold
        window.postMessage({ source: 'radar-admin', type: 'setSprintBlocked', blocked: false }, '*');
      }
    }
  }
  
  updateSprintUI();
  requestAnimationFrame(sprintLoop);
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') {
    if (isJorguinCurseActive() || isPsychicFreezeActive() || sprint.exhausted || sprint.value <= 0) {
      e.preventDefault();
      e.stopPropagation();
      sprint.draining = false;
      return;
    }
    if (!frozen && !abilityBlocked) {
      sprint.draining = true;
    }
  }
}, true);

window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') {
    sprint.draining = false;
  }
});

window.addEventListener('keydown', (e) => {
  if (frozen && ['w','a','s','d','W','A','S','D','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

function initAll(){
  createStyles();
  createLobbyScreen();
  createToggleLobbyButton();
  createWaitingRoomScreen();
  createUI();
  ensureNotificationsContainer();
  proximitySystem.start();
  wsConnect();
  requestAnimationFrame(sprintLoop);
  setupNotificationObservers();
  
  if (!meName || !meName.trim()) {
    setTimeout(() => {
      const name = prompt('Por favor ingresa tu nombre:');
      if (name && name.trim()) {
        meName = name.trim();
        localStorage.setItem('flee_name_v1', meName);
        if (connected) doRegister();
      }
    }, 1000);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAll);
} else {
  initAll();
}
