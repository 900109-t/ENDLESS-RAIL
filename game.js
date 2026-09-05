'use strict';
/* =========================================================
   TRAIN FRONTIER — game.js
   Constants / State / Renderer / Input / Game Loop / Train / Cars /
   Weapons / Enemies / Bosses / Waves / Events / Roguelike Map /
   Tutorial / API Client / Auth UI / Friends UI / Leaderboard UI /
   Profile UI / Menu / Initialization
   ========================================================= */

// =========================================================
// Constants
// =========================================================
const API = '';

const CAR_TYPES = {
  mg:      { id: 'mg',      name: '기관총 객차', icon: '🔫', kind: 'weapon', weaponKind: 'mg',      baseCost: 40,  desc: '빠른 연사' },
  cannon:  { id: 'cannon',  name: '포병 객차',   icon: '💥', kind: 'weapon', weaponKind: 'cannon',  baseCost: 70,  desc: '강력한 단발' },
  chain:   { id: 'chain',   name: '체인건 객차', icon: '⚡', kind: 'weapon', weaponKind: 'chain',   baseCost: 90,  desc: '연쇄 공격' },
  flame:   { id: 'flame',   name: '화염 객차',   icon: '🔥', kind: 'weapon', weaponKind: 'flame',   baseCost: 80,  desc: '지속 피해' },
  power:   { id: 'power',   name: '발전 객차',   icon: '🔋', kind: 'support', desc: 'Energy 생산' },
  repair:  { id: 'repair',  name: '수리 객차',   icon: '🛠️', kind: 'support', desc: 'HP 서서히 회복' },
  supply:  { id: 'supply',  name: '보급 객차',   icon: '📦', kind: 'support', desc: '자원 저장량 증가' },
  armor:   { id: 'armor',   name: '방어 객차',   icon: '🛡️', kind: 'support', desc: '열차 방어력 강화' }
};

const ENEMY_TYPES = {
  runner:  { name: 'Runner',  hp: 18,  spd: 2.2, dmg: 4,  range: 0,  color: '#c0392b', score: 10 },
  tank:    { name: 'Tank',    hp: 70,  spd: 0.9, dmg: 10, range: 0,  color: '#7f8c8d', score: 25 },
  swarm:   { name: 'Swarm',   hp: 8,   spd: 2.6, dmg: 2,  range: 0,  color: '#e67e22', score: 6  },
  bomber:  { name: 'Bomber',  hp: 24,  spd: 1.6, dmg: 18, range: 0,  color: '#e74c3c', score: 20 },
  shield:  { name: 'Shield',  hp: 40,  spd: 1.1, dmg: 6,  range: 0,  color: '#34495e', score: 22, shielded: true },
  sniper:  { name: 'Sniper',  hp: 20,  spd: 1.0, dmg: 14, range: 220, color: '#8e44ad', score: 24 },
  mechanic:{ name: 'Mechanic',hp: 30,  spd: 1.3, dmg: 5,  range: 0,  color: '#16a085', score: 26, healer: true },
  flyer:   { name: 'Flyer',   hp: 16,  spd: 2.0, dmg: 7,  range: 0,  color: '#2980b9', score: 18, flying: true },
  crusher: { name: 'Crusher', hp: 110, spd: 0.7, dmg: 22, range: 0,  color: '#d35400', score: 40 }
};

const BOSS_TYPES = {
  iron_worm:    { name: 'IRON WORM',    hp: 1400, spd: 0.6, dmg: 30, color: '#a0522d', score: 500 },
  death_engine: { name: 'DEATH ENGINE', hp: 1800, spd: 0.8, dmg: 26, color: '#5b2c6f', score: 650 },
  sky_hunter:   { name: 'SKY HUNTER',   hp: 1000, spd: 1.4, dmg: 20, color: '#1f6fb2', score: 550, flying: true }
};
const BOSS_ORDER = ['iron_worm', 'death_engine', 'sky_hunter'];

const RANDOM_EVENTS = [
  { id: 'abandoned_car', title: '버려진 객차', text: '버려진 객차를 발견했다. 무료로 연결하시겠습니까?', apply: (s) => { addFreeCar(s); } },
  { id: 'merchant_train', title: '상인 열차', text: '떠돌이 상인이 물건을 판다. Scrap 40을 소모해 Energy 60을 얻는다.', apply: (s) => { if (s.resources.scrap >= 40) { s.resources.scrap -= 40; s.resources.energy += 60; } } },
  { id: 'fuel_shortage', title: '연료 부족', text: '연료가 새고 있다! Fuel -15', apply: (s) => { s.resources.fuel = Math.max(0, s.resources.fuel - 15); } },
  { id: 'rescue_call', title: '구조 요청', text: '생존자를 구조했다. 승무원 보너스로 Core +1', apply: (s) => { s.resources.core += 1; } },
  { id: 'rail_collapse', title: '철도 붕괴', text: '선로가 무너져 우회한다. 열차 HP -10', apply: (s) => { s.train.hp = Math.max(1, s.train.hp - 10); } },
  { id: 'ambush', title: '적 매복', text: '매복이다! 소규모 적 무리가 즉시 공격한다.', apply: (s) => { spawnAmbush(s); } },
  { id: 'treasure_train', title: '보물 열차', text: '버려진 화물 열차에서 자원을 회수했다. Scrap +80', apply: (s) => { s.resources.scrap += 80; } },
  { id: 'repair_facility', title: '수리 시설', text: '임시 수리 시설을 발견했다. 열차 HP 전체 회복', apply: (s) => { s.train.hp = s.train.maxHp; } },
  { id: 'dangerous_shortcut', title: '위험한 지름길', text: '위험하지만 빠른 지름길. Fuel +20, HP -15', apply: (s) => { s.resources.fuel += 20; s.train.hp = Math.max(1, s.train.hp - 15); } },
  { id: 'abandoned_station', title: '폐역 조사', text: '폐역을 조사해 부품을 회수했다. Energy +30', apply: (s) => { s.resources.energy += 30; } }
];

const SKILLS = {
  repair:   { id: 'repair',   name: '긴급 수리', cost: 30, cooldown: 20, icon: '🩹', desc: '열차 HP 25% 즉시 회복' },
  overload: { id: 'overload', name: '과충전',   cost: 25, cooldown: 25, icon: '⚡', desc: '10초간 모든 무기 공격속도 2배' },
  brake:    { id: 'brake',    name: '긴급 제동', cost: 20, cooldown: 22, icon: '🛑', desc: '모든 적 속도 3초간 50% 감소' },
  barrage:  { id: 'barrage',  name: '포격 지원', cost: 35, cooldown: 30, icon: '☄️', desc: '전방 적에게 즉시 큰 피해' },
  shield:   { id: 'shield',   name: '보호막',   cost: 40, cooldown: 35, icon: '🛡️', desc: '8초간 받는 피해 50% 감소' }
};

