import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

const PORT = process.env.PORT || 3000;
const wss = new WebSocketServer({ port: PORT });

const games = new Map();
const lobbies = new Map();
const clients = new Map();

console.log(`[SERVER] Iniciado en puerto ${PORT}`);

const ROLE_DEFINITIONS = {
  killer: { name: 'Asesino', evil: true },
  medic: { name: 'Médico', evil: false },
  innocent: { name: 'Inocente', evil: false },
  detective: { name: 'Detective', evil: false },
  joker: { name: 'Joker', evil: true },
  bodyguard: { name: 'Guardaespaldas', evil: false },
  psychic: { name: 'Psíquico', evil: false },
  sheriff: { name: 'Alguacil', evil: false },
  jorguin: { name: 'Jorguín', evil: true },
  spy: { name: 'Espía', evil: true },
  carpenter: { name: 'Carpintero', evil: false }
};

const GOOD_ROLES = ['innocent', 'medic', 'detective', 'bodyguard', 'sheriff', 'carpenter'];
const EVIL_ROLES = ['killer', 'jorguin', 'spy'];
const NEUTRAL_ROLES = ['joker', 'psychic'];

const LOCATIONS = [
  {"x":0.7009,"y":0.9203},{"x":0.5646,"y":0.932},{"x":0.5274,"y":0.7311},
  {"x":0.4368,"y":0.7904},{"x":0.4157,"y":0.9615},{"x":0.6584,"y":0.7015},
  {"x":0.7072,"y":0.3779},{"x":0.9679,"y":0.3817},{"x":0.7907,"y":0.936},
  {"x":0.9144,"y":0.6804},{"x":0.9061,"y":0.5308},{"x":0.998,"y":0.5795},
  {"x":0.5962,"y":0.4785},{"x":0.3736,"y":0.4535},{"x":0.6231,"y":0.3033},
  {"x":0.2744,"y":0.7195}
];

function getRandomCoinPosition() {
  const baseLocation = LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
  const offsetX = (Math.random() - 0.5) * 0.12;
  const offsetY = (Math.random() - 0.5) * 0.12;
  return {
    x: Math.max(0, Math.min(1, baseLocation.x + offsetX)),
    y: Math.max(0, Math.min(1, baseLocation.y + offsetY))
  };
}

function isGoodRole(role) {
  return GOOD_ROLES.includes(role);
}

function isEvilRole(role) {
  return EVIL_ROLES.includes(role);
}

const SHOP_CATALOG = {
  pocion_sanacion: { name: 'Poción de sanación', cost: 5, location: 'enfermeria', type: 'active', healAmount: 30 },
  botiquin: { name: 'Botiquín', cost: 10, location: 'enfermeria', type: 'passive' },
  binoculares: { name: 'Binoculares', cost: 5, location: 'cabana', type: 'active' },
  bomba_humo: { name: 'Bomba de humo', cost: 5, location: 'cabana', type: 'active', duration: 10000 },
  manoplas: { name: 'Manoplas', cost: 10, location: 'herreria', type: 'passive', reflectPercent: 0.5 },
  daga: { name: 'Daga', cost: 25, location: 'herreria', type: 'passive' },
  reloj_arena: { name: 'Reloj de arena', cost: 7, location: 'playa', type: 'active', duration: 20000 }
};

class Lobby {
  constructor(id, creatorName, maxPlayers = 8) {
    this.id = id;
    this.creatorName = creatorName;
    this.maxPlayers = maxPlayers;
    this.password = '';
    this.players = [];
    this.availableRoles = ['killer', 'medic', 'innocent', 'detective', 'joker', 'bodyguard', 'psychic', 'sheriff', 'jorguin', 'spy', 'carpenter'];
    this.tasksTotal = 5;
    this.status = 'waiting';
    this.gameId = null;
    this.coinsEnabled = false;
    this.roleConfig = null;
  }

  addPlayer(playerData) {
    if (this.players.length >= this.maxPlayers) return false;
    if (this.players.find(p => p.name === playerData.name)) return false;
    this.players.push(playerData);
    return true;
  }

  removePlayer(playerName) {
    this.players = this.players.filter(p => p.name !== playerName);
    if (this.players.length === 0) {
      lobbies.delete(this.id);
    }
  }

  toJSON() {
    return {
      id: this.id,
      creatorName: this.creatorName,
      maxPlayers: this.maxPlayers,
      currentPlayers: this.players.length,
      players: this.players.map(p => ({ name: p.name, avatarUrl: p.avatarUrl, ready: p.ready || false })),
      hasPassword: this.password.length > 0,
      status: this.status,
      availableRoles: this.availableRoles,
      tasksTotal: this.tasksTotal,
      coinsEnabled: this.coinsEnabled,
      roleConfig: this.roleConfig
    };
  }
}

class Game {
  constructor(gameId, lobbyData) {
    this.gameId = gameId;
    this.players = new Map();
    this.roles = new Map();
    this.phase = 'lobby';
    this.settings = {
      damageOnHit: 20,
      healOnGive: 15,
      tasksTotal: lobbyData.tasksTotal || 5,
      coinsEnabled: lobbyData.coinsEnabled || false
    };
    this.coins = [];
    this.playerCoins = new Map();
    this.coinRespawnTimer = null;
    this.tasks = [];
    this.barricades = [];
    this.shopItems = new Map();
    this.playerInventories = new Map();
    this.tasksCompleted = 0;
    this.publicReveals = new Map();
    this.readyPlayers = new Set();
    this.roleConfig = lobbyData.roleConfig || null;
    this.playerTasks = new Map();
    this.gameEnded = false;
    this.distractionActive = false;
    this.distractionUntil = 0;
    this.exterminateTimers = new Map();
    this.proximityWindows = new Map();
  }

  handleExterminate(attackerName, targetName) {
    const player = this.players.get(targetName);
    if (!player || !player.alive) return;

    const existing = this.exterminateTimers.get(targetName);
    if (existing) {
      clearTimeout(existing);
      this.exterminateTimers.delete(targetName);
    }

    const duration = 60000; // 1 minute
    const endTimestamp = Date.now() + duration;

    this.sendTo(attackerName, { t: 'exterminateTimer', target: targetName, end: endTimestamp });
    this.sendTo(targetName, { t: 'exterminateTimer', attacker: attackerName, end: endTimestamp });

    const timer = setTimeout(() => {
      this.exterminateTimers.delete(targetName);
      if (this.phase !== 'running' || this.gameEnded) return;
      const p = this.players.get(targetName);
      if (p && p.alive) {
        p.alive = false;
        p.health = 0;
        this.broadcast({ t: 'playerDied', name: targetName, killer: attackerName, reason: 'exterminated', method: 'exterminate_timer' });
        this.sendTo(attackerName, { t: 'notification', msg: `💀 ${targetName} ha sido exterminado` });
        const victory = this.checkVictoryConditions();
        if (victory) this.endGame(victory.winner, victory.reason);
        broadcastPlayersUpdate(this);
      }
    }, duration);

    this.exterminateTimers.set(targetName, timer);
  }

  initializePlayerTasks() {
    const tasksPerPlayer = this.settings.tasksTotal || 5;
    this.roles.forEach((role, playerName) => {
      if (isGoodRole(role)) {
        this.playerTasks.set(playerName, {
          completed: 0,
          total: tasksPerPlayer
        });
        console.log(`[TASKS] Inicializadas ${tasksPerPlayer} tareas para ${playerName} (${role})`);
      }
    });
    console.log(`[TASKS] Total de jugadores buenos con tareas: ${this.playerTasks.size}`);
  }

  getGlobalTaskProgress() {
    let globalCompleted = 0;
    let globalTotal = 0;
    this.playerTasks.forEach((tasks) => {
      globalCompleted += tasks.completed;
      globalTotal += tasks.total;
    });
    return { globalCompleted, globalTotal };
  }

