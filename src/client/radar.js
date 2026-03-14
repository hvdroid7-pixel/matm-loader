(() => {
  'use strict';

  /* --------------- CONFIG --------------- */
  let NEAR_THRESHOLD = 0.10;
  const PLAYER_RADIUS_PX = 10;
  const BACKGROUND_IMAGE_SRC = '';
  let SOUND_ENABLED = true;

  /* --------------- DATA --------------- */
  const POINT_LABELS = {
    1:{name:"Iglesia",emoji:"⛪"},2:{name:"Mercado",emoji:"🛒"},3:{name:"Salón de reuniones",emoji:"🏛️"},
    4:{name:"Enfermería",emoji:"🩺"},5:{name:"Bar",emoji:"🍺"},6:{name:"Fuente",emoji:"⛲"},
    7:{name:"Puesto de limonada",emoji:"🍋"},8:{name:"Herrería",emoji:"🔨"},9:{name:"Fábrica textil",emoji:"🧵"},
    10:{name:"Biblioteca",emoji:"📚"},11:{name:"Panadería",emoji:"🥖"},12:{name:"Heladería",emoji:"🍨"},
    13:{name:"Bosque (gran área)",emoji:"🌲"},14:{name:"Residencia real (gran área)",emoji:"🏰"},
    15:{name:"Playa",emoji:"🏖️"},16:{name:"Cabaña",emoji:"🛖"}
  };

  const PRELOADED_MARKERS = [
    {"x":0.7009,"y":0.9203},{"x":0.5646,"y":0.932},{"x":0.5274,"y":0.7311},
    {"x":0.4368,"y":0.7904},{"x":0.4157,"y":0.9615},{"x":0.6584,"y":0.7015},
    {"x":0.7072,"y":0.3779},{"x":0.9679,"y":0.3817},{"x":0.7907,"y":0.936},
    {"x":0.9144,"y":0.6804},{"x":0.9061,"y":0.5308},{"x":0.998,"y":0.5795},
    {"x":0.5962,"y":0.4785},{"x":0.3736,"y":0.4535},{"x":0.6231,"y":0.3033},
    {"x":0.2744,"y":0.7195}
  ];

  const LOCATIONS_WITH_SHOPS = {
    4: 'enfermeria',
    16: 'cabana',
    8: 'herreria',
    15: 'playa'
  };

  const SHOP_CATALOG = {
    enfermeria: {
      name: '🩺 Enfermería',
      items: [
        { id: 'pocion_sanacion', name: 'Poción de sanación', price: 5, emoji: '🧪', desc: 'Cura al usuario o a otro jugador' },
        { id: 'botiquin', name: 'Botiquín', price: 10, emoji: '🩹', desc: 'Revive automáticamente cuando la vida llega a 0' }
      ]
    },
    cabana: {
      name: '🛖 Cabaña',
      items: [
        { id: 'binoculares', name: 'Binoculares', price: 5, emoji: '🔭', desc: 'Descubre el rol de un jugador y lo rastrea en el radar' },
        { id: 'bomba_humo', name: 'Bomba de humo', price: 5, emoji: '💨', desc: 'Nubla la visión de un jugador objetivo' }
      ]
    },
    herreria: {
      name: '🔨 Herrería',
      items: [
        { id: 'manoplas', name: 'Manoplas', price: 10, emoji: '🥊', desc: 'Devuelve el daño recibido al atacante' },
        { id: 'daga', name: 'Daga', price: 25, emoji: '🗡️', desc: 'Al morir, mata instantáneamente al atacante' }
      ]
    },
    playa: {
      name: '🏖️ Playa',
      items: [
        { id: 'reloj_arena', name: 'Reloj de arena', price: 7, emoji: '⏳', desc: 'La barra de velocidad no baja por 20 segundos' }
      ]
    }
  };

  /* --------------- STATE --------------- */
  const state = {
    radarOn: false,
    started:false,
    running:false,
    keys:{up:false,down:false,left:false,right:false},
    lastFrame: performance.now(),
    pos:{x:1,y:1},
    markers: PRELOADED_MARKERS.slice(),
    calib:{active:false,minX:0,maxX:1,minY:0,maxY:1},
    walkSpeed:1/31, runSpeed:0.064252,
    tasks:{},
    chosenZones: [],
    fixingMode:false,
    sweepAngle:0,
    sweepTrail:[],
    pointerAngle:0,
    isMoving:false,
    moveAngle:0,
    inputBlocked:false,
    sprintBlocked:false,
    coins: [],
    barricades: [],
    investigatedPlayers: [],
    trackedPlayers: []
  };
  window.islandMapMarkers = state.markers;

  /* --------------- UI CSS --------------- */
  const CSS = `
  #im_toggle{position:fixed;left:10px;top:72px;z-index:99999;background:linear-gradient(180deg,#081219,#02110b);color:#bfffe0;padding:6px;border-radius:8px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,0.5);font-size:14px;width:30px;height:30px;display:flex;align-items:center;justify-content:center}
  #im_panel{position:fixed;left:60px;top:90px;width:240px;height:300px;z-index:99999;background:rgba(0,0,0,0.78);color:#e9eef7;border-radius:12px;padding:10px;font-family:Inter,Arial;border:2px solid rgba(255,255,255,0.96);box-shadow:0 14px 40px rgba(0,0,0,0.6);display:none}
  #im_header{display:flex;align-items:center;gap:8px;cursor:grab}
  #im_preview{width:100%;height:160px;border-radius:9999px;display:block;background:transparent;margin-top:8px}
  .im_btn{cursor:pointer;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,0.04);color:#e9eef7;border:1px solid rgba(255,255,255,0.03);font-weight:700}
  .im_btn:hover{background:rgba(255,255,255,0.12)}
  .im_btn_shop{background:linear-gradient(135deg,#2ecc71,#27ae60);color:#fff;border:1px solid #3ce37d}
  .im_btn_shop:hover{background:linear-gradient(135deg,#3ce37d,#2ecc71)}
  #im_bottomMsg{position:fixed;left:50%;transform:translateX(-50%);bottom:30px;z-index:100000;background:rgba(0,0,0,0.78);color:white;padding:10px 14px;border-radius:14px;font-weight:700;display:none;align-items:center;gap:10px}
  .zoneEmoji{font-size:18px;margin-right:8px}
  #im_task_count{font-size:12px;color:#bfe6d8;margin-top:8px;text-align:center}
  #im_fullOverlay{position:fixed;inset:0;background:rgba(2,6,23,0.78);z-index:99998;display:none;align-items:center;justify-content:center}
  #im_fullInner{width:560px;height:360px;background:linear-gradient(180deg,#041214,#06141a);border-radius:8px;padding:8px;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,0.6)}
  #im_fullCanvas{flex:1;width:100%;background:#081814;border-radius:6px;display:block;cursor:default}
  .tooltipRay{position:fixed;padding:6px 8px;background:rgba(0,0,0,0.85);color:#fff;border-radius:6px;font-size:12px;pointer-events:none;z-index:120000;display:none}
  #im_topToast{position:fixed;left:50%;transform:translateX(-50%);top:64px;z-index:100001;background:rgba(0,0,0,0.82);color:white;padding:10px 14px;border-radius:12px;font-weight:700;display:none;align-items:center;gap:10px;border:1px solid rgba(255,255,255,0.08)}
  #im_shopModal{position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:100002;display:none;align-items:center;justify-content:center}
  #im_shopContent{background:linear-gradient(180deg,#071018,#0d1a28);border:2px solid #4a9eff;border-radius:16px;padding:20px;min-width:380px;max-width:500px;box-shadow:0 16px 50px rgba(0,0,0,0.7)}
  #im_shopHeader{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px}
  #im_shopTitle{font-size:20px;font-weight:800;color:#fff}
  #im_shopClose{background:rgba(255,255,255,0.1);border:none;color:#fff;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center}
  #im_shopClose:hover{background:rgba(255,100,100,0.3)}
  #im_shopItems{display:flex;flex-direction:column;gap:12px;max-height:400px;overflow-y:auto}
  .im_shopItem{background:rgba(255,255,255,0.05);border:2px solid rgba(74,158,255,0.3);border-radius:12px;padding:14px;display:flex;align-items:center;gap:12px;transition:all 0.2s}
  .im_shopItem:hover{border-color:#4a9eff;background:rgba(74,158,255,0.1)}
  .im_shopItemEmoji{font-size:28px}
  .im_shopItemInfo{flex:1}
  .im_shopItemName{font-weight:700;color:#fff;font-size:15px}
  .im_shopItemDesc{font-size:12px;color:rgba(255,255,255,0.7);margin-top:4px}
  .im_shopItemPrice{font-weight:800;color:#ffd700;font-size:16px}
  .im_shopBuyBtn{padding:8px 14px;background:linear-gradient(135deg,#4a9eff,#2980b9);color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;transition:all 0.2s}
  .im_shopBuyBtn:hover{transform:scale(1.05);box-shadow:0 4px 12px rgba(74,158,255,0.4)}
  .im_shopBuyBtn:disabled{opacity:0.5;cursor:not-allowed;transform:none}
  #im_fixModal{position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:100003;display:none;align-items:center;justify-content:center}
  #im_fixContent{background:linear-gradient(180deg,#0a1520,#0d1a28);border:2px solid #ff6b6b;border-radius:16px;padding:20px;min-width:380px;max-width:500px;max-height:80vh;overflow-y:auto;box-shadow:0 16px 50px rgba(0,0,0,0.7)}
  #im_fixHeader{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid rgba(255,100,100,0.2);padding-bottom:12px}
  #im_fixTitle{font-size:18px;font-weight:800;color:#ff6b6b}
  #im_fixClose{background:rgba(255,255,255,0.1);border:none;color:#fff;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center}
  #im_fixClose:hover{background:rgba(255,100,100,0.3)}
  #im_fixWarning{background:rgba(255,107,107,0.15);border:1px solid rgba(255,107,107,0.3);border-radius:10px;padding:14px;margin-bottom:16px;color:#ffb4b4;font-size:13px;line-height:1.5}
  #im_fixWarning .warning-icon{font-size:20px;margin-right:8px}
  #im_fixButtons{display:flex;gap:10px;justify-content:center;margin-bottom:16px}
  .im_fixBtn{padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer;border:none;transition:all 0.2s}
  .im_fixBtn.cancel{background:rgba(255,255,255,0.1);color:#fff}
  .im_fixBtn.cancel:hover{background:rgba(255,255,255,0.2)}
  .im_fixBtn.confirm{background:linear-gradient(135deg,#ff6b6b,#ee5a5a);color:#fff}
  .im_fixBtn.confirm:hover{transform:scale(1.05);box-shadow:0 4px 12px rgba(255,107,107,0.4)}
  #im_fixLocations{display:none;flex-direction:column;gap:8px}
  #im_fixLocationsTitle{color:#fff;font-weight:700;margin-bottom:10px;text-align:center}
  .im_fixLocation{background:rgba(255,255,255,0.05);border:2px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;transition:all 0.2s}
  .im_fixLocation:hover{border-color:#4a9eff;background:rgba(74,158,255,0.1);transform:translateX(4px)}
  .im_fixLocationEmoji{font-size:22px}
  .im_fixLocationName{flex:1;color:#fff;font-weight:600}
  .im_fixLocationCoords{font-size:11px;color:rgba(255,255,255,0.5)}
  `;
  const style = document.createElement('style'); style.innerText = CSS; document.head.appendChild(style);

  /* --------------- BUILD DOM --------------- */
  const toggle = document.createElement('button'); toggle.id='im_toggle'; toggle.textContent='☰'; document.body.appendChild(toggle);
  const panel = document.createElement('div'); panel.id='im_panel';
  panel.innerHTML = `
    <div id="im_header"><div style="font-weight:800">Radar de Tareas</div><div style="margin-left:auto;font-size:12px;color:#cfe9d8">Preview</div></div>
    <canvas id="im_preview" width="480" height="320"></canvas>
    <div style="display:flex;gap:8px;justify-content:center;margin-top:10px"><button id="im_hide" class="im_btn">Ocultar</button><button id="im_openFull" class="im_btn">Mapa completo</button></div>
    <div id="im_task_count">Tareas completadas: 0 / 0</div>
  `;
  document.body.appendChild(panel);

  const bottomMsg = document.createElement('div'); bottomMsg.id='im_bottomMsg';
  bottomMsg.innerHTML = `<span class="zoneEmoji"></span><span class="zoneName"></span><button id="im_startTask" class="im_btn" style="display:none;margin-left:8px">¡Hay una tarea aquí! Iniciar tarea</button><button id="im_openShop" class="im_btn im_btn_shop" style="display:none;margin-left:8px">🛒 Ver Tienda</button>`;
  document.body.appendChild(bottomMsg);

  const shopModal = document.createElement('div'); shopModal.id='im_shopModal';
  shopModal.innerHTML = `<div id="im_shopContent"><div id="im_shopHeader"><div id="im_shopTitle">Tienda</div><button id="im_shopClose">✕</button></div><div id="im_shopItems"></div></div>`;
  document.body.appendChild(shopModal);

  const fixModal = document.createElement('div'); fixModal.id='im_fixModal';
  fixModal.innerHTML = `<div id="im_fixContent"><div id="im_fixHeader"><div id="im_fixTitle">⚠️ Arreglar ubicación</div><button id="im_fixClose">✕</button></div><div id="im_fixWarning"><span class="warning-icon">⚠️</span><strong>Advertencia:</strong> Arreglar tu ubicación puede ser detectado como trampa por otros jugadores. Usa esta función con responsabilidad y solo para corregir errores de sincronización.</div><div id="im_fixButtons"><button class="im_fixBtn cancel" id="im_fixCancel">Cancelar</button><button class="im_fixBtn confirm" id="im_fixConfirm">Continuar</button></div><div id="im_fixLocations"><div id="im_fixLocationsTitle">Selecciona una ubicación:</div><div id="im_fixLocationsList"></div></div></div>`;
  document.body.appendChild(fixModal);

  const taskModal = document.createElement('div'); taskModal.id='im_taskModal';
  Object.assign(taskModal.style, { position:'fixed', left:'50%', top:'50%', transform:'translate(-50%,-50%)', zIndex:100001, display:'none' });
  taskModal.innerHTML = `<div style="background:linear-gradient(180deg,#071018,#091626);padding:12px;border-radius:10px;color:#fff;min-width:480px;box-shadow:0 12px 40px rgba(0,0,0,0.6)"><div style="display:flex;justify-content:space-between;align-items:center"><div id="im_taskTitle" style="font-weight:800">Minijuego</div><button id="im_taskCancel" class="im_btn">Cancelar</button></div><div id="im_taskContent" style="margin-top:8px;min-height:180px"></div></div>`;
  document.body.appendChild(taskModal);

  const overlay = document.createElement('div'); overlay.id='im_fullOverlay';
  overlay.innerHTML = `<div id="im_fullInner"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><button id="im_closeFull" class="im_btn">Cerrar</button><div style="flex:1"></div><button id="im_fix" class="im_btn">Arreglar ubicación</button></div><canvas id="im_fullCanvas"></canvas></div>`;
  document.body.appendChild(overlay);

  const tooltip = document.createElement('div'); tooltip.className = 'tooltipRay'; document.body.appendChild(tooltip);
  const topToast = document.createElement('div'); topToast.id = 'im_topToast'; document.body.appendChild(topToast);

  /* --------------- REFS --------------- */
  const preview = panel.querySelector('#im_preview'), pctx = preview.getContext('2d');
  const hideBtn = panel.querySelector('#im_hide'), openFullBtn = panel.querySelector('#im_openFull');
  const startTaskBtn = bottomMsg.querySelector('#im_startTask');
  const openShopBtn = bottomMsg.querySelector('#im_openShop');
  const shopTitle = shopModal.querySelector('#im_shopTitle');
  const shopItems = shopModal.querySelector('#im_shopItems');
  const shopCloseBtn = shopModal.querySelector('#im_shopClose');
  const fixCloseBtn = fixModal.querySelector('#im_fixClose');
  const fixCancelBtn = fixModal.querySelector('#im_fixCancel');
  const fixConfirmBtn = fixModal.querySelector('#im_fixConfirm');
  const fixLocations = fixModal.querySelector('#im_fixLocations');
  const fixLocationsList = fixModal.querySelector('#im_fixLocationsList');
  const taskTitle = taskModal.querySelector('#im_taskTitle'), taskContent = taskModal.querySelector('#im_taskContent');
  const taskCancel = taskModal.querySelector('#im_taskCancel');
  const fullCanvas = overlay.querySelector('#im_fullCanvas'), fullCtx = fullCanvas.getContext('2d');
  const closeFullBtn = overlay.querySelector('#im_closeFull');
  const fixBtn = overlay.querySelector('#im_fix');
  const taskCountEl = panel.querySelector('#im_task_count');

  /* --------------- BG Image --------------- */
  let bgImage = new Image(), bgLoaded=false;
  bgImage.crossOrigin='anonymous';
  bgImage.onload = ()=>{ bgLoaded=true; drawAll(); };
  bgImage.onerror = ()=>{ bgLoaded=false; };
  bgImage.src = BACKGROUND_IMAGE_SRC;

  /* --------------- AUDIO --------------- */
  const audioCtx = (window.AudioContext||window.webkitAudioContext) ? new (window.AudioContext||window.webkitAudioContext)() : null;
  function playTone(freq, time=0.12, type='sine', gain=0.08){ if(!SOUND_ENABLED || !audioCtx) return; const o = audioCtx.createOscillator(); const g = audioCtx.createGain(); o.type=type; o.frequency.value=freq; g.gain.value=gain; o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime+time); }
  function playSound(name){ if(!SOUND_ENABLED || !audioCtx) return; switch(name){ case 'note': playTone(880,0.10,'sine',0.06); break; case 'click': playTone(1200,0.06,'square',0.05); break; case 'success': playTone(880,0.12,'sine',0.10); setTimeout(()=>playTone(1320,0.10,'sine',0.08),120); break; case 'fail': playTone(160,0.18,'sawtooth',0.14); break; } }

  /* --------------- HELPERS --------------- */
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  function calibrate(raw){
    if(!state.calib.active) return {x:raw.x,y:raw.y};
    const r = state.calib;
    return { x: clamp((raw.x - r.minX)/(r.maxX - r.minX),0,1), y: clamp((raw.y - r.minY)/(r.maxY - r.minY),0,1) };
  }

  function rawToCanvas(raw, canvas){
    const c = state.calib.active ? { x: (raw.x-state.calib.minX)/(state.calib.maxX-state.calib.minX), y: (raw.y-state.calib.minY)/(state.calib.maxY-state.calib.minY) } : { x: raw.x, y: raw.y };
    return { x: c.x * canvas.width, y: c.y * canvas.height };
  }

  function rawToPreviewPos(dx, dy, radius, cx, cy, maxDistance){
    const d = Math.hypot(dx, dy);
    const maxD = (typeof maxDistance === 'number') ? maxDistance : NEAR_THRESHOLD;
    const t = Math.min(1, d / Math.max(0.0001, maxD));
    const ux = d > 0 ? dx / d : 1;
    const uy = d > 0 ? dy / d : 0;
    return { x: cx + ux * (t * radius), y: cy + uy * (t * radius) };
  }

  /* --------------- RESIZE PREVIEW --------------- */
  function resizePreview(){
    const cssW = preview.clientWidth, cssH = preview.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(cssW * ratio)), h = Math.max(1, Math.floor(cssH * ratio));
    if (preview.width !== w || preview.height !== h){
      preview.width = w; preview.height = h;
      pctx.setTransform(ratio,0,0,ratio,0,0);
    }
  }

  /* --------------- DRAW PREVIEW --------------- */
  function drawPreview(ts){
    resizePreview();
    const cssW = preview.clientWidth, cssH = preview.clientHeight;
    const cx = cssW/2, cy = cssH/2;
    let radius = Math.max(20, Math.min(cssW, cssH)/2 - 10);

    pctx.clearRect(0,0,preview.width, preview.height);

    const r0 = Math.max(1, radius * 0.05);
    const r1 = Math.max(r0 + 1, radius);
    const g = pctx.createRadialGradient(cx, cy, r0, cx, cy, r1);

    if (!state.radarOn){
      g.addColorStop(0,'rgba(0,20,6,0.10)'); g.addColorStop(1,'rgba(0,6,0,0.02)');
      pctx.fillStyle = g; pctx.beginPath(); pctx.arc(cx,cy,radius+6,0,Math.PI*2); pctx.fill();
      pctx.fillStyle = 'rgba(255,255,255,0.6)'; pctx.font = '12px sans-serif'; pctx.textAlign='center'; pctx.fillText('Radar apagado', cx, cy);
      drawCenteredTriangle(pctx, cx, cy, state.pointerAngle, 14, '#6b7280');
      return;
    }

    g.addColorStop(0,'rgba(0,20,6,0.45)'); g.addColorStop(1,'rgba(0,6,0,0.08)');
    pctx.fillStyle = g; pctx.beginPath(); pctx.arc(cx,cy,radius+6,0,Math.PI*2); pctx.fill();

    pctx.strokeStyle = 'rgba(255,255,255,0.03)'; pctx.lineWidth = 1;
    for (let i=1;i<=3;i++){ pctx.beginPath(); pctx.arc(cx,cy,(radius/3)*i,0,Math.PI*2); pctx.stroke(); }

    const now = ts || performance.now();
    const prev = preview._lastTs || now;
    const dt = Math.max(0, (now - prev) / 1000);
    preview._lastTs = now;
    state.sweepAngle = (state.sweepAngle + 18 * dt) % 360;
    state.sweepTrail = (state.sweepTrail || []).filter(it => now - it.t < 900);
    state.sweepTrail.push({ angle: state.sweepAngle, t: now });

    state.sweepTrail.forEach(it => {
      const age = now - it.t;
      const alpha = 1 - (age / 900);
      const ang = (it.angle - 90) * Math.PI/180;
      const x2 = cx + Math.cos(ang) * radius;
      const y2 = cy + Math.sin(ang) * radius;
      pctx.beginPath(); pctx.moveTo(cx,cy); pctx.lineTo(x2,y2);
      pctx.strokeStyle = `rgba(78,255,120,${0.06 * alpha})`; pctx.lineWidth = 1.6; pctx.stroke();
    });

    const mainAng = (state.sweepAngle - 90) * Math.PI/180;
    pctx.beginPath(); pctx.moveTo(cx,cy); pctx.lineTo(cx + Math.cos(mainAng) * radius, cy + Math.sin(mainAng) * radius);
    pctx.strokeStyle = 'rgba(120,255,140,0.92)'; pctx.lineWidth = 2.2; pctx.stroke();

    const maxDistance = NEAR_THRESHOLD;
    for (let i=0;i<state.markers.length;i++){
      const m = state.markers[i];
      const dx = m.x - state.pos.x;
      const dy = m.y - state.pos.y;
      const d = Math.hypot(dx, dy);
      const pos = rawToPreviewPos(dx, dy, radius, cx, cy, maxDistance);
      const size = 9;
      const t = state.tasks[i];
      const done = !!(t && t.completed);

      const fade = clamp(1 - Math.min(1, d / (maxDistance * 1.8)), 0.28, 1);
      pctx.globalAlpha = fade;
      pctx.fillStyle = done ? '#29d16a' : '#ffffff';
      pctx.fillRect(Math.round(pos.x - size/2), Math.round(pos.y - size/2), size, size);
      pctx.globalAlpha = 1;
      pctx.strokeStyle = `rgba(0,0,0,0.08)`; pctx.lineWidth = 1; pctx.strokeRect(Math.round(pos.x - size/2)+0.5, Math.round(pos.y - size/2)+0.5, Math.max(1,size-1), Math.max(1,size-1));
    }

    state.coins.forEach(coin => {
      if (coin.collected) return;
      const dx = coin.x - state.pos.x;
      const dy = coin.y - state.pos.y;
      const d = Math.hypot(dx, dy);
      
      const pos = rawToPreviewPos(dx, dy, radius, cx, cy, maxDistance);
      
      const fade = clamp(1 - Math.min(1, d / (maxDistance * 1.8)), 0.28, 1);
      pctx.globalAlpha = fade;
      
      pctx.fillStyle = '#ffd700';
      pctx.beginPath();
      pctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
      pctx.fill();
      pctx.strokeStyle = '#b8860b';
      pctx.lineWidth = 1;
      pctx.stroke();
      
      pctx.globalAlpha = 1;
    });

    state.barricades.forEach(barricade => {
      const dx = barricade.x - state.pos.x;
      const dy = barricade.y - state.pos.y;
      const d = Math.hypot(dx, dy);
      
      const pos = rawToPreviewPos(dx, dy, radius, cx, cy, maxDistance);
      
      const fade = clamp(1 - Math.min(1, d / (maxDistance * 1.8)), 0.28, 1);
      pctx.globalAlpha = fade;
      
      const size = 10;
      pctx.fillStyle = '#8B4513';
      pctx.fillRect(pos.x - size/2, pos.y - size/2, size, size);
      pctx.strokeStyle = '#5D3A1A';
      pctx.lineWidth = 2;
      pctx.strokeRect(pos.x - size/2, pos.y - size/2, size, size);
      
      pctx.fillStyle = '#fff';
      pctx.font = '8px Arial';
      pctx.textAlign = 'center';
      pctx.textBaseline = 'top';
      pctx.fillText(`${barricade.health || 0}/${barricade.maxHealth || 3}`, pos.x, pos.y + size/2 + 2);
      
      pctx.globalAlpha = 1;
    });

    state.trackedPlayers.forEach(player => {
      if (!player.position) return;
      const dx = player.position.x - state.pos.x;
      const dy = player.position.y - state.pos.y;
      const d = Math.hypot(dx, dy);
      
      const pos = rawToPreviewPos(dx, dy, radius, cx, cy, maxDistance);
      
      const fade = clamp(1 - Math.min(1, d / (maxDistance * 1.8)), 0.28, 1);
      pctx.globalAlpha = fade;
      
      pctx.fillStyle = '#ff4444';
      pctx.beginPath();
      pctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
      pctx.fill();
      pctx.strokeStyle = '#aa0000';
      pctx.lineWidth = 1.5;
      pctx.stroke();
      
      if (d < maxDistance * 0.8) {
        pctx.fillStyle = '#fff';
        pctx.font = '8px Arial';
        pctx.textAlign = 'center';
        pctx.fillText(player.name.slice(0, 8), pos.x, pos.y + 12);
      }
      
      pctx.globalAlpha = 1;
    });

    if (state.isMoving){
      const diff = ((state.moveAngle - state.pointerAngle + 540) % 360) - 180;
      state.pointerAngle = (state.pointerAngle + diff * 0.18 + 360) % 360;
    } else {
      const target = (state.sweepAngle) % 360;
      const diff = ((target - state.pointerAngle + 540) % 360) - 180;
      state.pointerAngle = (state.pointerAngle + diff * 0.03 + 360) % 360;
    }

    drawCenteredTriangle(pctx, cx, cy, state.pointerAngle, 14, '#ef4444');

    pctx.beginPath(); pctx.arc(cx,cy,radius+6,0,Math.PI*2);
    pctx.strokeStyle = 'rgba(255,255,255,0.12)'; pctx.lineWidth = 1; pctx.stroke();
  }

  function drawCenteredTriangle(ctx, cx, cy, angleDeg, size, color){
    const rad = angleDeg * Math.PI/180;
    const tipX = cx + Math.cos(rad) * size;
    const tipY = cy - Math.sin(rad) * size;
    const baseRadius = size * 0.9;
    const ang1 = rad + (140 * Math.PI/180);
    const ang2 = rad - (140 * Math.PI/180);
    const b1x = cx + Math.cos(ang1) * baseRadius;
    const b1y = cy - Math.sin(ang1) * baseRadius;
    const b2x = cx + Math.cos(ang2) * baseRadius;
    const b2y = cy - Math.sin(ang2) * baseRadius;
    ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(b1x, b1y); ctx.lineTo(b2x, b2y); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.8; ctx.stroke();
  }

  /* --------------- DRAW FULL MAP --------------- */
  function drawFull(){
    const DPR = window.devicePixelRatio || 1;
    const rect = fullCanvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * DPR)), h = Math.max(1, Math.floor(rect.height * DPR));
    if (fullCanvas.width !== w || fullCanvas.height !== h) fullCanvas.width = w, fullCanvas.height = h;
    fullCtx.setTransform(1,0,0,1,0,0);
    fullCtx.clearRect(0,0,fullCanvas.width,fullCanvas.height);

    const g = fullCtx.createLinearGradient(0,0,0,fullCanvas.height); g.addColorStop(0,'#041214'); g.addColorStop(1,'#06121a'); fullCtx.fillStyle = g; fullCtx.fillRect(0,0,fullCanvas.width,fullCanvas.height);

    fullCtx.strokeStyle = 'rgba(255,255,255,0.03)'; fullCtx.lineWidth = Math.max(1,DPR);
    for(let i=0;i<=10;i++){ fullCtx.beginPath(); fullCtx.moveTo(i*fullCanvas.width/10,0); fullCtx.lineTo(i*fullCanvas.width/10,fullCanvas.height); fullCtx.stroke(); }
    for(let j=0;j<=10;j++){ fullCtx.beginPath(); fullCtx.moveTo(0,j*fullCanvas.height/10); fullCtx.lineTo(fullCanvas.width,j*fullCanvas.height/10); fullCtx.stroke(); }

    for(let i=0;i<state.markers.length;i++){
      const m = state.markers[i];
      const px = m.x * fullCanvas.width;
      const py = m.y * fullCanvas.height;
      const size = 12;
      const t = state.tasks[i];
      const done = !!(t && t.completed);
      fullCtx.fillStyle = done ? '#29d16a' : '#ffffff';
      fullCtx.fillRect(Math.round(px - size/2), Math.round(py - size/2), size, size);
      fullCtx.strokeStyle = 'rgba(0,0,0,0.08)'; fullCtx.lineWidth = 1; fullCtx.strokeRect(Math.round(px - size/2)+0.5, Math.round(py - size/2)+0.5, size-1, size-1);
    }

    state.coins.forEach(coin => {
      if (coin.collected) return;
      const px = coin.x * fullCanvas.width;
      const py = coin.y * fullCanvas.height;
      
      fullCtx.fillStyle = '#ffd700';
      fullCtx.beginPath();
      fullCtx.arc(px, py, 6, 0, Math.PI * 2);
      fullCtx.fill();
      fullCtx.strokeStyle = '#b8860b';
      fullCtx.lineWidth = 1.5;
      fullCtx.stroke();
    });

    state.barricades.forEach(barricade => {
      const px = barricade.x * fullCanvas.width;
      const py = barricade.y * fullCanvas.height;
      const size = 14;
      
      fullCtx.fillStyle = '#8B4513';
      fullCtx.fillRect(px - size/2, py - size/2, size, size);
      fullCtx.strokeStyle = '#5D3A1A';
      fullCtx.lineWidth = 2;
      fullCtx.strokeRect(px - size/2, py - size/2, size, size);
      
      fullCtx.fillStyle = '#fff';
      fullCtx.font = '10px Arial';
      fullCtx.textAlign = 'center';
      fullCtx.textBaseline = 'top';
      fullCtx.fillText(`${barricade.health || 0}/${barricade.maxHealth || 3}`, px, py + size/2 + 2);
    });

    state.trackedPlayers.forEach(player => {
      if (!player.position) return;
      const px = player.position.x * fullCanvas.width;
      const py = player.position.y * fullCanvas.height;
      
      fullCtx.fillStyle = '#ff4444';
      fullCtx.beginPath();
      fullCtx.arc(px, py, 8, 0, Math.PI * 2);
      fullCtx.fill();
      fullCtx.strokeStyle = '#aa0000';
      fullCtx.lineWidth = 2;
      fullCtx.stroke();
      
      fullCtx.fillStyle = '#fff';
      fullCtx.font = '10px Arial';
      fullCtx.textAlign = 'center';
      fullCtx.fillText(player.name, px, py + 14);
    });

    const pp = rawToCanvas(state.pos, fullCanvas);
    drawCenteredTriangle(fullCtx, pp.x, pp.y, state.pointerAngle, PLAYER_RADIUS_PX + 6, '#ef4444');
  }

  /* --------------- FULL MAP HOVER TOOLTIP --------------- */
  function fullCanvasMouseMove(ev){
    if (overlay.style.display !== 'flex') return;
    const rect = fullCanvas.getBoundingClientRect();
    const DPR = window.devicePixelRatio || 1;
    const mx = (ev.clientX - rect.left) * DPR;
    const my = (ev.clientY - rect.top) * DPR;
    let found = null;
    for(let i=0;i<state.markers.length;i++){
      const m = state.markers[i];
      const px = m.x * fullCanvas.width;
      const py = m.y * fullCanvas.height;
      const size = 12 * (window.devicePixelRatio || 1);
      if (mx >= px - size && mx <= px + size && my >= py - size && my <= py + size){
        found = { idx:i, m, px, py }; break;
      }
    }
    if (found){
      const lab = POINT_LABELS[found.idx+1] ? POINT_LABELS[found.idx+1].name : `Punto ${found.idx+1}`;
      tooltip.style.display = 'block';
      tooltip.textContent = lab;
      tooltip.style.left = (ev.clientX + 12) + 'px';
      tooltip.style.top = (ev.clientY + 12) + 'px';
    } else {
      tooltip.style.display = 'none';
    }
  }

  /* --------------- PROXIMITY & TASK UI --------------- */
  function updateProximityUI(){
    if (!state.radarOn) {
      const total = Object.keys(state.tasks||{}).length;
      const completed = Object.values(state.tasks||{}).filter(x=>x && x.completed).length;
      taskCountEl.textContent = `Tareas completadas: ${completed} / ${total}`;
      bottomMsg.style.display='none';
      startTaskBtn.style.display='none';
      openShopBtn.style.display='none';
      return;
    }

    let nearest = null;
    for(let i=0;i<state.markers.length;i++){
      const m = state.markers[i];
      const dx = state.pos.x - m.x, dy = state.pos.y - m.y;
      const d = Math.sqrt(dx*dx + dy*dy);
      if (d <= NEAR_THRESHOLD){
        if (!nearest || d < nearest.dist) nearest = { idx:i, dist:d, m };
      }
    }
    if (nearest){
      const info = POINT_LABELS[nearest.idx+1] || { name:`Punto ${nearest.idx+1}`, emoji:'📍' };
      bottomMsg.querySelector('.zoneEmoji').textContent = info.emoji || '';
      bottomMsg.querySelector('.zoneName').textContent = info.name;
      bottomMsg.style.display = 'flex';
      const t = state.tasks[nearest.idx];
      if (t && !t.completed && state.radarOn){
        startTaskBtn.style.display = 'inline-block';
        startTaskBtn.onclick = ()=> openTaskForZone(nearest.idx);
      } else {
        startTaskBtn.style.display = 'none';
        startTaskBtn.onclick = null;
      }
      const locationId = nearest.idx + 1;
      const shopKey = LOCATIONS_WITH_SHOPS[locationId];
      if (shopKey && SHOP_CATALOG[shopKey]) {
        openShopBtn.style.display = 'inline-block';
        openShopBtn.onclick = () => openShopModal(shopKey);
      } else {
        openShopBtn.style.display = 'none';
        openShopBtn.onclick = null;
      }
    } else {
      bottomMsg.style.display = 'none';
      startTaskBtn.style.display = 'none';
      startTaskBtn.onclick = null;
      openShopBtn.style.display = 'none';
      openShopBtn.onclick = null;
    }
    const total = Object.keys(state.tasks||{}).length;
    const completed = Object.values(state.tasks||{}).filter(x=>x && x.completed).length;
    taskCountEl.textContent = `Tareas completadas: ${completed} / ${total}`;
    
    checkCoinProximity();
  }

  const COIN_COLLECT_THRESHOLD = 0.03;
  function checkCoinProximity() {
    if (!state.radarOn || !state.coins || state.coins.length === 0) return;
    
    for (let i = state.coins.length - 1; i >= 0; i--) {
      const coin = state.coins[i];
      if (coin.collected) continue;
      
      const dx = state.pos.x - coin.x;
      const dy = state.pos.y - coin.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist <= COIN_COLLECT_THRESHOLD) {
        coin.collected = true;
        window.postMessage({
          source: 'ft-radar',
          type: 'collectCoin',
          coinId: coin.id
        }, '*');
        playSound('success');
      }
    }
  }

  /* --------------- SHOP MODAL --------------- */
  let currentShopKey = null;
  function openShopModal(shopKey){
    currentShopKey = shopKey;
    const shop = SHOP_CATALOG[shopKey];
    if (!shop) return;
    
    shopTitle.textContent = shop.name;
    shopItems.innerHTML = '';
    
    shop.items.forEach(item => {
      const itemEl = document.createElement('div');
      itemEl.className = 'im_shopItem';
      itemEl.innerHTML = `
        <div class="im_shopItemEmoji">${item.emoji}</div>
        <div class="im_shopItemInfo">
          <div class="im_shopItemName">${item.name}</div>
          <div class="im_shopItemDesc">${item.desc}</div>
        </div>
        <div class="im_shopItemPrice">💰 ${item.price}</div>
        <button class="im_shopBuyBtn" data-item-id="${item.id}">Comprar</button>
      `;
      itemEl.querySelector('.im_shopBuyBtn').addEventListener('click', () => purchaseItem(item));
      shopItems.appendChild(itemEl);
    });
    
    shopModal.style.display = 'flex';
    playSound('click');
  }

  function closeShopModal(){
    shopModal.style.display = 'none';
    currentShopKey = null;
  }

  function purchaseItem(item){
    window.postMessage({ 
      source: 'ft-radar', 
      type: 'purchaseItem', 
      shopKey: currentShopKey,
      itemId: item.id, 
      itemName: item.name,
      price: item.price 
    }, '*');
    playSound('success');
    showTopToast(`Comprando ${item.emoji} ${item.name}...`);
  }

  shopCloseBtn.addEventListener('click', closeShopModal);
  shopModal.addEventListener('click', (e) => {
    if (e.target === shopModal) closeShopModal();
  });

  /* --------------- FIX (dragging on full map) --------------- */
  let dragging = { active:false };
  function enableCanvasDragging(){
    fullCanvas.style.cursor = 'grab';
    fullCanvas.addEventListener('mousedown', onDown);
    fullCanvas.addEventListener('touchstart', onTouchStart, {passive:false});
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onTouchMove, {passive:false});
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onTouchEnd);
  }
  function disableCanvasDragging(){
    fullCanvas.style.cursor = 'default';
    fullCanvas.removeEventListener('mousedown', onDown);
    fullCanvas.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('touchend', onTouchEnd);
  }
  function canvasCoordsFromEvent(ev, canvas){
    const rect = canvas.getBoundingClientRect();
    if(ev.touches && ev.touches[0]) return {x: ev.touches[0].clientX - rect.left, y: ev.touches[0].clientY - rect.top};
    return {x: ev.clientX - rect.left, y: ev.clientY - rect.top};
  }
  function onDown(ev){
    if(!state.fixingMode) return;
    const c = canvasCoordsFromEvent(ev, fullCanvas);
    const playerPos = rawToCanvas(state.pos, fullCanvas);
    const d = Math.hypot(c.x - playerPos.x, c.y - playerPos.y);
    if (d <= PLAYER_RADIUS_PX + 6){ dragging.active = true; fullCanvas.style.cursor='grabbing'; playSound('click'); }
  }
  function onMove(ev){
    if(!state.fixingMode || !dragging.active) return;
    const c = canvasCoordsFromEvent(ev, fullCanvas);
    let nx = c.x / fullCanvas.width, ny = c.y / fullCanvas.height;
    if (state.calib.active){
      nx = state.calib.minX + nx*(state.calib.maxX-state.calib.minX);
      ny = state.calib.minY + ny*(state.calib.maxY-state.calib.minY);
    }
    state.pos.x = clamp(nx,0,1); state.pos.y = clamp(ny,0,1);
    drawAll();
  }
  function onUp(ev){
    if(!state.fixingMode) return;
    if (dragging.active){ dragging.active = false; fullCanvas.style.cursor='grab'; stopFixMode(); playSound('success'); showTopToast('Ubicación ajustada. Usa con responsabilidad.'); }
  }
  function onTouchStart(ev){ ev.preventDefault(); onDown(ev); }
  function onTouchMove(ev){ ev.preventDefault(); onMove(ev); }
  function onTouchEnd(ev){ onUp(ev); }

  function openFixModal(){
    fixModal.style.display = 'flex';
    fixLocations.style.display = 'none';
    fixModal.querySelector('#im_fixButtons').style.display = 'flex';
    playSound('click');
  }

  function closeFixModal(){
    fixModal.style.display = 'none';
    fixLocations.style.display = 'none';
  }

  function showLocationsList(){
    fixModal.querySelector('#im_fixButtons').style.display = 'none';
    fixLocations.style.display = 'flex';
    fixLocationsList.innerHTML = '';
    
    for (let i = 0; i < state.markers.length; i++){
      const marker = state.markers[i];
      const label = POINT_LABELS[i + 1] || { name: `Punto ${i + 1}`, emoji: '📍' };
      
      const locationEl = document.createElement('div');
      locationEl.className = 'im_fixLocation';
      locationEl.innerHTML = `
        <div class="im_fixLocationEmoji">${label.emoji}</div>
        <div class="im_fixLocationName">${label.name}</div>
        <div class="im_fixLocationCoords">(${(marker.x * 100).toFixed(0)}%, ${(marker.y * 100).toFixed(0)}%)</div>
      `;
      locationEl.addEventListener('click', () => teleportToLocation(i));
      fixLocationsList.appendChild(locationEl);
    }
  }

  function teleportToLocation(index){
    const marker = state.markers[index];
    if (!marker) return;
    
    state.pos.x = marker.x;
    state.pos.y = marker.y;
    
    const label = POINT_LABELS[index + 1] || { name: `Punto ${index + 1}`, emoji: '📍' };
    closeFixModal();
    drawAll();
    playSound('success');
    showTopToast(`Ubicación ajustada a ${label.emoji} ${label.name}. Usa con responsabilidad.`);
  }

  fixCloseBtn.addEventListener('click', closeFixModal);
  fixCancelBtn.addEventListener('click', closeFixModal);
  fixConfirmBtn.addEventListener('click', showLocationsList);
  fixModal.addEventListener('click', (e) => {
    if (e.target === fixModal) closeFixModal();
  });

  function startFixSequence(){
    if (overlay.style.display !== 'flex'){ showTopToast('Abre el mapa completo ("Mapa completo") para arreglar la ubicación.'); return; }
    openFixModal();
  }
  function stopFixMode(){ state.fixingMode = false; disableCanvasDragging(); }

  /* --------------- TASKS & START --------------- */
  function startWithTasks(){
    if (!state.radarOn){ showTopToast('El radar está apagado. Enciéndelo desde el panel admin para asignar/usar tareas.'); return; }
    const n = state.markers.length; const count = Math.min(5, n);
    const indices = [];
    while(indices.length < count){
      const r = Math.floor(Math.random()*n);
      if(!indices.includes(r)) indices.push(r);
    }
    state.chosenZones = indices;
    state.tasks = {};
    indices.forEach(i => state.tasks[i] = { taskId: Math.floor(Math.random()*6)+1, completed:false });
    showTopToast('Se han seleccionado 5 zonas con tareas. Muévete hasta una zona y pulsa "¡Hay una tarea aquí! Iniciar tarea".');
    playSound('note');
    drawAll();
  }

  function openTaskForZone(idx){
    if (!state.radarOn){ showTopToast('Radar apagado: no se pueden iniciar minijuegos.'); return; }
    if (!state.tasks[idx] || state.tasks[idx].completed) return;
    const taskId = state.tasks[idx].taskId || 1;
    openTaskModal(taskId, idx);
  }

  /* --------------- TASK MODAL & FINISH --------------- */
  let activeGameCleanup = null;
  function openTaskModal(gameId, markerIdx){
    if (!state.radarOn){ showTopToast('Radar apagado: no se pueden iniciar minijuegos.'); return; }
    taskTitle.textContent = `Tarea: ${POINT_LABELS[markerIdx+1]?.name || ('Punto '+(markerIdx+1))} — Minijuego ${gameId}`;
    taskContent.innerHTML = ''; taskModal.style.display = 'block';
    if (gameId === 1) runGame1(taskContent, (won)=> finishTask(markerIdx, won));
    if (gameId === 2) runGame2(taskContent, (won)=> finishTask(markerIdx, won));
    if (gameId === 3) runGame3(taskContent, (won)=> finishTask(markerIdx, won));
    if (gameId === 4) runGame4(taskContent, (won)=> finishTask(markerIdx, won));
    if (gameId === 5) runGame5(taskContent, (won)=> finishTask(markerIdx, won));
    if (gameId === 6) runGame6(taskContent, (won)=> finishTask(markerIdx, won));
  }
  function closeTaskModal(){ taskModal.style.display='none'; if (activeGameCleanup){ try{ activeGameCleanup(); }catch(e){} activeGameCleanup=null; } }
  function finishTask(markerIdx, won){
    closeTaskModal();
    if (won){
      if (!state.tasks[markerIdx]) state.tasks[markerIdx] = { taskId:1, completed:true };
      else state.tasks[markerIdx].completed = true;
      window.postMessage({ source:'ft-radar', type:'taskComplete', index: markerIdx }, '*');
      playSound('success');
      showTopToast('Tarea completada ✅');
    } else {
      playSound('fail');
      showTopToast('Has fallado la tarea ❌');
    }
    drawAll();

    const total = Object.keys(state.tasks||{}).length;
    const completed = Object.entries(state.tasks||{}).filter(([k,v])=>v && v.completed).map(([k])=>Number(k));
    if (total > 0 && completed.length >= total){
      window.postMessage({ source:'ft-radar', type:'allCompleted', total: total, completedIndexes: completed }, '*');
      showTopToast('Todas las tareas completadas 🎉');
    }
  }

  /* --------------- MINIJUEGO 1: Letras volantes --------------- */
  function runGame1(container, done){
    container.innerHTML = '';
    const area = document.createElement('div'); Object.assign(area.style,{position:'relative',height:'260px',borderRadius:'8px',overflow:'hidden',background:'#061018'});
    container.appendChild(area);
    const info = document.createElement('div'); info.style.color='#ddd'; info.style.margin='8px'; info.innerText='Presiona la letra que aparece dentro de los círculos. Si un círculo dura más de 5s pierdes.'; container.appendChild(info);
    const duration = 20000; const start = performance.now();
    const circles = []; let running = true; let spawnTimerId = null;

    state.inputBlocked = true;

    function spawnOnce(){
      if(!running) return;
      const sx = Math.random() * (area.clientWidth - 60) + 30;
      const sy = Math.random() * (area.clientHeight - 60) + 30;
      const allowedChars = 'BCEFGHIJKLMNOPQRTUVXYZ';
      const ch = allowedChars[Math.floor(Math.random() * allowedChars.length)];
      const el = document.createElement('div');
      Object.assign(el.style,{position:'absolute',left:(sx-22)+'px',top:(sy-10)+'px',minWidth:'44px',height:'44px',borderRadius:'22px',background:'#1f8a66',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:'800',fontSize:'18px'});
      const timeLabel = document.createElement('div'); Object.assign(timeLabel.style,{position:'absolute',left:'0',top:'-18px',width:'100%',textAlign:'center',color:'#fff',fontSize:'12px'});
      el.textContent = ch; el.appendChild(timeLabel); area.appendChild(el);
      const obj = { el, char:ch, created: performance.now(), label: timeLabel, lifespan: 5000 };
      circles.push(obj); playSound('note');
      setTimeout(()=>{ if(!running) return; const idx = circles.indexOf(obj); if (idx !== -1){ running=false; cleanup(); done(false); } }, obj.lifespan+50);
    }
    let spawnInterval = 1500;
    function spawnLoop(){ if(!running) return; spawnOnce(); const elapsed = performance.now()-start; const progress = clamp(elapsed/duration,0,1); spawnInterval = Math.max(400, Math.floor(1500 - progress*(1500-400))); spawnTimerId = setTimeout(spawnLoop, spawnInterval); }
    spawnLoop();
    function updateLoop(){ if(!running) return; const now = performance.now(); for(const c of circles){ const remaining = Math.max(0, Math.ceil((c.lifespan - (now - c.created))/1000)); c.label.textContent = remaining + 's'; } if (now - start >= duration){ running=false; cleanup(); done(true); return; } requestAnimationFrame(updateLoop); }
    updateLoop();
    function onKey(ev){
      const k = ev.key.toLowerCase();
      const movementKeys = new Set(['shift','arrowup','arrowdown','arrowleft','arrowright','w','a','s','d']);
      if (state.inputBlocked && movementKeys.has(k)) return;
      const K = ev.key.toUpperCase(); for(let i=0;i<circles.length;i++){ if(circles[i].char === K){ circles[i].el.remove(); circles.splice(i,1); playSound('click'); break; } }
    }
    document.addEventListener('keydown', onKey);
    function cleanup(){ running=false; state.inputBlocked = false; if(spawnTimerId) clearTimeout(spawnTimerId); document.removeEventListener('keydown', onKey); while(area.firstChild) area.removeChild(area.firstChild); }
    activeGameCleanup = cleanup;
  }

  /* --------------- MINIJUEGO 2: Operaciones matemáticas --------------- */
  function runGame2(container, done){
    container.innerHTML = '';
    const info = document.createElement('div'); info.style.color='#ddd'; info.style.marginBottom='10px'; info.textContent='Resuelve 3 operaciones. 8s por pregunta.'; container.appendChild(info);
    const box = document.createElement('div'); Object.assign(box.style,{display:'flex',flexDirection:'column',gap:'8px'}); container.appendChild(box);
    let qIndex=0; const total=3; let timerId=null; let timeLeftSec=8;

    const progressWrap = document.createElement('div'); Object.assign(progressWrap.style,{width:'100%',height:'8px',background:'rgba(255,255,255,0.06)',borderRadius:'6px',overflow:'hidden'});
    const progressBar = document.createElement('div'); Object.assign(progressBar.style,{height:'100%',width:'100%'}); progressWrap.appendChild(progressBar); box.appendChild(progressWrap);
    const timeText = document.createElement('div'); timeText.className='timeText'; box.appendChild(timeText);

    function shuffleArr(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

    function nextQ(){ qIndex++; if(qIndex>total){ if(timerId) clearInterval(timerId); done(true); return; }
      const ops=['+','-','*'];
      const op = ops[Math.floor(Math.random()*ops.length)];
      let a,b;
      if (op === '*'){
        a = Math.floor(Math.random()*9)+1; b = Math.floor(Math.random()*9)+1;
      } else {
        a = Math.floor(Math.random()*90)+1; b = Math.floor(Math.random()*90)+1;
      }
      const ans = (op==='+')? a+b : (op==='-'? a-b : a*b);

      box.innerHTML = '';
      box.appendChild(progressWrap);
      box.appendChild(timeText);
      const qText = document.createElement('div'); qText.style.color='#fff'; qText.style.fontSize='18px'; qText.textContent=`Pregunta ${qIndex}/${total}: ${a} ${op} ${b} = ?`; box.insertBefore(qText, progressWrap);

      const btnWrap = document.createElement('div'); Object.assign(btnWrap.style,{display:'flex',gap:'8px',marginTop:'8px',flexWrap:'wrap'}); box.insertBefore(btnWrap, progressWrap);

      const options = [ans, ans+1, ans-1];
      shuffleArr(options);

      options.forEach(opt => {
        const btn = document.createElement('button'); btn.className='im_btn'; btn.style.padding='10px 12px'; btn.textContent = String(opt);
        btnWrap.appendChild(btn);
        btn.onclick = () => {
          clearInterval(timerId);
          if (opt === ans) {
            playSound('click');
            nextQ();
          } else {
            done(false);
          }
        };
      });

      timeLeftSec = 8; progressBar.style.width = '100%';
      if (timerId) clearInterval(timerId);
      timerId = setInterval(()=> { timeLeftSec -= 0.1; if (timeLeftSec < 0) { clearInterval(timerId); done(false); } const pct = clamp(timeLeftSec/8,0,1)*100; progressBar.style.width = pct + '%'; timeText.textContent = `Tiempo: ${timeLeftSec.toFixed(1)}s`; }, 100);
    }
    nextQ();
    activeGameCleanup = ()=> { if(timerId) clearInterval(timerId); };
  }

  /* --------------- MINIJUEGO 3: Clicks rápidos --------------- */
  function runGame3(container, done){
    container.innerHTML = '';
    const target = Math.floor(Math.random()*21)+10; const totalTime = 7000;
    const info = document.createElement('div'); info.style.color='#ddd'; info.style.marginBottom='8px';
    info.innerHTML = `Haz clic en el botón <strong>${target}</strong> veces en ${totalTime/1000} segundos.`; container.appendChild(info);
    const btn = document.createElement('button'); btn.className='im_btn'; btn.style.fontSize='18px';
    Object.assign(btn.style,{width:'96px',height:'96px',borderRadius:'48px',background:'#16a34a',color:'#04210b',fontWeight:'900',display:'block',margin:'12px auto',border:'none'});
    btn.textContent=`Click (${target})`; container.appendChild(btn);
    const progressWrap = document.createElement('div'); Object.assign(progressWrap.style,{width:'100%',height:'8px',background:'rgba(255,255,255,0.06)',borderRadius:'6px',overflow:'hidden'});
    const progressBar = document.createElement('div'); Object.assign(progressBar.style,{height:'100%',width:'100%'}); progressWrap.appendChild(progressBar); container.appendChild(progressWrap);
    const timeText = document.createElement('div'); timeText.className='timeText'; container.appendChild(timeText);
    let remaining = target; let start = performance.now();
    timeText.textContent = `Tiempo: ${(totalTime/1000).toFixed(1)}s`;
    const interval = setInterval(()=> { const elapsed = performance.now()-start; const tleft = Math.max(0, totalTime - elapsed); const pct = clamp(tleft/totalTime,0,1)*100; progressBar.style.width = pct+'%'; timeText.textContent = `Tiempo: ${(tleft/1000).toFixed(2)}s`; if(tleft<=0){ clearInterval(interval); done(false); } }, 60);
    btn.onclick = ()=> { remaining--; btn.textContent = `Click (${remaining})`; playSound('click'); btn.style.transform='scale(0.96)'; setTimeout(()=> btn.style.transform = '', 110); if(remaining<=0){ clearInterval(interval); done(true); } };
    activeGameCleanup = ()=> clearInterval(interval);
  }

  /* --------------- MINIJUEGO 4: Simon --------------- */
  function runGame4(container, done){
    container.innerHTML = '';
    const areaWrap = document.createElement('div'); areaWrap.style.display='flex'; areaWrap.style.justifyContent='center'; areaWrap.style.marginTop='6px';
    container.appendChild(areaWrap);
    const big = document.createElement('div'); Object.assign(big.style,{width:'300px',height:'300px',display:'grid',gridTemplateColumns:'1fr 1fr',gridTemplateRows:'1fr 1fr',gap:'6px',background:'#07161a',borderRadius:'10px',padding:'6px',boxSizing:'border-box'});
    areaWrap.appendChild(big);
    const colors = ['#ef4444','#10b981','#3b82f6','#f59e0b'];
    const panels = [];
    for (let i=0;i<4;i++){ const p = document.createElement('div'); Object.assign(p.style,{background: darken(colors[i],0.45), borderRadius:'6px', display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',transition:'filter 160ms'}); big.appendChild(p); panels.push(p); }
    const centerCircle = document.createElement('div'); Object.assign(centerCircle.style,{position:'absolute',width:'120px',height:'120px',borderRadius:'60px',left:'50%',top:'50%',transform:'translate(-50%,-50%)',background:'#0b0f12',border:'4px solid rgba(255,255,255,0.06)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:'800',fontSize:'20px'});
    const bigContainer = document.createElement('div'); bigContainer.style.position='relative'; bigContainer.appendChild(big); bigContainer.appendChild(centerCircle);
    areaWrap.innerHTML=''; areaWrap.appendChild(bigContainer);
    const msg = document.createElement('div'); msg.style.marginTop='10px'; msg.style.color='#dbeafe'; msg.style.textAlign='center'; container.appendChild(msg);

    function flashCenter(color,time=450){ centerCircle.style.background=color; centerCircle.style.boxShadow = `0 6px 24px ${hexToRgba(color,0.35)}`; setTimeout(()=>{ centerCircle.style.background='#0b0f12'; centerCircle.style.boxShadow='none'; }, time); playTone(880,0.09); }

    let running = true;
    let overallTimeout = null;
    let listeners = [];

    const rounds = [2,3,4,5]; let roundIdx = 0;

    function cleanupAll(){
      running = false;
      if (overallTimeout) { clearTimeout(overallTimeout); overallTimeout = null; }
      listeners.forEach((fn, idx) => {
        try{ panels[idx].removeEventListener('click', fn); }catch(e){}
      });
      listeners = [];
    }
    activeGameCleanup = cleanupAll;

    function playRound(){ if (!running) return; if (roundIdx >= rounds.length){ cleanupAll(); done(true); return; } const len = rounds[roundIdx]; const seq = []; for (let j=0;j<len;j++) seq.push(Math.floor(Math.random()*4)); msg.textContent='Observa la secuencia...'; let i=0;
      function showNext(){ if(!running) return; if (i >= seq.length){ msg.textContent='Repite la secuencia'; acceptInput(seq); return; } const idx = seq[i]; const color = colors[idx]; flashCenter(color,420); panels[idx].style.filter='brightness(1.6)'; setTimeout(()=>{ panels[idx].style.filter=''; i++; setTimeout(showNext,320); },520); }
      setTimeout(showNext,380);
    }

    function acceptInput(seq){
      if(!running) return;
      let pos=0; msg.textContent='Repite la secuencia';
      function onClick(ev){
        if(!running) return;
        const idx = panels.indexOf(ev.currentTarget);
        panels[idx].style.filter='brightness(1.6)';
        setTimeout(()=>panels[idx].style.filter='',220);
        flashCenter(colors[idx],200);
        if (idx === seq[pos]){ pos++; if (pos>=seq.length){
            listeners.forEach((fn, idx2)=>{ try{ panels[idx2].removeEventListener('click', fn); }catch(e){} });
            listeners = [];
            roundIdx++; setTimeout(()=>playRound(),420);
          }
        } else {
          listeners.forEach((fn, idx2)=>{ try{ panels[idx2].removeEventListener('click', fn); }catch(e){} });
          listeners = [];
          cleanupAll();
          done(false);
        }
      }
      for(let p=0;p<panels.length;p++){ panels[p].addEventListener('click', onClick); listeners[p] = onClick; }

      overallTimeout = setTimeout(()=>{ if(!running) return; listeners.forEach((fn, idx)=>{ try{ panels[idx].removeEventListener('click', fn); }catch(e){} }); listeners = []; running = false; done(false); }, 30000);
    }

    playRound();
  }

  function hexToRgba(hex,a=1){ const c=hex.replace('#',''); const r=parseInt(c.substring(0,2),16), g=parseInt(c.substring(2,4),16), b=parseInt(c.substring(4,6),16); return `rgba(${r},${g},${b},${a})`; }
  function darken(hex, amt=0.3){ const c=hex.replace('#',''); let r=parseInt(c.substring(0,2),16), g=parseInt(c.substring(2,4),16), b=parseInt(c.substring(4,6),16); r=Math.max(0,Math.floor(r*(1-amt))); g=Math.max(0,Math.floor(g*(1-amt))); b=Math.max(0,Math.floor(b*(1-amt))); return `rgb(${r},${g},${b})`; }

  /* --------------- MINIJUEGO 5: Mantén el punto --------------- */
  function runGame5(container, done){
    container.innerHTML=''; const title=document.createElement('div'); title.style.color='#dfe'; title.textContent='Minijuego 5 — Mantén el punto (sigue y mantén)'; container.appendChild(title);
    const cvs=document.createElement('canvas'); cvs.width=480; cvs.height=300; Object.assign(cvs.style,{width:'480px',height:'300px',display:'block',margin:'8px auto',borderRadius:'8px',background:'#081517'}); container.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    const info = document.createElement('div'); info.style.color='#cfe'; info.textContent = 'Sigue el punto y mantén el cursor sobre él hasta llenar la barra (3s acumulados).'; container.appendChild(info);

    let running = true;
    const target = { x:cvs.width/2, y:cvs.height/2, r:12 };
    let lastTs = performance.now();
    let holdAccum = 0;
    let mousePos = {x:-1,y:-1};
    const required = 3000;

    function updatePos(now){
      const t = (now/800) + Math.random()*0.0001;
      target.x = cvs.width/2 + Math.cos(t*1.2) * 140 * Math.cos(now/1400);
      target.y = cvs.height/2 + Math.sin(t*1.4) * 70 * Math.sin(now/1100);
    }
    function draw(){
      ctx.clearRect(0,0,cvs.width,cvs.height);
      ctx.beginPath(); ctx.arc(target.x, target.y, target.r, 0, Math.PI*2); ctx.fillStyle = '#7ff1b3'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 2; ctx.stroke();
      const pct = Math.min(1, holdAccum/required);
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(30, cvs.height-30, cvs.width-60, 12);
      ctx.fillStyle = '#7ff1b3'; ctx.fillRect(30, cvs.height-30, (cvs.width-60)*pct, 12);
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.strokeRect(30, cvs.height-30, cvs.width-60, 12);
      ctx.fillStyle='#dff'; ctx.font='bold 12px sans-serif'; ctx.textAlign='center'; ctx.fillText(`Progreso: ${(pct*100).toFixed(0)}%`, cvs.width/2, cvs.height-36);
    }

    function loop(now){
      if(!running) return;
      updatePos(now);
      const dt = Math.max(0, now - lastTs);
      lastTs = now;
      const dx = mousePos.x - target.x, dy = mousePos.y - target.y;
      const d = Math.hypot(dx,dy);
      if (d <= target.r + 8 && mousePos.x >= 0){
        holdAccum += dt;
      } else {
        holdAccum = Math.max(0, holdAccum - dt*0.6);
      }
      draw();
      if (holdAccum >= required){ running=false; done(true); return; }
      requestAnimationFrame(loop);
    }

    function onMove(e){
      const rect = cvs.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      mousePos.x = x * (cvs.width/rect.width);
      mousePos.y = y * (cvs.height/rect.height);
    }
    function onLeave(){ mousePos.x = -1; mousePos.y = -1; }
    cvs.addEventListener('mousemove', onMove);
    cvs.addEventListener('touchmove', onMove, {passive:false});
    cvs.addEventListener('mouseleave', onLeave);
    cvs.addEventListener('touchend', onLeave);
    lastTs = performance.now();
    requestAnimationFrame(loop);
    activeGameCleanup = ()=> { running=false; cvs.removeEventListener('mousemove', onMove); cvs.removeEventListener('touchmove', onMove); };
  }

  /* --------------- MINIJUEGO 6: Rompecabezas 3x3 --------------- */
  function runGame6(container, done){
    container.innerHTML=''; const title=document.createElement('div'); title.style.color='#dfe'; title.textContent='Minijuego 6 — Rompecabezas 3x3 (25s)'; container.appendChild(title);
    const size=300; const cvs=document.createElement('canvas'); cvs.width=size; cvs.height=size; Object.assign(cvs.style,{width:size+'px',height:size+'px',display:'block',margin:'10px auto',borderRadius:'8px'}); container.appendChild(cvs);
    const ctx=cvs.getContext('2d');
    const timerEl=document.createElement('div'); timerEl.style.color='#cfe'; container.appendChild(timerEl);

    const N = 3;
    const tiles = [];
    for(let r=0;r<N;r++) for(let c=0;c<N;c++) tiles.push({ correct: r*N + c, current: r*N + c });
    function shuffle(){ const arr = tiles.map(t=>t.correct); for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]];} arr.forEach((v,idx)=>tiles[idx].current=v); if(tiles.every((t,idx)=>t.current===t.correct)) shuffle(); }
    shuffle();
    let selected = null;
    function draw(){
      const tw = cvs.width/N, th = cvs.height/N; ctx.clearRect(0,0,cvs.width,cvs.height);
      for(let i=0;i<tiles.length;i++){
        const row=Math.floor(i/N), col=i%N; const x=col*tw, y=row*th;
        ctx.fillStyle='#0f1a1b'; ctx.fillRect(x+6,y+6,tw-12,th-12);
        ctx.fillStyle='#fff'; ctx.font='bold '+(tw/3.4)+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(String(tiles[i].current+1), x+tw/2, y+th/2+4);
        if(selected === i){
          ctx.strokeStyle='rgba(120,240,170,0.95)'; ctx.lineWidth=4; ctx.strokeRect(x+8,y+8,tw-16,th-16);
        }
      }
    }

    function idxAt(px,py){
      const rect=cvs.getBoundingClientRect();
      const rx=(px-rect.left)*(cvs.width/rect.width), ry=(py-rect.top)*(cvs.height/rect.height);
      const col=Math.floor(rx/(cvs.width/N)), row=Math.floor(ry/(cvs.height/N));
      if(row<0||row>=N||col<0||col>=N) return null;
      return row*N + col;
    }
    function clickHandler(e){ const idx=idxAt(e.clientX,e.clientY); if(idx===null) return;
      if(selected===null){ selected = idx; draw(); return; }
      if(selected===idx){ selected=null; draw(); return; }
      const temp = tiles[selected].current; tiles[selected].current = tiles[idx].current; tiles[idx].current = temp;
      selected = null; draw();
      if(tiles.every((t,idx)=>t.current===t.correct)){ cleanup(); done(true); }
    }
    cvs.addEventListener('click', clickHandler);

    draw();
    const timeLimit = 25*1000; const start=performance.now();
    const iv=setInterval(()=>{ const left = Math.max(0, timeLimit - (performance.now()-start)); timerEl.textContent = `Tiempo restante: ${(left/1000).toFixed(1)}s`; if(left<=0){ clearInterval(iv); cleanup(); done(false);} }, 120);
    activeGameCleanup = ()=> { clearInterval(iv); cvs.removeEventListener('click', clickHandler); };

    function cleanup(){ clearInterval(iv); }
  }

  /* --------------- GAMES LIST --------------- */
  const games = [
    {id:1, name:'Letras volantes', fn: runGame1},
    {id:2, name:'Operaciones', fn: runGame2},
    {id:3, name:'Clicks rápidos', fn: runGame3},
    {id:4, name:'Simon', fn: runGame4},
    {id:5, name:'Mantén el punto', fn: runGame5},
    {id:6, name:'Rompecabezas 3x3', fn: runGame6}
  ];

  /* --------------- LOOP / MOVEMENT --------------- */
  function startLoop(){ if (state.started) return; state.started = true; state.lastFrame = performance.now(); requestAnimationFrame(loop); }
  function loop(now){
    if (!state.started) return;
    const dt = (now - state.lastFrame)/1000; state.lastFrame = now;

    if (state.radarOn && !state.fixingMode){
      let vx=0, vy=0;
      if (state.keys.left) vx -=1; if (state.keys.right) vx +=1; if (state.keys.up) vy -=1; if (state.keys.down) vy +=1;
      if (vx !== 0 || vy !== 0){
        const mag = Math.sqrt(vx*vx + vy*vy);
        vx /= mag; vy /= mag;
        const speed = state.running ? state.runSpeed : state.walkSpeed;
        state.pos.x = clamp(state.pos.x + vx * speed * dt, 0, 1);
        state.pos.y = clamp(state.pos.y + vy * speed * dt, 0, 1);
        const ang = Math.atan2(-vy, vx) * 180 / Math.PI;
        state.moveAngle = (ang + 360) % 360;
        state.isMoving = true;
      } else {
        state.isMoving = false;
      }
    } else {
      state.isMoving = false;
    }

    if (panel.style.display !== 'none') requestAnimationFrame(ts => drawPreview(ts || performance.now()));
    if (overlay.style.display === 'flex') drawFull();
    updateProximityUI();

    window.postMessage({
      source: 'radar-admin',
      type: 'positionUpdate',
      position: { x: state.pos.x, y: state.pos.y }
    }, '*');

    requestAnimationFrame(loop);
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const movementKeys = new Set(['shift','arrowup','arrowdown','arrowleft','arrowright','w','a','s','d']);
    if (state.inputBlocked && movementKeys.has(k)) {
      return;
    }
    // Block shift when sprint is exhausted
    if (k === 'shift' && state.sprintBlocked) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (k === 'shift') state.running = true;
    if (k === 'arrowup' || k==='w') state.keys.up = true;
    if (k === 'arrowdown' || k==='s') state.keys.down = true;
    if (k === 'arrowleft' || k==='a') state.keys.left = true;
    if (k === 'arrowright' || k==='d') state.keys.right = true;
    if (!state.started) startLoop();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    const movementKeys = new Set(['shift','arrowup','arrowdown','arrowleft','arrowright','w','a','s','d']);
    if (state.inputBlocked && movementKeys.has(k)) {
      return;
    }
    if (k === 'shift') state.running = false;
    if (k === 'arrowup' || k==='w') state.keys.up = false;
    if (k === 'arrowdown' || k==='s') state.keys.down = false;
    if (k === 'arrowleft' || k==='a') state.keys.left = false;
    if (k === 'arrowright' || k==='d') state.keys.right = false;
  });

  /* --------------- PANEL show/hide & drag --------------- */
  function showPanel(){ panel.style.display='block'; resizePreview(); drawPreview(); }
  function hidePanel(){ panel.style.display='none'; }
  toggle.addEventListener('click', ()=> { if (panel.style.display === 'none' || panel.style.display === '') showPanel(); else hidePanel(); });
  hideBtn.addEventListener('click', hidePanel);

  (function(){
    const hdr = panel.querySelector('#im_header'); let dragging=false, sx=0, sy=0, ox=0, oy=0;
    hdr.addEventListener('pointerdown', e => { dragging=true; sx=e.clientX; sy=e.clientY; const r=panel.getBoundingClientRect(); ox = r.left; oy = r.top; hdr.setPointerCapture && hdr.setPointerCapture(e.pointerId); hdr.style.cursor='grabbing'; });
    window.addEventListener('pointermove', e => { if(!dragging) return; panel.style.left = (ox + (e.clientX - sx)) + 'px'; panel.style.top = (oy + (e.clientY - sy)) + 'px'; panel.style.right = 'auto'; });
    window.addEventListener('pointerup', e => { if(!dragging) return; dragging=false; hdr.style.cursor='grab'; try{ hdr.releasePointerCapture && hdr.releasePointerCapture(e.pointerId); }catch(e){} });
  })();

  /* --------------- FULL MAP open/close + tooltip --------------- */
  openFullBtn.addEventListener('click', ()=> {
    fitFullCanvasToInner(); overlay.style.display = 'flex'; drawFull();
  });
  closeFullBtn.addEventListener('click', ()=> {
    overlay.style.display = 'none'; tooltip.style.display='none';
    if (state.fixingMode) stopFixMode();
    state.inputBlocked = false;
  });
  fullCanvas.addEventListener('mousemove', fullCanvasMouseMove);
  fullCanvas.addEventListener('mouseleave', ()=> tooltip.style.display='none');

  /* --------------- Admin Control (postMessage + API) --------------- */
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.source === 'radar-admin'){
      if (d.type === 'setRadar'){ if (typeof IM_zoneUI !== 'undefined' && IM_zoneUI && typeof IM_zoneUI.setRadarOn === 'function') IM_zoneUI.setRadarOn(!!d.on); }
      if (d.type === 'setTasks' && Array.isArray(d.tasks)){ if (typeof IM_zoneUI !== 'undefined' && IM_zoneUI && typeof IM_zoneUI.setTasks === 'function') IM_zoneUI.setTasks(d.tasks); }
      if (d.type === 'taskUpdate' && typeof d.index === 'number'){ if (typeof IM_zoneUI !== 'undefined' && IM_zoneUI && typeof IM_zoneUI.setTaskUpdated === 'function') IM_zoneUI.setTaskUpdated(d.index, d.update || {}); }
      if (d.type === 'serverStatus'){ if (d.status === 'down'){ if (typeof IM_zoneUI !== 'undefined' && IM_zoneUI && typeof IM_zoneUI.setRadarOn === 'function') IM_zoneUI.setRadarOn(false); showTopToast('Servidor desconectado — radar apagado.'); } }
      
      if (d.type === 'barricadeCreated' && d.barricade) {
        state.barricades.push(d.barricade);
      }
      if (d.type === 'barricadeUpdate' && d.barricadeId) {
        const b = state.barricades.find(b => b.id === d.barricadeId);
        if (b) {
          b.health = d.health;
          if (d.maxHealth) b.maxHealth = d.maxHealth;
        }
      }
      if (d.type === 'barricadeDestroyed' && d.barricadeId) {
        state.barricades = state.barricades.filter(b => b.id !== d.barricadeId);
      }
      if (d.type === 'syncBarricades' && Array.isArray(d.barricades)) {
        state.barricades = d.barricades;
      }
      
      if (d.type === 'trackPlayer' && d.name) {
        if (!state.trackedPlayers) state.trackedPlayers = [];
        const existing = state.trackedPlayers.find(p => p.name === d.name);
        if (!existing) {
          state.trackedPlayers.push({ name: d.name, role: d.role || '?', position: d.position || null });
        }
      }
      if (d.type === 'updateTrackedPlayerPosition' && d.name) {
        const player = state.trackedPlayers.find(p => p.name === d.name);
        if (player) {
          player.position = d.position;
        }
      }
      if (d.type === 'syncCoins' && Array.isArray(d.coins)) {
        state.coins = d.coins;
      }
      if (d.type === 'setSprintBlocked') {
        state.sprintBlocked = !!d.blocked;
        if (state.sprintBlocked) {
          state.running = false; // Stop running immediately when blocked
        }
      }
    }
    if (d.t === 'radarState'){
      if (typeof IM_zoneUI !== 'undefined' && IM_zoneUI && typeof IM_zoneUI.setRadarOn === 'function') IM_zoneUI.setRadarOn(!!d.on);
      if (Array.isArray(d.tasks) && typeof IM_zoneUI !== 'undefined' && IM_zoneUI && typeof IM_zoneUI.setTasks === 'function') IM_zoneUI.setTasks(d.tasks);
    }
    if (d.t === 'taskUpdated' && typeof d.index === 'number'){
      if (typeof IM_zoneUI !== 'undefined' && IM_zoneUI && typeof IM_zoneUI.setTaskUpdated === 'function') IM_zoneUI.setTaskUpdated(d.index, d.update || {});
    }
    if (d.type === 'FLEE_RADAR_UPDATE') {
      if (d.position) state.pos = d.position;
      if (d.coins) state.coins = d.coins;
      if (d.barricades) state.barricades = d.barricades;
      if (d.investigatedPlayers) state.investigatedPlayers = d.investigatedPlayers;
      if (d.trackedPlayers) state.trackedPlayers = d.trackedPlayers;
    }
  });

  window.IM_zoneUI = {
    state,
    setNearThreshold: (v)=>{ NEAR_THRESHOLD = Number(v); console.log('NEAR_THRESHOLD=', NEAR_THRESHOLD); },
    setSound: (b)=>{ SOUND_ENABLED = !!b; console.log('SOUND_ENABLED=', SOUND_ENABLED); },
    setRadarOn: (on) => { console.log('[IM_zoneUI] setRadarOn called before init: ', !!on); state.radarOn = !!on; drawAll(); },
    setTasks: (tasksArr) => { console.log('[IM_zoneUI] setTasks placeholder'); },
    setTaskUpdated: (idx, update) => { console.log('[IM_zoneUI] setTaskUpdated placeholder', idx, update); },
    forceComplete: (i)=>{ if (state.tasks[i]) state.tasks[i].completed = true; drawAll(); },
    chosenZones: ()=> state.chosenZones.slice(),
    tasksObj: ()=> JSON.parse(JSON.stringify(state.tasks)),
    openTaskFor: (i)=> openTaskForZone(i)
  };

  IM_zoneUI.setRadarOn = function(on){
    const newState = !!on;
    if (state.radarOn === newState) {
      return;
    }
    state.radarOn = newState;
    if (state.radarOn){
      if (!state.started) startLoop();
      showPanel();
      showTopToast('Radar encendido');
    } else {
      state.pos.x = 1; state.pos.y = 1;
      hidePanel();
      startTaskBtn.style.display = 'none';
      showTopToast('Radar apagado');
    }
    drawAll();
    console.log('[IM] radar toggled ->', state.radarOn);
  };

  IM_zoneUI.setTasks = function(tasksArr){
    state.tasks = {};
    if (Array.isArray(tasksArr)){
      tasksArr.forEach(t => { if (typeof t.index === 'number') state.tasks[t.index] = { taskId: t.taskId || 1, completed: !!t.completed }; });
    } else if (typeof tasksArr === 'object' && tasksArr !== null){
      Object.keys(tasksArr).forEach(k => { const idx = Number(k); if (!isNaN(idx)) state.tasks[idx] = { taskId: tasksArr[k].taskId || 1, completed: !!tasksArr[k].completed }; });
    }
    drawAll();
    console.log('[IM] tasks set', state.tasks);
  };

  IM_zoneUI.setTaskUpdated = function(idx, update){
    if (typeof idx !== 'number') return;
    if (!state.tasks[idx]) state.tasks[idx] = { taskId: update.taskId || 1, completed: !!update.completed };
    else { if (typeof update.completed !== 'undefined') state.tasks[idx].completed = !!update.completed; if (typeof update.taskId !== 'undefined') state.tasks[idx].taskId = update.taskId; }
    drawAll();
    console.log('[IM] task updated', idx, state.tasks[idx]);
  };

  function drawAll(){
    if (panel.style.display !== 'none') drawPreview();
    if (overlay.style.display === 'flex') drawFull();
    updateProximityUI();
  }

  /* --------------- Top toast --------------- */
  let toastTimer = null;
  function showTopToast(txt, duration = 3000){
    topToast.textContent = txt;
    topToast.style.display = 'flex';
    topToast.style.opacity = '1';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>{ topToast.style.opacity = '0'; setTimeout(()=> topToast.style.display = 'none', 300); }, duration);
  }

  /* --------------- Hooks & start --------------- */
  taskCancel.addEventListener('click', ()=> closeTaskModal());
  fixBtn.addEventListener('click', startFixSequence);

  function fitFullCanvasToInner(){
    const inner = document.getElementById('im_fullInner');
    if (!inner) return;
    const rect = inner.getBoundingClientRect();
    fullCanvas.width = Math.max(300, Math.floor(rect.width * (window.devicePixelRatio || 1)));
    fullCanvas.height = Math.max(200, Math.floor((rect.height - 40) * (window.devicePixelRatio || 1)));
    fullCanvas.style.width = (rect.width)+'px';
    fullCanvas.style.height = (rect.height - 40) +'px';
  }
  window.addEventListener('resize', ()=> { fitFullCanvasToInner(); drawAll(); });
  openFullBtn.addEventListener('click', ()=> { fitFullCanvasToInner(); overlay.style.display = 'flex'; drawFull(); });

  drawAll();
  console.log('[Radar de Tareas] v2.4.3 cargado (actualizado).');
  window.IM_startIslandTasks = startWithTasks;

  /* --------------- WS helper (viewer) --------------- */
  (function(){
    const WS_URL = 'wss://c639f4ab-74f4-4449-bf27-82314c36e709-00-2rc8n3devv9uo.janeway.replit.dev/';
    const GAME_ID = 'pony-event-1';
    const NAME = '';

    let ws = null;
    function connect(){
      try { ws = new WebSocket(WS_URL); } catch(e){ console.warn('[viewer-ws] ctor failed', e); setTimeout(connect,1500); return; }
      ws.addEventListener('open', () => {
        console.log('[viewer-ws] open, registering as viewer');
        ws.send(JSON.stringify({ t: 'register', gameId: GAME_ID, name: NAME, clientType: 'viewer' }));
        setTimeout(()=> wsSend({ t: 'requestRadarState', gameId: GAME_ID }), 200);
        setTimeout(()=> wsSend({ t: 'requestRadarState', gameId: GAME_ID }), 800);
      });
      ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch(e){ return; }
        if (msg.t === 'radarState' || msg.t === 'taskUpdated' || msg.t === 'state') {
          window.postMessage(Object.assign({ source:'radar-admin' }, msg), '*');
        }
        if (msg.t === 'taskUpdated' && msg.gameId === GAME_ID) {
          setTimeout(()=> wsSend({ t: 'requestRadarState', gameId: GAME_ID }), 60);
          setTimeout(()=> wsSend({ t: 'requestRadarState', gameId: GAME_ID }), 420);
        }
      });
      ws.addEventListener('close', () => { console.warn('[viewer-ws] closed, reconnect in 1s'); setTimeout(connect,1000); });
      ws.addEventListener('error', (e) => { console.error('[viewer-ws] error', e); try{ ws.close(); }catch(e){} });
    }
    function wsSend(o){ try { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); } catch(e){ } }

    window.addEventListener('message', (ev) => {
      if (!ev.data || ev.data.source !== 'radar-admin') return;
      const d = ev.data;
      if (typeof window.IM_zoneUI !== 'undefined' && window.IM_zoneUI && typeof window.IM_zoneUI.setRadarOn === 'function'){
        if (d.t === 'radarState') {
          window.IM_zoneUI.setRadarOn(!!d.on);
          if (Array.isArray(d.tasks)) window.IM_zoneUI.setTasks(d.tasks);
        }
        if (d.t === 'taskUpdated' && typeof d.index === 'number') {
          window.IM_zoneUI.setTaskUpdated(d.index, { completed: true, completedBy: d.completedBy });
        }
      }
    }, false);

    window.addEventListener('message', (ev) => {
      if (!ev.data || ev.data.source !== 'ft-radar') return;
      const d = ev.data;
      try {
        if (d.type === 'taskComplete' && typeof d.index === 'number'){
          wsSend({ t: 'taskCompleted', gameId: GAME_ID, index: d.index });
        } else if (d.type === 'allCompleted'){
          wsSend({ t: 'allTasksCompleted', gameId: GAME_ID, completedIndexes: d.completedIndexes || [] });
        }
      } catch(e){ }
    }, false);

    window.addEventListener('message', (ev) => {
      if (!ev.data || ev.data.source !== 'radar-admin') return;
      const d = ev.data;
      if (typeof window.IM_zoneUI !== 'undefined' && window.IM_zoneUI && typeof window.IM_zoneUI.setRadarOn === 'function'){
        if (d.t === 'radarState') {
          window.IM_zoneUI.setRadarOn(!!d.on);
          if (Array.isArray(d.tasks)) window.IM_zoneUI.setTasks(d.tasks);
        }
        if (d.t === 'taskUpdated' && typeof d.index === 'number') {
          window.IM_zoneUI.setTaskUpdated(d.index, { completed: true, completedBy: d.completedBy });
        }
      }
    }, false);

    connect();
  })();

})();