const TUTORIAL_STEPS = [
  { text: '이 열차가 당신의 본진입니다.' },
  { text: '빈 객차 슬롯을 눌러보세요.' },
  { text: '방어시설을 설치하세요.' },
  { text: '적이 접근합니다.' },
  { text: '무기를 업그레이드하세요.' },
  { text: '첫 웨이브 완료.' },
  { text: '경로 선택.' },
  { text: '이제 진짜 여정이 시작됩니다.', final: true }
];

const MAX_CARS = 6;

// =========================================================
// State
// =========================================================
const App = {
  user: null,
  screenStack: ['loading'],
  settings: { music: true, sfx: true, vibration: true, fps: false },
  netRetry: null
};

let game = null; // active GameState instance while playing

function freshGameState() {
  return {
    running: false,
    paused: false,
    sessionId: null,
    seed: null,
    startTime: 0,
    wave: 1,
    enemiesRemaining: 0,
    inWave: false,
    betweenWaves: true,
    betweenWaveTimer: 3,
    train: { hp: 220, maxHp: 220, armor: 0 },
    resources: { scrap: 120, energy: 30, fuel: 100, core: 0, scrapCap: 400, energyCap: 200 },
    cars: [ // slot 0 is locomotive-adjacent first slot
      { slot: 0, type: 'mg', level: 1, hp: 60, maxHp: 60, cooldown: 0 },
      { slot: 1, type: null, level: 1, hp: 60, maxHp: 60, cooldown: 0 },
      { slot: 2, type: null, level: 1, hp: 60, maxHp: 60, cooldown: 0 },
      { slot: 3, type: null, level: 1, hp: 60, maxHp: 60, cooldown: 0 }
    ],
    enemies: [],
    projectiles: [],
    particles: [],
    score: 0,
    boss: null,
    bossIndex: 0,
    skillCooldowns: { repair: 0, overload: 0, brake: 0, barrage: 0, shield: 0 },
    activeEffects: { overload: 0, brake: 0, shield: 0 },
    lastFrame: 0,
    region: 1,
    nodeMapActive: false,
    tutorialActive: false,
    tutorialStep: 0,
    result: null
  };
}

// =========================================================
// Audio (Web Audio API — no external files)
// =========================================================
const AudioSys = (() => {
  let ctx = null;
  function ensure() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; }
    }
    return ctx;
  }
  function beep(freq, duration, type = 'square', vol = 0.08) {
    if (!App.settings.sfx) return;
    const c = ensure();
    if (!c) return;
    try {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = vol;
      osc.connect(gain).connect(c.destination);
      const now = c.currentTime;
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.start(now);
      osc.stop(now + duration);
    } catch (e) { /* ignore */ }
  }
  return {
    button: () => beep(440, 0.06, 'square', 0.05),
    attack: () => beep(880, 0.05, 'square', 0.04),
    hit: () => beep(220, 0.08, 'sawtooth', 0.06),
    explosion: () => beep(80, 0.3, 'sawtooth', 0.12),
    boss: () => beep(60, 0.5, 'sawtooth', 0.15),
    waveStart: () => beep(660, 0.15, 'triangle', 0.08),
    waveComplete: () => beep(990, 0.2, 'triangle', 0.09),
    upgrade: () => beep(1200, 0.1, 'sine', 0.07),
    reward: () => beep(1320, 0.12, 'sine', 0.08)
  };
})();

function vibrate(ms) {
  if (App.settings.vibration && navigator.vibrate) {
    try { navigator.vibrate(ms); } catch (e) { /* ignore */ }
  }
}

// =========================================================
// API Client
// =========================================================
async function api(path, options = {}) {
  try {
    const res = await fetch(API + path, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'REQUEST_FAILED');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (err) {
    if (err instanceof TypeError) {
      showNetError();
    }
    throw err;
  }
}

function showNetError() {
  document.getElementById('overlayNetError').classList.remove('hidden');
}
function hideNetError() {
  document.getElementById('overlayNetError').classList.add('hidden');
}

// =========================================================
// Screen Navigation
// =========================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  const el = document.getElementById('screen-' + id);
  if (el) el.classList.add('active');
}

// =========================================================
// Authentication UI
// =========================================================
function initAuthUI() {
  document.querySelectorAll('.tab-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn[data-tab]').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.auth-form').forEach((f) => f.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab + 'Form').classList.add('active');
      AudioSys.button();
    });
  });

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    AudioSys.button();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    try {
      await api('/api/auth/login', { method: 'POST', body: { email, password } });
      await afterAuthSuccess();
    } catch (err) {
      errEl.textContent = errMsg(err, { INVALID_CREDENTIALS: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }
  });

  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    AudioSys.button();
    const email = document.getElementById('regEmail').value.trim();
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const errEl = document.getElementById('regError');
    errEl.textContent = '';
    try {
      await api('/api/auth/register', { method: 'POST', body: { email, username, password } });
      await afterAuthSuccess();
    } catch (err) {
      errEl.textContent = errMsg(err, {
        DUPLICATE_USER: '이미 사용 중인 이메일 또는 닉네임입니다.',
        INVALID_INPUT: '입력값을 확인해주세요. (닉네임 2-20자, 비밀번호 8자 이상)'
      });
    }
  });
}

function errMsg(err, map) {
  const code = err && err.data && err.data.error;
  return (code && map[code]) || '오류가 발생했습니다. 다시 시도해주세요.';
}

async function afterAuthSuccess() {
  await loadMe();
  if (!App.user.tutorial_completed) {
    showScreen('menu');
    renderMenu();
    // Tutorial begins once player departs for the first time.
  } else {
    showScreen('menu');
    renderMenu();
  }
}

async function loadMe() {
  const data = await api('/api/auth/me');
  App.user = data.user;
}

// =========================================================
// Menu
// =========================================================
function renderMenu() {
  document.getElementById('menuWelcome').textContent = `승무원 ${App.user.username} · Lv.${App.user.level}`;
}