  broadcastTaskProgress() {
    const { globalCompleted, globalTotal } = this.getGlobalTaskProgress();
    
    this.players.forEach((player, playerName) => {
      const playerTask = this.playerTasks.get(playerName);
      const myCompleted = playerTask ? playerTask.completed : 0;
      const myTotal = playerTask ? playerTask.total : 0;
      
      this.sendTo(playerName, {
        t: 'taskProgress',
        myCompleted,
        myTotal,
        globalCompleted,
        globalTotal
      });
    });
  }

  checkVictoryConditions() {
    if (this.gameEnded) return null;
    
    const { globalCompleted, globalTotal } = this.getGlobalTaskProgress();
    if (globalTotal > 0 && globalCompleted >= globalTotal) {
      this.gameEnded = true;
      console.log(`[VICTORY] ¡Los buenos han ganado! Todas las tareas completadas (${globalCompleted}/${globalTotal})`);
      return { winner: 'good', reason: 'tasks_completed' };
    }
    
    let goodPlayersAlive = 0;
    this.players.forEach((player, playerName) => {
      const role = this.roles.get(playerName);
      if (player.alive && isGoodRole(role)) {
        goodPlayersAlive++;
      }
    });
    
    if (goodPlayersAlive === 0 && this.playerTasks.size > 0) {
      this.gameEnded = true;
      console.log(`[VICTORY] ¡Los malvados han ganado! Todos los buenos eliminados`);
      return { winner: 'evil', reason: 'all_good_eliminated' };
    }
    
    return null;
  }

  endGame(winner, reason) {
    if (this.gameEnded) return;
    this.gameEnded = true;
    this.phase = 'ended';
    
    this.broadcast({
      t: 'gameEnded',
      winner,
      reason
    });
    
    this.stopCoinRespawnTimer();
    console.log(`[GAME] Partida terminada - Ganador: ${winner}, Razón: ${reason}`);
  }

  generateTasks() {
    const tasks = [];
    const numTasks = this.settings.tasksTotal || 5;
    const availableZones = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    
    for (let i = 0; i < Math.min(numTasks, 16); i++) {
      if (availableZones.length === 0) break;
      const randomIndex = Math.floor(Math.random() * availableZones.length);
      const zoneIndex = availableZones.splice(randomIndex, 1)[0];
      const gameId = Math.floor(Math.random() * 6) + 1;
      tasks.push({ index: zoneIndex, taskId: gameId, completed: false });
    }
    
    this.tasks = tasks;
    console.log(`[GAME] Generadas ${tasks.length} tareas:`, tasks.map(t => `zona ${t.index} -> juego ${t.taskId}`).join(', '));
    return tasks;
  }

  spawnCoinsForPlayer(playerName, count = 15) {
    if (!this.settings.coinsEnabled) return [];
    
    const coins = [];
    for (let i = 0; i < count; i++) {
      const pos = getRandomCoinPosition();
      coins.push({
        id: uuidv4(),
        x: pos.x,
        y: pos.y,
        collected: false
      });
    }
    
    this.playerCoins.set(playerName, coins);
    console.log(`[COINS] Generadas ${count} monedas cerca de ubicaciones para ${playerName}`);
    return coins;
  }

  collectPlayerCoin(playerName, coinId) {
    const coins = this.playerCoins.get(playerName);
    if (!coins) return false;
    
    const coin = coins.find(c => c.id === coinId && !c.collected);
    if (!coin) return false;
    
    coin.collected = true;
    const player = this.players.get(playerName);
    if (player) {
      player.coins = (player.coins || 0) + 1;
      return true;
    }
    return false;
  }

  startCoinRespawnTimer() {
    if (!this.settings.coinsEnabled) return;
    if (this.coinRespawnTimer) {
      clearInterval(this.coinRespawnTimer);
    }
    
    const respawnInterval = 30000;
    this.coinRespawnTimer = setInterval(() => {
      if (this.phase !== 'running') return;
      
      this.players.forEach((player, playerName) => {
        if (!player.alive) return;
        
        let coins = this.playerCoins.get(playerName) || [];
        const uncollectedCount = coins.filter(c => !c.collected).length;
        
        if (uncollectedCount < 5) {
          const newCoins = [];
          for (let i = 0; i < 3; i++) {
            const pos = getRandomCoinPosition();
            newCoins.push({
              id: uuidv4(),
              x: pos.x,
              y: pos.y,
              collected: false
            });
          }
          coins = [...coins.filter(c => !c.collected), ...newCoins];
          this.playerCoins.set(playerName, coins);
          
          this.sendTo(playerName, {
            t: 'coinsState',
            coins: coins.filter(c => !c.collected)
          });
          console.log(`[COINS] Respawn: +3 monedas cerca de ubicaciones para ${playerName}`);
        }
      });
    }, respawnInterval);
    
    console.log(`[COINS] Timer de respawn iniciado (cada ${respawnInterval/1000}s)`);
  }

  stopCoinRespawnTimer() {
    if (this.coinRespawnTimer) {
      clearInterval(this.coinRespawnTimer);
      this.coinRespawnTimer = null;
    }
  }

  registerPlayer(name, avatarUrl, ws) {
    this.players.set(name, {
      name,
      avatarUrl,
      ws,
      alive: true,
      health: 100,
      coins: 0,
      inventory: [],
      position: { x: 0.5, y: 0.5 },
      investigatedBy: [],
      usedExterminate: false,
      usedReveal: false,
      activeEffects: {
        hourglassUntil: 0,
        smokeBombedUntil: 0
      },
      passiveItems: {
        hasGauntlets: false,
        hasDagger: false,
        hasFirstAid: false
      },
      lastAttacker: null,
      carpenterCooldownUntil: 0
    });
    this.playerInventories.set(name, []);
  }

  getInventoryItemCount(playerName, itemId) {
    const inventory = this.playerInventories.get(playerName) || [];
    return inventory.filter(id => id === itemId).length;
  }

  removeItemFromInventory(playerName, itemId) {
    const inventory = this.playerInventories.get(playerName) || [];
    const index = inventory.indexOf(itemId);
    if (index !== -1) {
      inventory.splice(index, 1);
      this.playerInventories.set(playerName, inventory);
      return true;
    }
    return false;
  }

  updatePassiveItemStatus(playerName) {
    const inventory = this.playerInventories.get(playerName) || [];
    const player = this.players.get(playerName);
    if (player) {
      player.passiveItems = {
        hasGauntlets: inventory.includes('manoplas'),
        hasDagger: inventory.includes('daga'),
        hasFirstAid: inventory.includes('botiquin')
      };
    }
  }

  assignRoles(availableRoles) {
    const playerNames = Array.from(this.players.keys());
    const shuffledPlayers = [...playerNames].sort(() => Math.random() - 0.5);
    
    if (this.roleConfig) {
      const rolePool = [];
      const requiredRoles = [];
      const optionalRoles = [];
      const enabledRoles = [];
      
      Object.entries(this.roleConfig).forEach(([role, config]) => {
        if (config.enabled) {
          enabledRoles.push(role);
          const count = config.count || 1;
          for (let i = 0; i < count; i++) {
            if (config.required) {
              requiredRoles.push(role);
            } else {
              optionalRoles.push(role);
            }
          }
        }
      });
      
      const shuffledRequired = [...requiredRoles].sort(() => Math.random() - 0.5);
      const shuffledOptional = [...optionalRoles].sort(() => Math.random() - 0.5);
      rolePool.push(...shuffledRequired, ...shuffledOptional);
      
      // Si hay más jugadores que roles en el pool, expandir con roles habilitados (preferir 'innocent')
      while (rolePool.length < shuffledPlayers.length) {
        if (enabledRoles.includes('innocent')) {
          rolePool.push('innocent');
        } else if (enabledRoles.length > 0) {
          rolePool.push(enabledRoles[Math.floor(Math.random() * enabledRoles.length)]);
        } else {
          rolePool.push('innocent'); // Fallback
        }
      }
      
      console.log(`[ROLES] Pool de roles (${rolePool.length}): ${rolePool.join(', ')}`);
      console.log(`[ROLES] Roles obligatorios (${requiredRoles.length}): ${requiredRoles.join(', ')}`);
      console.log(`[ROLES] Jugadores (${shuffledPlayers.length}): ${shuffledPlayers.join(', ')}`);
      
      shuffledPlayers.forEach((name, i) => {
        const role = rolePool[i];
        this.roles.set(name, role);
        console.log(`[ROLES] ${name} -> ${role}`);
      });
    } else {
      const shuffledRoles = [...availableRoles].sort(() => Math.random() - 0.5);
      // Expandir si hay más jugadores que roles
      while (shuffledRoles.length < shuffledPlayers.length) {
        shuffledRoles.push('innocent');
      }
      shuffledPlayers.forEach((name, i) => {
        const role = shuffledRoles[i];
        this.roles.set(name, role);
      });
    }
  }