function initMenuUI() {
  document.getElementById('btnDeparture').addEventListener('click', () => {
    AudioSys.button();
    startExpedition();
  });
  document.getElementById('btnMyTrain').addEventListener('click', () => { AudioSys.button(); openTrainScreen('view'); });
  document.getElementById('btnUpgrade').addEventListener('click', () => { AudioSys.button(); openTrainScreen('upgrade'); });
  document.getElementById('btnLeaderboard').addEventListener('click', () => { AudioSys.button(); openLeaderboard(); });
  document.getElementById('btnFriends').addEventListener('click', () => { AudioSys.button(); openFriends(); });
  document.getElementById('btnProfile').addEventListener('click', () => { AudioSys.button(); openProfile(); });
  document.getElementById('btnSettings').addEventListener('click', () => { AudioSys.button(); showScreen('settings'); });

  document.querySelectorAll('[data-back="menu"]').forEach((btn) => {
    btn.addEventListener('click', () => { AudioSys.button(); showScreen('menu'); });
  });

  document.getElementById('settingMusic').checked = App.settings.music;
  document.getElementById('settingSfx').checked = App.settings.sfx;
  document.getElementById('settingVibration').checked = App.settings.vibration;
  document.getElementById('settingFps').checked = App.settings.fps;
  document.getElementById('settingMusic').addEventListener('change', (e) => { App.settings.music = e.target.checked; });
  document.getElementById('settingSfx').addEventListener('change', (e) => { App.settings.sfx = e.target.checked; });
  document.getElementById('settingVibration').addEventListener('change', (e) => { App.settings.vibration = e.target.checked; });
  document.getElementById('settingFps').addEventListener('change', (e) => { App.settings.fps = e.target.checked; });

  document.getElementById('btnLogout').addEventListener('click', async () => {
    AudioSys.button();
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    App.user = null;
    showScreen('auth');
  });

  document.getElementById('btnRetryNet').addEventListener('click', () => {
    hideNetError();
  });
}

// =========================================================
// Train / Upgrade Screen
// =========================================================
let trainScreenMode = 'view';
function openTrainScreen(mode) {
  trainScreenMode = mode;
  document.getElementById('trainScreenTitle').textContent = mode === 'upgrade' ? '업그레이드' : '내 열차';
  renderTrainScreen();
  showScreen('train');
}

function renderTrainScreen() {
  const s = game || freshGameState();
  const list = document.getElementById('trainCarsList');
  list.innerHTML = '';
  s.cars.forEach((car) => {
    const def = car.type ? CAR_TYPES[car.type] : null;
    const div = document.createElement('div');
    div.className = 'car-card';
    if (def) {
      div.innerHTML = `
        <div class="car-head"><span>${def.icon} ${def.name}</span><span>Lv.${car.level}</span></div>
        <div class="car-stats">${def.desc} · HP ${Math.round(car.hp)}/${car.maxHp}</div>
        <div class="car-actions">
          <button data-act="upgrade" data-slot="${car.slot}">업그레이드 (Scrap ${upgradeCost(car)})</button>
        </div>`;
    } else {
      div.innerHTML = `
        <div class="car-head"><span>🔲 빈 슬롯 #${car.slot + 1}</span></div>
        <div class="car-stats">객차를 연결하세요</div>
        <div class="car-actions">
          ${Object.values(CAR_TYPES).map((c) => `<button data-act="install" data-slot="${car.slot}" data-car="${c.id}">${c.icon} ${c.name} (${c.baseCost})</button>`).join('')}
        </div>`;
    }
    list.appendChild(div);
  });

  list.querySelectorAll('[data-act="install"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const slot = Number(btn.dataset.slot);
      const carId = btn.dataset.car;
      installCar(slot, carId);
    });
  });
  list.querySelectorAll('[data-act="upgrade"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const slot = Number(btn.dataset.slot);
      upgradeCarBySlot(slot);
    });
  });
}

function upgradeCost(car) {
  return Math.round(30 * Math.pow(1.5, car.level));
}

function installCar(slot, carId) {
  const s = game;
  const def = CAR_TYPES[carId];
  if (!def) return;
  if (s.resources.scrap < def.baseCost) { flashEventBanner('Scrap이 부족합니다.'); return; }
  s.resources.scrap -= def.baseCost;
  const car = s.cars.find((c) => c.slot === slot);
  car.type = carId;
  car.level = 1;
  car.hp = 60; car.maxHp = 60; car.cooldown = 0;
  AudioSys.upgrade();
  vibrate(20);
  renderTrainScreen();
  updateHud();
}

function upgradeCarBySlot(slot) {
  const s = game;
  const car = s.cars.find((c) => c.slot === slot);
  if (!car || !car.type) return;
  const cost = upgradeCost(car);
  if (s.resources.scrap < cost) { flashEventBanner('Scrap이 부족합니다.'); return; }
  s.resources.scrap -= cost;
  car.level += 1;
  car.maxHp = Math.round(60 * Math.pow(1.2, car.level - 1));
  car.hp = car.maxHp;
  AudioSys.upgrade();
  vibrate(20);
  renderTrainScreen();
  updateHud();
}

function addFreeCar(s) {
  const empty = s.cars.find((c) => !c.type);
  if (empty) {
    const ids = Object.keys(CAR_TYPES);
    empty.type = ids[Math.floor(Math.random() * ids.length)];
    empty.level = 1; empty.hp = 60; empty.maxHp = 60;
  } else {
    s.resources.scrap += 40;
  }
}

// =========================================================
// Leaderboard UI
// =========================================================
let currentLbTab = 'global';
function openLeaderboard() {
  document.querySelectorAll('.tab-btn[data-lbtab]').forEach((b) => b.classList.remove('active'));
  document.querySelector(`.tab-btn[data-lbtab="${currentLbTab}"]`).classList.add('active');
  loadLeaderboard(currentLbTab);
  showScreen('leaderboard');
}

function initLeaderboardUI() {
  document.querySelectorAll('.tab-btn[data-lbtab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      AudioSys.button();
      document.querySelectorAll('.tab-btn[data-lbtab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentLbTab = btn.dataset.lbtab;
      loadLeaderboard(currentLbTab);
    });
  });
}

async function loadLeaderboard(tab) {
  const list = document.getElementById('leaderboardList');
  list.innerHTML = '<div class="list-item">불러오는 중...</div>';
  try {
    const data = await api(`/api/leaderboard/${tab}`);
    const rows = data.leaderboard || [];
    list.innerHTML = '';
    if (rows.length === 0) {
      list.innerHTML = '<div class="list-item">기록이 없습니다.</div>';
      return;
    }
    rows.forEach((r) => {
      const isMe = r.userId === (App.user && App.user.id) || r.isMe;
      const div = document.createElement('div');
      div.className = 'list-item' + (isMe ? ' me' : '');
      div.innerHTML = `<span class="rank-num">${r.rank}</span><span class="name">${escapeHtml(r.username)}</span><span class="sub">${r.score.toLocaleString()}</span>`;
      list.appendChild(div);
    });
    if (data.myRank && tab !== 'friends') {
      const div = document.createElement('div');
      div.className = 'list-item me';
      div.innerHTML = `<span class="rank-num">#${data.myRank}</span><span class="name">내 순위</span><span class="sub"></span>`;
      list.appendChild(div);
    }
  } catch (err) {
    list.innerHTML = '<div class="list-item">불러오기 실패</div>';
  }
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// =========================================================
// Friends UI
// =========================================================
function openFriends() {
  loadFriends();
  showScreen('friends');
}

function initFriendsUI() {
  document.getElementById('friendSearchBtn').addEventListener('click', doFriendSearch);
  document.getElementById('friendSearchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doFriendSearch(); }
  });
}

async function doFriendSearch() {
  AudioSys.button();
  const q = document.getElementById('friendSearchInput').value.trim();
  const results = document.getElementById('friendSearchResults');
  if (!q) { results.innerHTML = ''; return; }
  results.innerHTML = '<div class="list-item">검색 중...</div>';
  try {
    const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    results.innerHTML = '';
    if (data.users.length === 0) {
      results.innerHTML = '<div class="list-item">결과가 없습니다.</div>';
      return;
    }
    data.users.forEach((u) => {
      const div = document.createElement('div');
      div.className = 'list-item';
      div.innerHTML = `<span class="name">${escapeHtml(u.username)}</span><span class="sub">Lv.${u.level}</span><button class="btn-small" data-req="${u.username}">요청</button>`;
      results.appendChild(div);
    });
    results.querySelectorAll('[data-req]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api('/api/friends/request', { method: 'POST', body: { username: btn.dataset.req } });
          btn.textContent = '요청됨';
          btn.disabled = true;
        } catch (err) {
          btn.textContent = errMsg(err, {
            ALREADY_FRIENDS: '이미 친구',
            REQUEST_EXISTS: '요청됨',
            CANNOT_ADD_SELF: '본인 불가',
            USER_NOT_FOUND: '없음'
          });
        }
      });
    });
  } catch (err) {
    results.innerHTML = '<div class="list-item">검색 실패</div>';
  }
}

async function loadFriends() {
  const incoming = document.getElementById('friendRequestsIncoming');
  const listEl = document.getElementById('friendsList');
  incoming.innerHTML = '<div class="list-item">불러오는 중...</div>';
  listEl.innerHTML = '';
  try {
    const data = await api('/api/friends');
    const friends = data.friends || [];
    const pendingIncoming = friends.filter((f) => f.status === 'pending' && f.direction === 'incoming');
    const accepted = friends.filter((f) => f.status === 'accepted');

    incoming.innerHTML = pendingIncoming.length === 0 ? '<div class="list-item">받은 요청이 없습니다.</div>' : '';
    pendingIncoming.forEach((f) => {
      const div = document.createElement('div');
      div.className = 'list-item';
      div.innerHTML = `<span class="name">${escapeHtml(f.username)}</span>
        <button class="btn-small" data-accept="${f.id}">수락</button>
        <button class="btn-small" data-reject="${f.id}">거절</button>`;
      incoming.appendChild(div);
    });
    incoming.querySelectorAll('[data-accept]').forEach((btn) => {
      btn.addEventListener('click', async () => { await api('/api/friends/accept', { method: 'POST', body: { id: btn.dataset.accept } }); loadFriends(); });
    });
    incoming.querySelectorAll('[data-reject]').forEach((btn) => {
      btn.addEventListener('click', async () => { await api('/api/friends/reject', { method: 'POST', body: { id: btn.dataset.reject } }); loadFriends(); });
    });

    listEl.innerHTML = accepted.length === 0 ? '<div class="list-item">친구가 없습니다.</div>' : '';
    accepted.forEach((f) => {
      const div = document.createElement('div');
      div.className = 'list-item';
      div.innerHTML = `<span class="${f.online ? 'dot-online' : 'dot-offline'}">●</span> <span class="name">${escapeHtml(f.username)}</span>
        <button class="btn-small" data-del="${f.id}">삭제</button>`;
      listEl.appendChild(div);
    });
    listEl.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => { await api('/api/friends/' + btn.dataset.del, { method: 'DELETE' }); loadFriends(); });
    });
  } catch (err) {
    incoming.innerHTML = '<div class="list-item">불러오기 실패</div>';
  }
}

// =========================================================
// Profile UI
// =========================================================
function openProfile() {
  loadProfile();
  showScreen('profile');
}

async function loadProfile() {
  const card = document.getElementById('profileCard');
  card.innerHTML = '불러오는 중...';
  try {
    const data = await api('/api/profile');
    const p = data.profile;
    card.innerHTML = `
      <div class="profile-row"><span class="label">닉네임</span><span class="value">${escapeHtml(p.username)}</span></div>
      <div class="profile-row"><span class="label">레벨</span><span class="value">${p.level}</span></div>
      <div class="profile-row"><span class="label">경험치</span><span class="value">${p.experience}</span></div>
      <div class="profile-row"><span class="label">최고 점수</span><span class="value">${p.best_score.toLocaleString()}</span></div>
      <div class="profile-row"><span class="label">최고 웨이브</span><span class="value">${p.best_wave}</span></div>
      <div class="profile-row"><span class="label">총 게임</span><span class="value">${p.total_games}</span></div>
      <div class="profile-row"><span class="label">승리 횟수</span><span class="value">${p.wins}</span></div>
      <div class="profile-row"><span class="label">친구 수</span><span class="value">${p.friend_count}</span></div>
    `;
  } catch (err) {
    card.innerHTML = '불러오기 실패';
  }
}

// =========================================================
// Expedition Start / Tutorial
// =========================================================
async function startExpedition() {
  game = freshGameState();
  try {
    const data = await api('/api/game/start', { method: 'POST' });
    game.sessionId = data.sessionId;
    game.seed = data.seed;
  } catch (err) {
    return; // net error overlay already shown
  }
  game.startTime = Date.now();
  game.tutorialActive = !App.user.tutorial_completed;
  game.tutorialStep = 0;
  showScreen('game');
  resizeCanvas();
  updateHud();
  if (game.tutorialActive) {
    startTutorialStep();
  } else {
    beginWaveCountdown();
  }
  game.running = true;
  requestAnimationFrame(gameLoop);
}

function startTutorialStep() {
  const step = TUTORIAL_STEPS[game.tutorialStep];
  const box = document.getElementById('tutorialBox');
  box.classList.add('show');
  box.innerHTML = `<div>${step.text}</div><div class="tt-next">${step.final ? '탭하여 시작' : '탭하여 계속'}</div>`;
  box.onclick = () => advanceTutorial();
}