  spawnCoins(count = 20) {
    if (!this.settings.coinsEnabled) return [];
    this.coins = [];
    for (let i = 0; i < count; i++) {
      const pos = getRandomCoinPosition();
      this.coins.push({
        id: uuidv4(),
        x: pos.x,
        y: pos.y,
        collected: false
      });
    }
    return this.coins;
  }

  collectCoin(playerName, coinId) {
    const coin = this.coins.find(c => c.id === coinId && !c.collected);
    if (!coin) return false;
    
    coin.collected = true;
    const player = this.players.get(playerName);
    if (player) {
      player.coins = (player.coins || 0) + 1;
      return true;
    }
    return false;
  }

  purchaseItem(playerName, itemId) {
    const itemInfo = SHOP_CATALOG[itemId];
    if (!itemInfo) return { success: false, reason: 'invalid_item' };
    
    const player = this.players.get(playerName);
    if (!player) return { success: false, reason: 'player_not_found' };
    if (player.coins < itemInfo.cost) return { success: false, reason: 'insufficient_coins' };
    
    player.coins -= itemInfo.cost;
    const inventory = this.playerInventories.get(playerName) || [];
    inventory.push(itemId);
    this.playerInventories.set(playerName, inventory);
    
    this.updatePassiveItemStatus(playerName);
    
    return { success: true, coinsRemaining: player.coins, inventory };
  }

  broadcast(message, exclude = null) {
    this.players.forEach((player, name) => {
      if (name !== exclude && player.ws && player.ws.readyState === 1) {
        try {
          player.ws.send(JSON.stringify(message));
        } catch (e) {
          console.error(`Error broadcasting to ${name}:`, e);
        }
      }
    });
  }

  sendTo(playerName, message) {
    const player = this.players.get(playerName);
    if (player && player.ws && player.ws.readyState === 1) {
      try {
        player.ws.send(JSON.stringify(message));
      } catch (e) {
        console.error(`Error sending to ${playerName}:`, e);
      }
    }
  }
}

function broadcast(gameId, message, exclude = null) {
  const game = games.get(gameId);
  if (game) {
    game.broadcast(message, exclude);
  }
}

function sendToPlayer(gameId, playerName, message) {
  const game = games.get(gameId);
  if (game) {
    game.sendTo(playerName, message);
  }
}

function pushCoinState(game, target = null) {
  if (!game.settings.coinsEnabled) return;
  
  const coinState = {
    t: 'coinsState',
    coins: game.coins.filter(c => !c.collected)
  };
  
  if (target) {
    game.sendTo(target, coinState);
  } else {
    game.broadcast(coinState);
  }
}

function broadcastPlayersUpdate(game) {
  const playersData = {};
  game.players.forEach((player, name) => {
    playersData[name] = {
      name: player.name,
      avatarUrl: player.avatarUrl,
      alive: player.alive,
      health: player.health,
      position: player.position || null,
      disconnected: player.disconnected || false,
      connected: player.connected !== false
    };
  });
  
  game.broadcast({
    t: 'playersUpdate',
    players: playersData
  });
}

wss.on('connection', (ws) => {
  let clientId = uuidv4();
  let clientData = { ws, type: null, gameId: null, name: null };
  clients.set(clientId, clientData);

  console.log(`[CONNECTION] Cliente conectado: ${clientId}`);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleMessage(ws, clientId, msg);
    } catch (e) {
      console.error('[ERROR] Parse message:', e);
    }
  });

  ws.on('close', () => {
    console.log(`[DISCONNECT] Cliente ${clientId} desconectado`);
    const client = clients.get(clientId);
    if (client && client.gameId && client.name) {
      const game = games.get(client.gameId);
      if (game) {
        const player = game.players.get(client.name);
        if (player) {
          player.disconnected = true;
          player.connected = false;
          console.log(`[DISCONNECT] ${client.name} desconectado, esperando reconexión...`);
          
          game.broadcast({
            t: 'playerDisconnected',
            name: client.name
          }, client.name);
          
          broadcastPlayersUpdate(game);
        }
      }
    }
    clients.delete(clientId);
  });

  ws.send(JSON.stringify({ t: 'welcome', message: 'Conectado al servidor' }));
});

function handleMessage(ws, clientId, msg) {
  const client = clients.get(clientId);

  const frozenLockedActions = new Set(['attack','heal','investigate','distract','useItem','freezePlayer','exterminatePlayer','revealRole','sheriffShoot','jorguinBlock','jorguinAttack','spyInvestigate','spyAttack','carpenterBuild']);
  if (client && client.gameId && frozenLockedActions.has(msg.t)) {
    const game = games.get(client.gameId);
    const player = game ? game.players.get(client.name) : null;
    if (player && player.frozen && player.frozenUntil > Date.now()) {
      try {
        client.ws.send(JSON.stringify({ t: 'error', message: 'Estás congelado: controles bloqueados' }));
      } catch (e) {}
      return;
    }
  }
  
  switch (msg.t) {
    case 'register':
      handleRegister(ws, clientId, msg);
      break;
    case 'createLobby':
      handleCreateLobby(ws, clientId, msg);
      break;
    case 'getLobbyList':
      handleGetLobbyList(ws);
      break;
    case 'joinLobby':
      handleJoinLobby(ws, clientId, msg);
      break;
    case 'leaveLobby':
      handleLeaveLobby(clientId);
      break;
    case 'updateLobbySettings':
      handleUpdateLobbySettings(clientId, msg);
      break;
    case 'startGame':
      handleStartGame(clientId);
      break;
    case 'setPhase':
      handleSetPhase(client, msg);
      break;
    case 'updatePosition':
      handleUpdatePosition(client, msg);
      break;
    case 'taskCompleted':
      handleTaskCompleted(client, msg);
      break;
    case 'attack':
      handleAttack(client, msg);
      break;
    case 'heal':
      handleHeal(client, msg);
      break;
    case 'investigate':
      handleInvestigate(client, msg);
      break;
    case 'distract':
      handleDistract(client, msg);
      break;
    case 'collectCoin':
      handleCollectCoin(client, msg);
      break;
    case 'purchaseItem':
      handlePurchaseItem(client, msg);
      break;
    case 'useItem':
      handleUseItem(client, msg);
      break;
    case 'freezePlayer':
      handleFreezePlayer(client, msg);
      break;
    case 'exterminatePlayer':
      handleExterminatePlayer(client, msg);
      break;
    case 'revealRole':
      handleRevealRole(client, msg);
      break;
    case 'sheriffShoot':
      handleSheriffShoot(client, msg);
      break;
    case 'jorguinBlock':
      handleJorguinBlock(client, msg);
      break;
    case 'jorguinAttack':
      handleJorguinAttack(client, msg);
      break;
    case 'spyInvestigate':
      handleSpyInvestigate(client, msg);
      break;
    case 'spyAttack':
      handleSpyAttack(client, msg);
      break;
    case 'carpenterBuild':
      handleCarpenterBuild(client, msg);
      break;
    case 'updateProfile':
      handleUpdateProfile(client, msg);
      break;
    case 'playerReady':
      handlePlayerReady(client, msg);
      break;
    case 'requestRadarState':
      handleRequestRadarState(client, msg);
      break;
    default:
      console.log(`[UNKNOWN] Mensaje tipo: ${msg.t}`);
  }
}