async function advanceTutorial() {
  const step = TUTORIAL_STEPS[game.tutorialStep];
  AudioSys.button();
  if (step.final) {
    document.getElementById('tutorialBox').classList.remove('show');
    game.tutorialActive = false;
    try {
      await api('/api/user/tutorial-complete', { method: 'POST' });
      App.user.tutorial_completed = true;
    } catch (e) { /* ignore, best effort */ }
    beginWaveCountdown();
    return;
  }
  game.tutorialStep += 1;
  if (game.tutorialStep >= TUTORIAL_STEPS.length) {
    document.getElementById('tutorialBox').classList.remove('show');
    game.tutorialActive = false;
    beginWaveCountdown();
    return;
  }
  startTutorialStep();
}

// =========================================================
// Waves
// =========================================================
function waveEnemyCount(wave) {
  return Math.min(6 + Math.floor(wave * 1.6), 40);
}

function isBossWave(wave) {
  return wave % 5 === 0;
}

function beginWaveCountdown() {
  game.betweenWaves = true;
  game.betweenWaveTimer = game.tutorialActive ? 0 : 3;
}

function spawnWave() {
  game.inWave = true;
  game.betweenWaves = false;
  AudioSys.waveStart();
  flashEventBanner(`WAVE ${game.wave} 시작`);

  if (isBossWave(game.wave)) {
    const bossId = BOSS_ORDER[game.bossIndex % BOSS_ORDER.length];
    game.bossIndex += 1;
    const def = BOSS_TYPES[bossId];
    game.boss = {
      id: bossId, name: def.name, hp: def.hp * (1 + game.wave * 0.03), maxHp: def.hp * (1 + game.wave * 0.03),
      spd: def.spd, dmg: def.dmg, color: def.color, flying: !!def.flying,
      x: 260, y: -60, targetSlot: 0, score: def.score
    };
    AudioSys.boss();
    game.enemiesRemaining = 0;
    return;
  }

  const count = waveEnemyCount(game.wave);
  game.enemiesRemaining = count;
  const ids = Object.keys(ENEMY_TYPES);
  let spawned = 0;
  const spawnOne = () => {
    if (!game || !game.running || spawned >= count) return;
    const typeId = ids[Math.floor(Math.random() * Math.min(ids.length, 3 + Math.floor(game.wave / 2)))];
    spawnEnemy(typeId);
    spawned += 1;
    if (spawned < count) setTimeout(spawnOne, 550 + Math.random() * 400);
  };
  spawnOne();
}

function spawnEnemy(typeId) {
  const def = ENEMY_TYPES[typeId];
  const difficultyMul = 1 + (game.wave - 1) * 0.12;
  const side = ['front', 'left', 'right', 'air'][Math.floor(Math.random() * (def.flying ? 4 : 3))];
  const canvas = document.getElementById('gameCanvas');
  const w = canvas.width / (window.devicePixelRatio || 1);
  let x, y;
  if (side === 'left') { x = -30; y = 150 + Math.random() * 200; }
  else if (side === 'right') { x = w + 30; y = 150 + Math.random() * 200; }
  else { x = 40 + Math.random() * (w - 80); y = -30; }
  game.enemies.push({
    type: typeId, hp: def.hp * difficultyMul, maxHp: def.hp * difficultyMul,
    spd: def.spd, dmg: def.dmg * (1 + (game.wave - 1) * 0.05), range: def.range,
    color: def.color, flying: !!def.flying, shielded: !!def.shielded, healer: !!def.healer,
    x, y, targetSlot: Math.floor(Math.random() * game.cars.length), fireCooldown: 0
  });
}

function spawnAmbush(s) {
  for (let i = 0; i < 3; i++) spawnEnemy('runner');
}