function handleRegister(ws, clientId, msg) {
  const client = clients.get(clientId);
  client.type = msg.clientType || 'player';
  client.name = msg.name;
  client.avatarUrl = msg.avatarUrl || '';
  client.gameId = msg.gameId;
  
  console.log(`[REGISTER] ${msg.name} como ${client.type}`);
  
  ws.send(JSON.stringify({
    t: 'registered',
    name: msg.name,
    clientType: client.type
  }));
  
  const game = games.get(msg.gameId);
  if (game) {
    const existingPlayer = game.players.get(msg.name);
    if (existingPlayer) {
      console.log(`[RECONNECT] Actualizando WebSocket para ${msg.name}`);
      existingPlayer.ws = ws;
      existingPlayer.disconnected = false;
      existingPlayer.connected = true;
      
      const wasAlive = existingPlayer.health > 0;
      if (wasAlive && !existingPlayer.alive) {
        existingPlayer.alive = true;
      }
      
      if (existingPlayer.alive) {
        game.broadcast({
          t: 'playerReconnected',
          name: msg.name
        }, msg.name);
        
        broadcastPlayersUpdate(game);
      }
      
      const playerInventory = game.playerInventories.get(msg.name) || [];
      const playerPassiveItems = existingPlayer.passiveItems || {
        hasGauntlets: false,
        hasDagger: false,
        hasFirstAid: false
      };
      
      game.sendTo(msg.name, {
        t: 'gameState',
        phase: game.phase,
        role: game.roles.get(msg.name),
        health: existingPlayer.health,
        coins: existingPlayer.coins,
        alive: existingPlayer.alive,
        inventory: playerInventory,
        passiveItems: playerPassiveItems
      });
      
      if (game.phase === 'running') {
        if (game.tasks && game.tasks.length > 0) {
          game.sendTo(msg.name, {
            t: 'radarState',
            on: true,
            tasks: game.tasks
          });
          console.log(`[SYNC] Enviado radarState con tareas a ${msg.name} (reconexión)`);
        }
        
        if (game.settings.coinsEnabled) {
          const playerCoins = game.playerCoins.get(msg.name);
          if (playerCoins) {
            game.sendTo(msg.name, {
              t: 'coinsState',
              coins: playerCoins.filter(c => !c.collected)
            });
            console.log(`[SYNC] Enviado estado de monedas a ${msg.name} (reconexión)`);
          }
        }
      }
    }
  }
}

function handleCreateLobby(ws, clientId, msg) {
  const client = clients.get(clientId);
  const lobbyId = uuidv4();
  const lobby = new Lobby(lobbyId, client.name, msg.maxPlayers || 8);
  
  lobby.password = msg.password || '';
  lobby.tasksTotal = msg.tasksTotal || 5;
  lobby.availableRoles = msg.availableRoles || lobby.availableRoles;
  lobby.coinsEnabled = msg.coinsEnabled || false;
  
  if (msg.roleConfig) {
    lobby.roleConfig = msg.roleConfig;
    const enabledRoles = Object.entries(msg.roleConfig)
      .filter(([_, cfg]) => cfg.enabled)
      .map(([role, _]) => role);
    if (enabledRoles.length > 0) {
      lobby.availableRoles = enabledRoles;
    }
  }
  
  lobby.addPlayer({
    name: client.name,
    avatarUrl: client.avatarUrl,
    ready: false
  });
  
  lobbies.set(lobbyId, lobby);
  client.lobbyId = lobbyId;
  
  ws.send(JSON.stringify({
    t: 'lobbyCreated',
    lobby: lobby.toJSON()
  }));
  
  console.log(`[LOBBY] Creado por ${client.name}: ${lobbyId}`);
  if (msg.roleConfig) {
    console.log(`[LOBBY] Configuración de roles:`, JSON.stringify(msg.roleConfig));
  }
}

function handleGetLobbyList(ws) {
  const lobbyList = Array.from(lobbies.values())
    .filter(l => l.status === 'waiting')
    .map(l => l.toJSON());
  
  ws.send(JSON.stringify({
    t: 'lobbyList',
    lobbies: lobbyList
  }));
}

function handleJoinLobby(ws, clientId, msg) {
  const client = clients.get(clientId);
  const lobby = lobbies.get(msg.lobbyId);
  
  if (!lobby) {
    ws.send(JSON.stringify({ t: 'error', message: 'Lobby no encontrado' }));
    return;
  }
  
  if (lobby.password && lobby.password !== msg.password) {
    ws.send(JSON.stringify({ t: 'error', message: 'Contraseña incorrecta' }));
    return;
  }
  
  if (!lobby.addPlayer({ name: client.name, avatarUrl: client.avatarUrl, ready: false })) {
    ws.send(JSON.stringify({ t: 'error', message: 'No se pudo unir al lobby' }));
    return;
  }
  
  client.lobbyId = msg.lobbyId;
  
  ws.send(JSON.stringify({
    t: 'joinedLobby',
    lobby: lobby.toJSON()
  }));
  
  broadcastToLobby(msg.lobbyId, {
    t: 'lobbyUpdate',
    lobby: lobby.toJSON()
  });
  
  console.log(`[LOBBY] ${client.name} se unió a ${msg.lobbyId}`);
}

function handleLeaveLobby(clientId) {
  const client = clients.get(clientId);
  if (!client.lobbyId) return;
  
  const lobby = lobbies.get(client.lobbyId);
  if (lobby) {
    lobby.removePlayer(client.name);
    broadcastToLobby(client.lobbyId, {
      t: 'lobbyUpdate',
      lobby: lobby.toJSON()
    });
  }
  
  client.lobbyId = null;
}

function handleUpdateLobbySettings(clientId, msg) {
  const client = clients.get(clientId);
  const lobby = lobbies.get(client.lobbyId);
  
  if (!lobby || lobby.creatorName !== client.name) return;
  
  if (msg.maxPlayers) lobby.maxPlayers = msg.maxPlayers;
  if (msg.tasksTotal) lobby.tasksTotal = msg.tasksTotal;
  if (msg.availableRoles) lobby.availableRoles = msg.availableRoles;
  if (msg.coinsEnabled !== undefined) lobby.coinsEnabled = msg.coinsEnabled;
  
  broadcastToLobby(client.lobbyId, {
    t: 'lobbyUpdate',
    lobby: lobby.toJSON()
  });
}

function handleStartGame(clientId) {
  const client = clients.get(clientId);
  const lobby = lobbies.get(client.lobbyId);
  
  if (!lobby || lobby.creatorName !== client.name) return;
  if (lobby.players.length < 2) return;
  
  const gameId = `game-${uuidv4()}`;
  const game = new Game(gameId, lobby);
  
  lobby.players.forEach(p => {
    const playerClient = Array.from(clients.values()).find(c => c.name === p.name);
    if (playerClient) {
      playerClient.gameId = gameId;
      game.registerPlayer(p.name, p.avatarUrl, playerClient.ws);
    }
  });
  
  game.assignRoles(lobby.availableRoles);
  
  broadcastPlayersUpdate(game);
  
  games.set(gameId, game);
  lobby.status = 'in-progress';
  lobby.gameId = gameId;
  
  game.broadcast({
    t: 'gameStarted',
    gameId: gameId,
    settings: game.settings
  });
  
  setTimeout(() => {
    game.broadcast({ t: 'phaseChange', phase: 'reveal' });
    game.players.forEach((player, name) => {
      game.sendTo(name, {
        t: 'yourRole',
        role: game.roles.get(name)
      });
    });
    
    game.broadcast({
      t: 'readyUpdate',
      readyCount: 0,
      totalPlayers: game.players.size
    });
  }, 1000);
  
  console.log(`[GAME] Iniciado: ${gameId} con ${game.players.size} jugadores`);
}

function broadcastToLobby(lobbyId, message) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return;
  
  lobby.players.forEach(p => {
    const client = Array.from(clients.values()).find(c => c.name === p.name);
    if (client && client.ws && client.ws.readyState === 1) {
      try {
        client.ws.send(JSON.stringify(message));
      } catch (e) {
        console.error(`Error broadcasting to lobby player ${p.name}:`, e);
      }
    }
  });
}

function handleSetPhase(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  
  game.phase = msg.phase;
  
  if (msg.phase === 'tasks') {
    const spawnedCoins = game.spawnCoins();
    if (game.settings.coinsEnabled && spawnedCoins.length > 0) {
      game.broadcast({
        t: 'coinsSpawned',
        coins: spawnedCoins,
        enabled: true
      });
      pushCoinState(game);
    }
  }
  
  broadcast(client.gameId, { t: 'phaseChange', phase: msg.phase });
}

function handleUpdatePosition(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  
  const position = { x: msg.x, y: msg.y };
  
  // Store position on both client and player objects
  client.lastPosition = position;
  
  const player = game.players.get(client.name);
  if (player) {
    player.position = position;
    
    // Broadcast to all players who are tracking this player
    if (player.investigatedBy && player.investigatedBy.length > 0) {
      player.investigatedBy.forEach(investigatorName => {
        game.sendTo(investigatorName, {
          t: 'trackedPlayerPosition',
          name: client.name,
          position: player.position
        });
      });
    }

    game.broadcast({
      t: 'playerPositionUpdate',
      name: client.name,
      position: player.position
    });
  }
}

function handleTaskCompleted(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  if (game.gameEnded) return;
  
  const playerRole = game.roles.get(client.name);
  if (!isGoodRole(playerRole)) {
    console.log(`[TASKS] ${client.name} (${playerRole}) no puede completar tareas - no es rol bueno`);
    return;
  }
  
  const playerTask = game.playerTasks.get(client.name);
  if (!playerTask) {
    console.log(`[TASKS] No se encontró registro de tareas para ${client.name}`);
    return;
  }
  
  if (playerTask.completed >= playerTask.total) {
    console.log(`[TASKS] ${client.name} ya completó todas sus tareas (${playerTask.completed}/${playerTask.total})`);
    return;
  }
  
  playerTask.completed++;
  console.log(`[TASKS] ${client.name} completó tarea ${playerTask.completed}/${playerTask.total}`);
  
  game.broadcastTaskProgress();
  
  const victory = game.checkVictoryConditions();
  if (victory) {
    game.endGame(victory.winner, victory.reason);
  }
}

function handleAttack(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  if (game.gameEnded) return;
  
  if (client.abilityBlocked && client.abilityBlockedUntil > Date.now()) {
    client.ws.send(JSON.stringify({ t: 'error', message: 'Habilidades bloqueadas' }));
    return;
  }
  
  const target = game.players.get(msg.target);
  if (!target || !target.alive) return;
  
  const attacker = game.players.get(client.name);
  if (!attacker || !attacker.alive) return
  
  if (target.frozen && target.frozenUntil > Date.now()) {
    game.sendTo(client.name, {
      t: 'error',
      message: 'El jugador está congelado e inmune a ataques'
    });
    return;
  }
  
  const targetPos = target.position || { x: 0.5, y: 0.5 };
  const protectingBarricade = game.barricades.find(b => {
    const dx = b.x - targetPos.x;
    const dy = b.y - targetPos.y;
    return Math.sqrt(dx*dx + dy*dy) <= b.radius;
  });
  
  if (protectingBarricade) {
    protectingBarricade.health -= 1;
    
    game.sendTo(msg.target, {
      t: 'barricadeProtecting',
      health: protectingBarricade.health,
      maxHealth: protectingBarricade.maxHealth || 3,
      owner: protectingBarricade.owner
    });
    
    if (protectingBarricade.health <= 0) {
      game.barricades = game.barricades.filter(b => b.id !== protectingBarricade.id);
      
      game.broadcast({
        t: 'barricadeDestroyed',
        barricadeId: protectingBarricade.id,
        owner: protectingBarricade.owner,
        destroyedBy: client.name
      });
      
      const barricadeDamage = 15;
      attacker.health = Math.max(0, attacker.health - barricadeDamage);
      
      game.sendTo(client.name, {
        t: 'damaged',
        amount: barricadeDamage,
        from: 'barricade',
        health: attacker.health
      });
      
      client.abilityBlocked = true;
      client.abilityBlockedUntil = Date.now() + 20000;
      
      game.sendTo(client.name, {
        t: 'splintered',
        duration: 20000,
        message: '¡La barricada te astilló!'
      });
      
      setTimeout(() => {
        client.abilityBlocked = false;
        client.abilityBlockedUntil = 0;
      }, 20000);
      
      if (attacker.health <= 0) {
        attacker.alive = false;
        game.broadcast({
          t: 'playerDied',
          name: client.name,
          killer: 'barricade',
          method: 'barricade_explosion'
        });
        
        const victory = game.checkVictoryConditions();
        if (victory) {
          game.endGame(victory.winner, victory.reason);
        }
      }
      
      console.log(`[BARRICADE] Barricada de ${protectingBarricade.owner} destruida. ${client.name} recibió ${barricadeDamage} daño y efecto Astillado`);
    } else {
      game.broadcast({
        t: 'barricadeUpdate',
        barricadeId: protectingBarricade.id,
        health: protectingBarricade.health,
        maxHealth: protectingBarricade.maxHealth || 3
      });
      
      console.log(`[BARRICADE] Barricada de ${protectingBarricade.owner} dañada: ${protectingBarricade.health}/${protectingBarricade.maxHealth || 3}`);
    }
    return;
  }
  
  target.lastAttacker = client.name;
  
  const baseDamage = msg.damage || game.settings.damageOnHit;
  const multiplier = (game.distractionActive && game.distractionUntil > Date.now()) ? 1.8 : 1;
  const damage = Math.round(baseDamage * multiplier);
  target.health = Math.max(0, target.health - damage);
  
  game.sendTo(msg.target, {
    t: 'damaged',
    amount: damage,
    from: client.name,
    health: target.health
  });
  
  if (target.passiveItems && target.passiveItems.hasGauntlets) {
    const reflectDamage = Math.floor(damage * 0.5);
    attacker.health = Math.max(0, attacker.health - reflectDamage);
    
    game.sendTo(client.name, {
      t: 'gauntletReflect',
      damage: reflectDamage,
      from: msg.target,
      health: attacker.health
    });
    
    console.log(`[ITEM] Manoplas: ${msg.target} reflejó ${reflectDamage} daño a ${client.name}`);
    
    if (attacker.health <= 0) {
      attacker.alive = false;
      game.broadcast({
        t: 'playerDied',
        name: client.name,
        killer: msg.target,
        method: 'gauntlet_reflect'
      });
      
      const victory = game.checkVictoryConditions();
      if (victory) {
        game.endGame(victory.winner, victory.reason);
        return;
      }
    }
  }
  
  if (target.health <= 0) {
    if (target.passiveItems && target.passiveItems.hasFirstAid) {
      target.health = 50;
      target.alive = true;
      
      game.removeItemFromInventory(msg.target, 'botiquin');
      game.updatePassiveItemStatus(msg.target);
      
      game.sendTo(msg.target, {
        t: 'revived',
        health: target.health,
        inventory: game.playerInventories.get(msg.target)
      });
      
      console.log(`[ITEM] Botiquín: ${msg.target} fue revivido automáticamente`);
      return;
    }
    
    if (target.passiveItems && target.passiveItems.hasDagger && target.lastAttacker) {
      const killerName = target.lastAttacker;
      const killer = game.players.get(killerName);
      
      if (killer && killer.alive) {
        killer.health = 0;
        killer.alive = false;
        
        game.removeItemFromInventory(msg.target, 'daga');
        
        game.sendTo(killerName, {
          t: 'daggerRevenge',
          from: msg.target
        });
        
        game.broadcast({
          t: 'playerDied',
          name: killerName,
          killer: msg.target,
          method: 'dagger_revenge'
        });
        
        console.log(`[ITEM] Daga: ${msg.target} mató a ${killerName} al morir`);
      }
    }
    
    target.alive = false;
    game.broadcast({
      t: 'playerDied',
      name: msg.target,
      killer: client.name
    });
    
    const victory = game.checkVictoryConditions();
    if (victory) {
      game.endGame(victory.winner, victory.reason);
    }
  }
}