// =========================================================
// Game Loop / Renderer
// =========================================================
let canvas, ctx;
function initCanvas() {
  canvas = document.getElementById('gameCanvas');
  ctx = canvas.getContext('2d');
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, rect.width * dpr);
  canvas.height = Math.max(1, rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function trainLayoutPositions() {
  const w = canvas.width / (window.devicePixelRatio || 1);
  const centerX = w / 2;
  const baseY = 560;
  const spacing = 66;
  const total = game.cars.length;
  const startX = centerX - ((total - 1) * spacing) / 2;
  return game.cars.map((c, i) => ({ x: startX + i * spacing, y: baseY }));
}

function gameLoop(ts) {
  if (!game || !game.running) return;
  const dt = Math.min(0.05, (ts - (game.lastFrame || ts)) / 1000);
  game.lastFrame = ts;
  if (!game.paused) {
    updateGame(dt);
  }
  renderGame();
  requestAnimationFrame(gameLoop);
}

function updateGame(dt) {
  // resource generation
  const powerCars = game.cars.filter((c) => c.type === 'power').length;
  const repairCars = game.cars.filter((c) => c.type === 'repair').length;
  const supplyCars = game.cars.filter((c) => c.type === 'supply').length;
  game.resources.scrapCap = 400 + supplyCars * 150;
  game.resources.energyCap = 200 + supplyCars * 100;
  game.resources.energy = Math.min(game.resources.energyCap, game.resources.energy + (2 + powerCars * 3) * dt);
  game.resources.scrap = Math.min(game.resources.scrapCap, game.resources.scrap + 1.5 * dt);
  if (repairCars > 0) {
    game.train.hp = Math.min(game.train.maxHp, game.train.hp + repairCars * 2 * dt);
  }

  // effect timers
  for (const key of Object.keys(game.activeEffects)) {
    if (game.activeEffects[key] > 0) game.activeEffects[key] = Math.max(0, game.activeEffects[key] - dt);
  }
  for (const key of Object.keys(game.skillCooldowns)) {
    if (game.skillCooldowns[key] > 0) game.skillCooldowns[key] = Math.max(0, game.skillCooldowns[key] - dt);
  }

  if (game.tutorialActive) { updateHud(); return; }

  if (game.betweenWaves) {
    game.betweenWaveTimer -= dt;
    if (game.betweenWaveTimer <= 0) spawnWave();
    updateHud();
    return;
  }

  const positions = trainLayoutPositions();
  const speedMul = game.activeEffects.brake > 0 ? 0.5 : 1;
  const fireRateMul = game.activeEffects.overload > 0 ? 2 : 1;

  // enemies move & attack
  for (const e of game.enemies) {
    const target = positions[Math.min(e.targetSlot, positions.length - 1)];
    const dx = target.x - e.x, dy = target.y - e.y;
    const dist = Math.hypot(dx, dy);
    if (e.range > 0) {
      // sniper-like: stop at range and fire
      if (dist > e.range) {
        e.x += (dx / dist) * e.spd * speedMul * 40 * dt;
        e.y += (dy / dist) * e.spd * speedMul * 40 * dt;
      } else {
        e.fireCooldown -= dt;
        if (e.fireCooldown <= 0) {
          damageTrain(e.dmg);
          e.fireCooldown = 1.6;
        }
      }
    } else if (dist > 34) {
      e.x += (dx / dist) * e.spd * speedMul * 40 * dt;
      e.y += (dy / dist) * e.spd * speedMul * 40 * dt;
    } else {
      e.fireCooldown -= dt;
      if (e.fireCooldown <= 0) {
        damageTrain(e.dmg);
        e.fireCooldown = 1.0;
        vibrate(15);
      }
    }
    if (e.healer) {
      for (const other of game.enemies) {
        if (other !== e && Math.hypot(other.x - e.x, other.y - e.y) < 60) {
          other.hp = Math.min(other.maxHp, other.hp + 4 * dt);
        }
      }
    }
  }

  // boss update
  if (game.boss) {
    const b = game.boss;
    const target = positions[b.targetSlot % positions.length];
    const dx = target.x - b.x, dy = target.y - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 40) {
      b.x += (dx / dist) * b.spd * speedMul * 30 * dt;
      b.y += (dy / dist) * b.spd * speedMul * 30 * dt;
    } else {
      b.fireCooldown = (b.fireCooldown || 0) - dt;
      if (b.fireCooldown <= 0) {
        damageTrain(b.dmg);
        b.fireCooldown = 1.2;
      }
    }
  }

  // weapon cars fire
  game.cars.forEach((car, idx) => {
    const def = car.type ? CAR_TYPES[car.type] : null;
    if (!def || def.kind !== 'weapon') return;
    car.cooldown -= dt * fireRateMul;
    if (car.cooldown > 0) return;
    const carPos = positions[idx];
    const nearest = findNearestTarget(carPos);
    if (!nearest) return;
    fireWeapon(car, def, carPos, nearest);
    car.cooldown = weaponFireInterval(def.weaponKind) / car.level;
  });

  // projectiles
  for (let i = game.projectiles.length - 1; i >= 0; i--) {
    const p = game.projectiles[i];
    p.life -= dt;
    const dx = p.tx - p.x, dy = p.ty - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 12 || p.life <= 0) {
      applyProjectileHit(p);
      game.projectiles.splice(i, 1);
      continue;
    }
    p.x += (dx / dist) * p.speed * dt;
    p.y += (dy / dist) * p.speed * dt;
  }

  // cleanup dead enemies
  for (let i = game.enemies.length - 1; i >= 0; i--) {
    if (game.enemies[i].hp <= 0) {
      const e = game.enemies[i];
      game.score += ENEMY_TYPES[e.type].score;
      spawnParticles(e.x, e.y, e.color);
      AudioSys.explosion();
      game.enemies.splice(i, 1);
      game.enemiesRemaining = Math.max(0, game.enemiesRemaining - 1);
    }
  }
  if (game.boss && game.boss.hp <= 0) {
    game.score += game.boss.score;
    spawnParticles(game.boss.x, game.boss.y, game.boss.color, 30);
    AudioSys.explosion();
    game.boss = null;
  }

  // particles
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const p = game.particles[i];
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.life <= 0) game.particles.splice(i, 1);
  }

  // wave complete check
  const waveClear = !game.boss && game.enemies.length === 0 && game.enemiesRemaining === 0 && game.inWave;
  if (waveClear) {
    onWaveComplete();
  }

  if (game.train.hp <= 0) {
    endGame('lose');
  }

  updateHud();
}

function weaponFireInterval(kind) {
  return { mg: 0.35, cannon: 1.3, chain: 0.8, flame: 0.5 }[kind] || 1;
}

function findNearestTarget(pos) {
  let best = null, bestDist = Infinity;
  for (const e of game.enemies) {
    const d = Math.hypot(e.x - pos.x, e.y - pos.y);
    if (d < bestDist) { bestDist = d; best = e; }
  }
  if (game.boss) {
    const d = Math.hypot(game.boss.x - pos.x, game.boss.y - pos.y);
    if (d < bestDist) { best = game.boss; }
  }
  return best;
}

function fireWeapon(car, def, from, target) {
  AudioSys.attack();
  const dmgTable = { mg: 4, cannon: 22, chain: 8, flame: 3 };
  const dmg = (dmgTable[def.weaponKind] || 5) * (1 + (car.level - 1) * 0.35);
  game.projectiles.push({
    x: from.x, y: from.y, tx: target.x, ty: target.y,
    speed: def.weaponKind === 'cannon' ? 500 : 700,
    dmg, kind: def.weaponKind, life: 1.2, targetRef: target
  });
}

function applyProjectileHit(p) {
  const target = p.targetRef;
  if (!target || target.hp === undefined) return;
  let dmg = p.dmg;
  if (target.shielded && p.kind !== 'cannon') dmg *= 0.4;
  if (game.activeEffects.shield > 0 && target === game.boss) { /* shield only protects train */ }
  target.hp -= dmg;
  if (p.kind === 'chain') {
    // chain to nearby enemy
    for (const e of game.enemies) {
      if (e !== target && Math.hypot(e.x - target.x, e.y - target.y) < 80) {
        e.hp -= dmg * 0.5;
        break;
      }
    }
  }
  spawnParticles(p.x, p.y, '#ffcc00', 4);
}

function damageTrain(dmg) {
  let d = dmg * (1 - Math.min(0.6, game.train.armor * 0.02));
  if (game.activeEffects.shield > 0) d *= 0.5;
  game.train.hp = Math.max(0, game.train.hp - d);
  const armorCars = game.cars.filter((c) => c.type === 'armor').length;
  if (armorCars > 0) d *= (1 - armorCars * 0.08);
  vibrate(10);
}

function spawnParticles(x, y, color, count = 10) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd = 40 + Math.random() * 80;
    game.particles.push({ x, y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd, life: 0.5, color });
  }
}

function onWaveComplete() {
  game.inWave = false;
  AudioSys.waveComplete();
  const scrapReward = 25 + game.wave * 4;
  game.resources.scrap = Math.min(game.resources.scrapCap, game.resources.scrap + scrapReward);
  game.resources.energy = Math.min(game.resources.energyCap, game.resources.energy + 10);
  flashEventBanner(`WAVE ${game.wave} 완료! Scrap +${scrapReward}`);

  if (game.wave >= 20) {
    endGame('win');
    return;
  }

  // Every 3 waves: show roguelike node map instead of auto-continuing
  if (game.wave % 3 === 0) {
    showNodeMap();
  } else {
    game.wave += 1;
    beginWaveCountdown();
  }
}

function flashEventBanner(text) {
  const el = document.getElementById('eventBanner');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(flashEventBanner._t);
  flashEventBanner._t = setTimeout(() => el.classList.remove('show'), 2200);
}