function handleHeal(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  
  if (client.abilityBlocked && client.abilityBlockedUntil > Date.now()) {
    client.ws.send(JSON.stringify({ t: 'error', message: 'Habilidades bloqueadas' }));
    return;
  }
  
  const target = game.players.get(msg.target);
  if (!target || !target.alive) return;
  
  const healAmount = msg.amount || game.settings.healOnGive;
  target.health = Math.min(100, target.health + healAmount);
  
  game.sendTo(msg.target, {
    t: 'healed',
    amount: healAmount,
    from: client.name,
    health: target.health
  });
}

function handleInvestigate(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  
  if (client.abilityBlocked && client.abilityBlockedUntil > Date.now()) {
    client.ws.send(JSON.stringify({ t: 'error', message: 'Habilidades bloqueadas' }));
    return;
  }
  
  const targetRole = game.roles.get(msg.target);
  
  game.sendTo(client.name, {
    t: 'investigationResult',
    target: msg.target,
    role: targetRole
  });
  
  const target = game.players.get(msg.target);
  if (target) {
    if (!target.investigatedBy) target.investigatedBy = [];
    target.investigatedBy.push(client.name);
    
    // Send initial position so radar can show target immediately
    const targetClient = Array.from(clients.values()).find(c => c.name === msg.target && c.gameId === game.gameId);
    if (targetClient && targetClient.lastPosition) {
      client.ws.send(JSON.stringify({
        t: 'trackedPlayerPosition',
        name: msg.target,
        position: targetClient.lastPosition
      }));
    }
  }
}

function handleDistract(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  
  if (client.abilityBlocked && client.abilityBlockedUntil > Date.now()) {
    client.ws.send(JSON.stringify({ t: 'error', message: 'Habilidades bloqueadas' }));
    return;
  }
  
  const duration = msg.duration || 8000;
  
  game.distractionActive = true;
  game.distractionUntil = Date.now() + duration;
  
  setTimeout(() => { 
    game.distractionActive = false; 
    game.distractionUntil = 0;
  }, duration);
  
  game.broadcast({
    t: 'jokerDistraction',
    by: client.name,
    duration: duration
  });
  
  game.players.forEach((player, name) => {
    const role = game.roles.get(name);
    if (['killer', 'jorguin', 'spy'].includes(role)) {
      game.sendTo(name, {
        t: 'distractionBoost',
        message: '🃏 El Joker causó una distracción. ¡Tu daño aumenta 1.8x!'
      });
    }
  });
  
  console.log(`[JOKER] ${client.name} activó distracción por ${duration}ms. Daño buff activo.`);
}

function handleCollectCoin(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  
  if (game.collectPlayerCoin(client.name, msg.coinId)) {
    const player = game.players.get(client.name);
    game.sendTo(client.name, {
      t: 'coinCollected',
      coinId: msg.coinId,
      totalCoins: player.coins
    });
    
    const playerCoins = game.playerCoins.get(client.name) || [];
    game.sendTo(client.name, {
      t: 'coinsState',
      coins: playerCoins.filter(c => !c.collected)
    });
    
    console.log(`[COINS] ${client.name} recolectó moneda ${msg.coinId}. Total: ${player.coins}`);
  }
}

function handlePurchaseItem(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  
  const result = game.purchaseItem(client.name, msg.itemId);
  if (result.success) {
    game.sendTo(client.name, {
      t: 'itemPurchased',
      itemId: msg.itemId,
      coinsRemaining: result.coinsRemaining,
      inventory: result.inventory
    });
  } else {
    game.sendTo(client.name, {
      t: 'purchaseFailed',
      reason: result.reason
    });
  }
}

function handleUseItem(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  
  if (client.abilityBlocked && client.abilityBlockedUntil > Date.now()) {
    client.ws.send(JSON.stringify({ t: 'error', message: 'Habilidades bloqueadas' }));
    return;
  }
  
  const player = game.players.get(client.name);
  if (!player || !player.alive) return;
  
  const itemId = msg.itemId;
  const itemInfo = SHOP_CATALOG[itemId];
  if (!itemInfo) {
    console.log(`[ITEM] Item inválido: ${itemId}`);
    return;
  }
  
  const hasItem = game.getInventoryItemCount(client.name, itemId) > 0;
  if (!hasItem) {
    console.log(`[ITEM] ${client.name} no tiene ${itemId}`);
    game.sendTo(client.name, {
      t: 'itemError',
      message: 'No tienes este objeto'
    });
    return;
  }

  switch (itemId) {
    case 'pocion_sanacion': {
      const targetName = msg.target || client.name;
      const targetPlayer = game.players.get(targetName);
      if (!targetPlayer || !targetPlayer.alive) {
        game.sendTo(client.name, { t: 'itemError', message: 'Objetivo inválido' });
        return;
      }
      
      const healAmount = itemInfo.healAmount || 30;
      const oldHealth = targetPlayer.health;
      targetPlayer.health = Math.min(100, targetPlayer.health + healAmount);
      const actualHeal = targetPlayer.health - oldHealth;
      
      game.removeItemFromInventory(client.name, itemId);
      
      game.sendTo(targetName, {
        t: 'healed',
        amount: actualHeal,
        from: client.name,
        health: targetPlayer.health,
        byItem: true
      });
      
      game.sendTo(client.name, {
        t: 'itemUsedSuccess',
        itemId,
        target: targetName,
        effect: `Curado ${actualHeal} HP`,
        inventory: game.playerInventories.get(client.name)
      });
      
      console.log(`[ITEM] ${client.name} usó poción de sanación en ${targetName} (+${actualHeal} HP)`);
      break;
    }
    
    case 'binoculares': {
      const targetName = msg.target;
      if (!targetName) {
        game.sendTo(client.name, { t: 'itemError', message: 'Selecciona un objetivo' });
        return;
      }
      
      const targetPlayer = game.players.get(targetName);
      if (!targetPlayer || !targetPlayer.alive) {
        game.sendTo(client.name, { t: 'itemError', message: 'Objetivo inválido' });
        return;
      }
      
      const targetRole = game.roles.get(targetName);
      
      game.removeItemFromInventory(client.name, itemId);
      
      game.sendTo(client.name, {
        t: 'binocularsResult',
        target: targetName,
        role: targetRole,
        inventory: game.playerInventories.get(client.name)
      });
      
      if (!targetPlayer.investigatedBy) targetPlayer.investigatedBy = [];
      if (!targetPlayer.investigatedBy.includes(client.name)) {
        targetPlayer.investigatedBy.push(client.name);
      }
      
      // Send initial position so radar can show target immediately
      const targetClient = Array.from(clients.values()).find(c => c.name === targetName && c.gameId === game.gameId);
      if (targetClient && targetClient.lastPosition) {
        client.ws.send(JSON.stringify({
          t: 'trackedPlayerPosition',
          name: targetName,
          position: targetClient.lastPosition
        }));
      }
      
      console.log(`[ITEM] ${client.name} usó binoculares en ${targetName} (${targetRole})`);
      break;
    }
    
    case 'bomba_humo': {
      const targetName = msg.target;
      if (!targetName) {
        game.sendTo(client.name, { t: 'itemError', message: 'Selecciona un objetivo' });
        return;
      }
      
      const targetPlayer = game.players.get(targetName);
      if (!targetPlayer || !targetPlayer.alive) {
        game.sendTo(client.name, { t: 'itemError', message: 'Objetivo inválido' });
        return;
      }
      
      const duration = itemInfo.duration || 10000;
      targetPlayer.activeEffects = targetPlayer.activeEffects || {};
      targetPlayer.activeEffects.smokeBombedUntil = Date.now() + duration;
      
      game.removeItemFromInventory(client.name, itemId);
      
      game.sendTo(targetName, {
        t: 'smokeBombed',
        duration,
        from: client.name
      });
      
      game.sendTo(client.name, {
        t: 'itemUsedSuccess',
        itemId,
        target: targetName,
        effect: `Visión nublada por ${duration/1000}s`,
        inventory: game.playerInventories.get(client.name)
      });
      
      console.log(`[ITEM] ${client.name} usó bomba de humo en ${targetName}`);
      break;
    }
    
    case 'reloj_arena': {
      const duration = itemInfo.duration || 20000;
      player.activeEffects = player.activeEffects || {};
      player.activeEffects.hourglassUntil = Date.now() + duration;
      
      game.removeItemFromInventory(client.name, itemId);
      
      game.sendTo(client.name, {
        t: 'hourglassActive',
        duration,
        inventory: game.playerInventories.get(client.name)
      });
      
      console.log(`[ITEM] ${client.name} usó reloj de arena (${duration/1000}s)`);
      break;
    }
    
    default:
      console.log(`[ITEM] Item no manejado: ${itemId}`);
  }
}

function handleFreezePlayer(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  
  if (client.abilityBlocked && client.abilityBlockedUntil > Date.now()) {
    client.ws.send(JSON.stringify({ t: 'error', message: 'Habilidades bloqueadas' }));
    return;
  }
  
  const myRole = game.roles.get(client.name);
  if (myRole !== 'psychic') return;
  
  const target = game.players.get(msg.target);
  if (!target || !target.alive) return;
  
  target.frozen = true;
  target.frozenUntil = Date.now() + 15000;
  
  setTimeout(() => {
    target.frozen = false;
    target.frozenUntil = 0;
  }, 15000);
  
  game.sendTo(msg.target, {
    t: 'frozen',
    duration: 15000,
    from: client.name
  });
  
  game.broadcast({
    t: 'playerFrozen',
    target: msg.target,
    from: client.name
  }, msg.target);
}

function handleExterminatePlayer(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  if (game.gameEnded) return;
  
  if (client.abilityBlocked && client.abilityBlockedUntil > Date.now()) {
    client.ws.send(JSON.stringify({ t: 'error', message: 'Habilidades bloqueadas' }));
    return;
  }
  
  const myRole = game.roles.get(client.name);
  if (myRole !== 'psychic') return;
  
  const player = game.players.get(client.name);
  if (player.usedExterminate) {
    game.sendTo(client.name, {
      t: 'error',
      message: 'Ya usaste tu habilidad de exterminar'
    });
    return;
  }
  
  const target = game.players.get(msg.target);
  if (!target || !target.alive) return;
  
  player.usedExterminate = true;
  game.handleExterminate(client.name, msg.target);
}

function handleRevealRole(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  
  if (client.abilityBlocked && client.abilityBlockedUntil > Date.now()) {
    client.ws.send(JSON.stringify({ t: 'error', message: 'Habilidades bloqueadas' }));
    return;
  }
  
  const myRole = game.roles.get(client.name);
  if (myRole !== 'sheriff') return;
  
  const player = game.players.get(client.name);
  if (player.usedReveal) {
    game.sendTo(client.name, {
      t: 'error',
      message: 'Ya usaste tu habilidad de revelar'
    });
    return;
  }
  
  const targetRole = game.roles.get(msg.target);
  if (!targetRole) return;
  
  player.usedReveal = true;
  
  game.broadcast({
    t: 'publicRoleReveal',
    target: msg.target,
    role: targetRole,
    revealer: client.name
  });
  
  game.publicReveals.set(msg.target, targetRole);
}

function handleSheriffShoot(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  if (game.gameEnded) return;
  
  if (client.abilityBlocked && client.abilityBlockedUntil > Date.now()) {
    client.ws.send(JSON.stringify({ t: 'error', message: 'Habilidades bloqueadas' }));
    return;
  }
  
  const myRole = game.roles.get(client.name);
  if (myRole !== 'sheriff') return;
  
  const target = game.players.get(msg.target);
  if (!target || !target.alive) return;
  
  const damage = 25;
  target.health = Math.max(0, target.health - damage);
  
  game.sendTo(msg.target, {
    t: 'damaged',
    amount: damage,
    from: client.name,
    method: 'sheriff_shot',
    health: target.health
  });
  
  if (target.health <= 0) {
    target.alive = false;
    game.broadcast({
      t: 'playerDied',
      name: msg.target,
      killer: client.name
    });
    
    const victory = game.checkVictoryConditions();
    if (victory) {
      game.endGame(victory.winner, victory.reason);
    }
  }
}

function handleJorguinBlock(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  
  if (client.abilityBlocked && client.abilityBlockedUntil > Date.now()) {
    client.ws.send(JSON.stringify({ t: 'error', message: 'Habilidades bloqueadas' }));
    return;
  }
  
  const myRole = game.roles.get(client.name);
  if (myRole !== 'jorguin') return;
  
  const target = game.players.get(msg.target);
  if (!target || !target.alive) return;
  
  const duration = 20000;
  
  // Block ability on player object
  target.abilityBlocked = true;
  target.abilityBlockedUntil = Date.now() + duration;
  
  // Also block on the client object for proper verification
  const targetClient = Array.from(clients.values()).find(c => c.name === msg.target && c.gameId === game.gameId);
  if (targetClient) {
    targetClient.abilityBlocked = true;
    targetClient.abilityBlockedUntil = Date.now() + duration;
    
    setTimeout(() => {
      targetClient.abilityBlocked = false;
      targetClient.abilityBlockedUntil = 0;
    }, duration);
  }
  
  setTimeout(() => {
    target.abilityBlocked = false;
    target.abilityBlockedUntil = 0;
  }, duration);
  
  game.sendTo(msg.target, {
    t: 'abilityBlocked',
    duration: duration,
    from: client.name
  });
  
  console.log(`[JORGUIN] ${client.name} bloqueó habilidades de ${msg.target} por ${duration/1000}s`);
}

function handleJorguinAttack(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  if (game.gameEnded) return;
  
  if (client.abilityBlocked && client.abilityBlockedUntil > Date.now()) {
    client.ws.send(JSON.stringify({ t: 'error', message: 'Habilidades bloqueadas' }));
    return;
  }
  
  const myRole = game.roles.get(client.name);
  if (myRole !== 'jorguin') return;
  
  const target = game.players.get(msg.target);
  if (!target || !target.alive) return;
  
  const damage = 10;
  target.health = Math.max(0, target.health - damage);
  
  game.sendTo(msg.target, {
    t: 'damaged',
    amount: damage,
    from: client.name,
    health: target.health
  });
  
  if (target.health <= 0) {
    target.alive = false;
    game.broadcast({
      t: 'playerDied',
      name: msg.target,
      killer: client.name
    });
    
    const victory = game.checkVictoryConditions();
    if (victory) {
      game.endGame(victory.winner, victory.reason);
    }
  }
}