// =========================================================
// Roguelike Node Map
// =========================================================
function showNodeMap() {
  game.paused = true;
  const overlay = document.getElementById('overlayMap');
  const nodesEl = document.getElementById('mapNodes');
  nodesEl.innerHTML = '';
  const options = generateNodeOptions();
  options.forEach((node) => {
    const btn = document.createElement('button');
    btn.className = 'map-node-btn ' + node.kind;
    btn.textContent = node.label;
    btn.addEventListener('click', () => resolveNode(node));
    nodesEl.appendChild(btn);
  });
  overlay.classList.remove('hidden');
}

function generateNodeOptions() {
  const pool = [
    { kind: 'normal', label: '⚔️ 일반 전투' },
    { kind: 'elite', label: '💀 엘리트 전투' },
    { kind: 'supply', label: '📦 보급' },
    { kind: 'merchant', label: '🛒 상인' },
    { kind: 'event', label: '❓ 랜덤 이벤트' },
    { kind: 'ruin', label: '🏚️ 폐역' }
  ];
  const shuffled = pool.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

function resolveNode(node) {
  document.getElementById('overlayMap').classList.add('hidden');
  game.paused = false;
  game.region += 1;
  switch (node.kind) {
    case 'supply':
      game.resources.scrap = Math.min(game.resources.scrapCap, game.resources.scrap + 60);
      game.resources.fuel += 20;
      flashEventBanner('보급 완료: Scrap +60, Fuel +20');
      game.wave += 1; beginWaveCountdown();
      break;
    case 'merchant':
      game.resources.energy += 40;
      flashEventBanner('상인 방문: Energy +40');
      game.wave += 1; beginWaveCountdown();
      break;
    case 'event': {
      const ev = RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
      ev.apply(game);
      flashEventBanner(`[이벤트] ${ev.title}: ${ev.text}`);
      game.wave += 1; beginWaveCountdown();
      break;
    }
    case 'ruin':
      game.resources.core += 1;
      flashEventBanner('폐역 조사: Core +1');
      game.wave += 1; beginWaveCountdown();
      break;
    case 'elite':
      game.wave += 1;
      spawnWave(); // immediate tougher wave
      game.enemiesRemaining += 3;
      spawnEnemy('crusher');
      break;
    default:
      game.wave += 1;
      beginWaveCountdown();
  }
  updateHud();
}

// =========================================================
// Skills
// =========================================================
function useSkill(id) {
  const s = SKILLS[id];
  if (!s || !game) return;
  if (game.skillCooldowns[id] > 0) { flashEventBanner('스킬 재사용 대기 중'); return; }
  if (game.resources.energy < s.cost) { flashEventBanner('Energy가 부족합니다.'); return; }
  game.resources.energy -= s.cost;
  game.skillCooldowns[id] = s.cooldown;
  AudioSys.upgrade();
  switch (id) {
    case 'repair':
      game.train.hp = Math.min(game.train.maxHp, game.train.hp + game.train.maxHp * 0.25);
      break;
    case 'overload':
      game.activeEffects.overload = 10;
      break;
    case 'brake':
      game.activeEffects.brake = 3;
      break;
    case 'barrage':
      for (const e of game.enemies.slice(0, 5)) e.hp -= 60;
      if (game.boss) game.boss.hp -= 100;
      break;
    case 'shield':
      game.activeEffects.shield = 8;
      break;
  }
  flashEventBanner(`${s.icon} ${s.name} 발동!`);
  updateHud();
}

// =========================================================
// HUD
// =========================================================
function updateHud() {
  if (!game) return;
  const hpPct = Math.max(0, Math.round((game.train.hp / game.train.maxHp) * 100));
  const fill = document.getElementById('hudHpFill');
  fill.style.width = hpPct + '%';
  fill.classList.toggle('low', hpPct < 30);
  document.getElementById('hudHpText').textContent = `HP ${Math.round(game.train.hp)}`;
  document.getElementById('hudWave').textContent = game.boss ? `WAVE ${game.wave} · BOSS` : `WAVE ${game.wave}`;
  document.getElementById('resScrap').textContent = `🔩 ${Math.floor(game.resources.scrap)}`;
  document.getElementById('resEnergy').textContent = `⚡ ${Math.floor(game.resources.energy)}`;
  document.getElementById('resFuel').textContent = `⛽ ${Math.floor(game.resources.fuel)}`;
  document.getElementById('resCore').textContent = `💠 ${Math.floor(game.resources.core)}`;
}

// =========================================================
// Rendering
// =========================================================
function renderGame() {
  if (!canvas) return;
  const w = canvas.width / (window.devicePixelRatio || 1);
  const h = canvas.height / (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, w, h);

  // background rails
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1c2430';
  ctx.lineWidth = 2;
  for (let y = 0; y < h; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  const positions = trainLayoutPositions();

  // enemies
  for (const e of game.enemies) {
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.flying ? 12 : 14, 0, Math.PI * 2);
    ctx.fill();
    if (e.shielded) {
      ctx.strokeStyle = '#00d4ff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x, e.y, 18, 0, Math.PI * 2); ctx.stroke();
    }
    // hp bar
    ctx.fillStyle = '#000';
    ctx.fillRect(e.x - 14, e.y - 24, 28, 4);
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(e.x - 14, e.y - 24, 28 * Math.max(0, e.hp / e.maxHp), 4);
  }

  // boss
  if (game.boss) {
    const b = game.boss;
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.fillRect(b.x - 40, b.y - 52, 80, 8);
    ctx.fillStyle = '#ff3b3b';
    ctx.fillRect(b.x - 40, b.y - 52, 80 * Math.max(0, b.hp / b.maxHp), 8);
    ctx.fillStyle = '#fff';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(b.name, b.x, b.y - 58);
  }

  // projectiles
  ctx.fillStyle = '#ffe066';
  for (const p of game.projectiles) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.kind === 'cannon' ? 5 : 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // particles
  for (const p of game.particles) {
    ctx.globalAlpha = Math.max(0, p.life * 2);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    ctx.globalAlpha = 1;
  }

  // train cars
  game.cars.forEach((car, idx) => {
    const pos = positions[idx];
    const def = car.type ? CAR_TYPES[car.type] : null;
    ctx.fillStyle = def ? '#3a4250' : '#20242c';
    ctx.strokeStyle = idx === 0 ? '#ffcc33' : '#4a5568';
    ctx.lineWidth = 2;
    roundRect(ctx, pos.x - 26, pos.y - 24, 52, 48, 6);
    ctx.fill(); ctx.stroke();
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(def ? def.icon : '➕', pos.x, pos.y + 8);
    if (def) {
      ctx.fillStyle = '#000';
      ctx.fillRect(pos.x - 22, pos.y + 20, 44, 4);
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(pos.x - 22, pos.y + 20, 44 * Math.max(0, car.hp / car.maxHp), 4);
    }
  });

  // effect overlays
  if (game.activeEffects.shield > 0) {
    ctx.strokeStyle = 'rgba(0,180,255,0.4)';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, w - 8, h - 8);
  }

  if (game.betweenWaves && !game.tutorialActive) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(Math.ceil(game.betweenWaveTimer).toString(), w / 2, h / 2);
  }

  if (App.settings.fps) {
    ctx.fillStyle = '#0f0';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('FPS ~' + Math.round(1 / Math.max(0.001, (performance.now() - (renderGame._t || 0)) / 1000)), 6, 14);
    renderGame._t = performance.now();
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// =========================================================
// Input (Tap / Long Press / Drag / Swipe)
// =========================================================
function initGameInput() {
  document.getElementById('btnActionCars').addEventListener('click', () => { AudioSys.button(); openTrainScreen('view'); });
  document.getElementById('btnActionBuild').addEventListener('click', () => { AudioSys.button(); openTrainScreen('view'); });
  document.getElementById('btnActionUpgrade').addEventListener('click', () => { AudioSys.button(); openTrainScreen('upgrade'); });
  document.getElementById('btnActionRepair').addEventListener('click', () => { AudioSys.button(); useSkill('repair'); });
  document.getElementById('btnActionSkill').addEventListener('click', () => { AudioSys.button(); openSkillModal(); });
  document.getElementById('btnActionPause').addEventListener('click', () => { AudioSys.button(); togglePause(); });

  document.getElementById('btnResultContinue').addEventListener('click', () => {
    AudioSys.button();
    document.getElementById('overlayResult').classList.add('hidden');
    startExpedition();
  });
  document.getElementById('btnResultMenu').addEventListener('click', () => {
    AudioSys.button();
    document.getElementById('overlayResult').classList.add('hidden');
    game = null;
    showScreen('menu');
  });

  let longPressTimer = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!game) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    longPressTimer = setTimeout(() => {
      const slot = hitTestCarSlot(x, y);
      if (slot !== -1) { AudioSys.button(); openTrainScreen('upgrade'); }
    }, 500);
  });
  canvas.addEventListener('pointerup', (e) => {
    clearTimeout(longPressTimer);
    if (!game) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const slot = hitTestCarSlot(x, y);
    if (slot !== -1) { AudioSys.button(); openTrainScreen('view'); }
  });
}

function hitTestCarSlot(x, y) {
  if (!game) return -1;
  const positions = trainLayoutPositions();
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    if (Math.abs(x - p.x) < 26 && Math.abs(y - p.y) < 24) return i;
  }
  return -1;
}

function togglePause() {
  if (!game) return;
  game.paused = !game.paused;
  document.getElementById('btnActionPause').textContent = game.paused ? '재개' : '일시정지';
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game && game.running) {
    game.paused = true;
    const btn = document.getElementById('btnActionPause');
    if (btn) btn.textContent = '재개';
  }
});

function openSkillModal() {
  const overlay = document.getElementById('overlayModal');
  const panel = document.getElementById('modalPanel');
  panel.innerHTML = '<div class="map-title">스킬</div>' + Object.values(SKILLS).map((s) => {
    const cd = game.skillCooldowns[s.id];
    const disabled = cd > 0 ? `disabled` : '';
    const label = cd > 0 ? `대기 ${Math.ceil(cd)}s` : `Energy ${s.cost}`;
    return `<button class="map-node-btn" data-skill="${s.id}" ${disabled} style="margin-bottom:8px;width:100%;">${s.icon} ${s.name} — ${s.desc} (${label})</button>`;
  }).join('') + '<button class="btn-secondary" id="closeModal" style="margin-top:8px;">닫기</button>';
  overlay.classList.remove('hidden');
  panel.querySelectorAll('[data-skill]').forEach((btn) => {
    btn.addEventListener('click', () => { useSkill(btn.dataset.skill); overlay.classList.add('hidden'); });
  });
  document.getElementById('closeModal').addEventListener('click', () => overlay.classList.add('hidden'));
}

// =========================================================
// End Game
// =========================================================
async function endGame(result) {
  if (!game || !game.running) return;
  game.running = false;
  game.result = result;
  const durationSec = Math.round((Date.now() - game.startTime) / 1000);

  document.getElementById('resultTitle').textContent = result === 'win' ? 'FRONTIER REACHED' : 'TRAIN DESTROYED';
  document.getElementById('resultTitle').classList.toggle('win', result === 'win');
  document.getElementById('resultStats').textContent = `Wave ${game.wave}  ·  Score ${game.score.toLocaleString()}`;
  document.getElementById('resultRewards').textContent = `Scrap +${Math.floor(game.resources.scrap)}  Core +${game.resources.core}`;
  document.getElementById('resultRank').textContent = '결과 저장 중...';
  document.getElementById('overlayResult').classList.remove('hidden');

  try {
    const data = await api('/api/game/finish', {
      method: 'POST',
      body: { sessionId: game.sessionId, score: game.score, wave: game.wave, result }
    });
    document.getElementById('resultRank').textContent = data.rank
      ? `랭킹 등록 완료 · 현재 순위 #${data.rank}`
      : '랭킹 등록 완료';
    AudioSys.reward();
    await loadMe();
  } catch (err) {
    document.getElementById('resultRank').textContent = '결과 저장 실패 (네트워크 확인)';
  }
}

// =========================================================
// Orientation Guard
// =========================================================
function checkOrientation() {
  const block = document.getElementById('orientationBlock');
  const isLandscape = window.innerWidth > window.innerHeight;
  block.style.display = isLandscape ? 'flex' : 'none';
}

// =========================================================
// Initialization
// =========================================================
async function boot() {
  initAuthUI();
  initMenuUI();
  initLeaderboardUI();
  initFriendsUI();
  initCanvas();
  initGameInput();

  window.addEventListener('resize', checkOrientation);
  checkOrientation();

  const loadingFill = document.getElementById('loadingFill');
  const loadingText = document.getElementById('loadingText');
  loadingFill.style.width = '40%';

  try {
    await loadMe();
    loadingFill.style.width = '100%';
    loadingText.textContent = '접속 완료';
    setTimeout(() => { showScreen('menu'); renderMenu(); }, 300);
  } catch (err) {
    loadingFill.style.width = '100%';
    loadingText.textContent = '승무원 인증 필요';
    setTimeout(() => showScreen('auth'), 300);
  }
}

window.addEventListener('DOMContentLoaded', boot);