function handleSpyInvestigate(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  
  if (client.abilityBlocked && client.abilityBlockedUntil > Date.now()) {
    client.ws.send(JSON.stringify({ t: 'error', message: 'Habilidades bloqueadas' }));
    return;
  }
  
  const myRole = game.roles.get(client.name);
  if (myRole !== 'spy') return;
  
  const targetRole = game.roles.get(msg.target);
  if (!targetRole) return;
  
  game.sendTo(client.name, {
    t: 'spyInvestigationResult',
    target: msg.target,
    role: targetRole
  });
  
  const target = game.players.get(msg.target);
  if (target) {
    if (!target.investigatedBy) target.investigatedBy = [];
    if (!target.investigatedBy.includes(client.name)) {
      target.investigatedBy.push(client.name);
    }
    
    // Send initial position so radar can show target immediately
    const targetClient = Array.from(clients.values()).find(c => c.name === msg.target && c.gameId === game.gameId);
    if (targetClient && targetClient.lastPosition) {
      client.ws.send(JSON.stringify({
        t: 'trackedPlayerPosition',
        name: msg.target,
        position: targetClient.lastPosition
      }));
    }
  }
}

function handleSpyAttack(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  if (game.gameEnded) return;
  
  if (client.abilityBlocked && client.abilityBlockedUntil > Date.now()) {
    client.ws.send(JSON.stringify({ t: 'error', message: 'Habilidades bloqueadas' }));
    return;
  }
  
  const myRole = game.roles.get(client.name);
  if (myRole !== 'spy') return;
  
  const target = game.players.get(msg.target);
  if (!target || !target.alive) return;
  
  const damage = 15;
  target.health = Math.max(0, target.health - damage);
  
  game.sendTo(msg.target, {
    t: 'damaged',
    amount: damage,
    from: client.name,
    health: target.health
  });
  
  if (target.health <= 0) {
    target.alive = false;
    game.broadcast({
      t: 'playerDied',
      name: msg.target,
      killer: client.name
    });
    
    const victory = game.checkVictoryConditions();
    if (victory) {
      game.endGame(victory.winner, victory.reason);
    }
  }
}

function handleCarpenterBuild(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  
  if (client.abilityBlocked && client.abilityBlockedUntil > Date.now()) {
    client.ws.send(JSON.stringify({ t: 'error', message: 'Habilidades bloqueadas' }));
    return;
  }
  
  const myRole = game.roles.get(client.name);
  if (myRole !== 'carpenter') return;
  
  const carpenterPlayer = game.players.get(client.name);
  if (!carpenterPlayer || !carpenterPlayer.alive) return;

  const CARPENTER_COOLDOWN_MS = 240000;
  if (carpenterPlayer.carpenterCooldownUntil && carpenterPlayer.carpenterCooldownUntil > Date.now()) {
    const remaining = Math.ceil((carpenterPlayer.carpenterCooldownUntil - Date.now()) / 1000);
    client.ws.send(JSON.stringify({ t: 'error', message: `Barricada en cooldown (${remaining}s)` }));
    return;
  }

  carpenterPlayer.carpenterCooldownUntil = Date.now() + CARPENTER_COOLDOWN_MS;

  const position = msg.position || client.lastPosition || { x: 0.5, y: 0.5 };
  
  const barricade = {
    id: uuidv4(),
    x: position.x,
    y: position.y,
    health: 3,
    maxHealth: 3,
    builder: client.name,
    owner: client.name,
    radius: 0.08,
    createdAt: Date.now()
  };
  
  game.barricades.push(barricade);
  
  game.broadcast({
    t: 'barricadeCreated',
    barricade: {
      id: barricade.id,
      x: barricade.x,
      y: barricade.y,
      owner: barricade.owner,
      health: barricade.health,
      maxHealth: barricade.maxHealth,
      radius: barricade.radius
    }
  });
  
  client.ws.send(JSON.stringify({
    t: 'barricadeBuilt',
    barricade: {
      id: barricade.id,
      x: barricade.x,
      y: barricade.y,
      owner: barricade.owner,
      health: barricade.health,
      maxHealth: barricade.maxHealth,
      radius: barricade.radius
    },
    buildsRemaining: 5 - (playerBarricades.length + 1)
  }));
  
  console.log(`[BARRICADE] ${client.name} construyó barricada en (${position.x.toFixed(2)}, ${position.y.toFixed(2)}). Total: ${playerBarricades.length + 1}/5`);
}

function handleUpdateProfile(client, msg) {
  if (msg.name) client.name = msg.name;
  if (msg.avatarUrl) client.avatarUrl = msg.avatarUrl;
  
  client.ws.send(JSON.stringify({
    t: 'profileUpdated',
    name: client.name,
    avatarUrl: client.avatarUrl
  }));
}

function handlePlayerReady(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  
  if (game.readyPlayers.has(client.name)) return;
  
  game.readyPlayers.add(client.name);
  const readyCount = game.readyPlayers.size;
  const totalPlayers = game.players.size;
  
  console.log(`[READY] ${client.name} está listo (${readyCount}/${totalPlayers})`);
  
  game.broadcast({
    t: 'readyUpdate',
    readyCount: readyCount,
    totalPlayers: totalPlayers
  });
  
  if (readyCount === totalPlayers) {
    console.log(`[GAME] Todos los jugadores listos en ${client.gameId} - Activando radar`);
    
    game.broadcast({
      t: 'allPlayersReady'
    });
    
    game.initializePlayerTasks();
    
    const tasks = game.generateTasks();
    
    game.broadcast({
      t: 'radarState',
      on: true,
      tasks: tasks
    });
    console.log(`[GAME] RadarState enviado con ${tasks.length} tareas`);
    
    game.phase = 'running';
    game.broadcast({
      t: 'phaseChange',
      phase: 'running'
    });
    
    game.broadcastTaskProgress();
    
    if (game.settings.coinsEnabled) {
      game.players.forEach((player, playerName) => {
        const coins = game.spawnCoinsForPlayer(playerName);
        game.sendTo(playerName, {
          t: 'coinsSpawned',
          coins: coins,
          enabled: true
        });
        game.sendTo(playerName, {
          t: 'coinsState',
          coins: coins
        });
      });
      
      game.startCoinRespawnTimer();
      console.log(`[GAME] Monedas inicializadas para ${game.players.size} jugadores`);
    }
    
    game.readyPlayers.clear();
  }
}

function handleRequestRadarState(client, msg) {
  if (!client.gameId) return;
  const game = games.get(client.gameId);
  if (!game) return;
  
  console.log(`[RADAR] ${client.name} solicitó estado del radar`);
  
  // Enviar estado actual del radar y tareas
  if (game.phase === 'running' && game.tasks && game.tasks.length > 0) {
    game.sendTo(client.name, {
      t: 'radarState',
      on: true,
      tasks: game.tasks
    });
    
    // También enviar progreso de tareas
    game.broadcastTaskProgress();
    
    // Enviar monedas individuales si están habilitadas
    if (game.settings.coinsEnabled) {
      const playerCoins = game.playerCoins.get(client.name) || [];
      game.sendTo(client.name, {
        t: 'coinsState',
        coins: playerCoins.filter(c => !c.collected)
      });
    }
  } else {
    game.sendTo(client.name, {
      t: 'radarState',
      on: false,
      tasks: []
    });
  }
}

process.on('SIGTERM', () => {
  console.log('[SERVER] Cerrando...');
  wss.close(() => {
    console.log('[SERVER] Cerrado');
    process.exit(0);
  });
});
