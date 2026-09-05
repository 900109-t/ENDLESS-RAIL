'use strict';

// =========================================================
// Configuration
// =========================================================
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const path = require('path');
const { Redis } = require('@upstash/redis');
const { Ratelimit } = require('@upstash/ratelimit');
const { z } = require('zod');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'endless-rail-dev-secret-change-me';
const COOKIE_NAME = 'tf_session';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30일
const SESSION_TTL_SEC = 60 * 60 * 6; // 게임 세션(부정 점수 방지용) 유효 시간 6시간

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser(SESSION_SECRET));

// =========================================================
// Database (Upstash Redis — 유일한 데이터 저장소)
// =========================================================
// 이 프로젝트는 관계형 DB(PostgreSQL 등)를 쓰지 않는다.
// 모든 영구 데이터(계정/프로필/친구/게임결과/랭킹/온라인상태)는
// Upstash Redis 하나에 저장한다.
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.warn('[Redis] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 환경변수가 없습니다. 서버는 뜨지만 모든 데이터 API가 실패합니다.');
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

async function safeRedis(fn, fallback = null) {
  try {
    return await fn(redis);
  } catch (err) {
    console.error('[Redis] 오류:', err.message);
    return fallback;
  }
}

function getWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}

function weeklyLeaderboardKey() {
  return `leaderboard:weekly:${getWeekKey()}`;
}

// ---------------------------------------------------------
// Redis 키 설계
// ---------------------------------------------------------
// user:{id}                 HASH  계정 정보 (email, username, password_hash, level, experience, tutorial_completed, created_at, updated_at)
// idx:email:{email}         STRING userId  (이메일 유일성 인덱스)
// idx:username:{username}   STRING userId  (닉네임 유일성 인덱스)
// directory:users           HASH  username -> userId (유저 검색용 디렉터리)
// profile:{id}              HASH  avatar, best_score, best_wave, total_games, wins
// friends:{userId}          SET   수락된 친구 userId 목록
// friendreq:{requestId}     HASH  id, requester_id, receiver_id, status, created_at, updated_at
// friendreq:out:{userId}    HASH  receiverId -> requestId (내가 보낸 대기중 요청)
// friendreq:in:{userId}     HASH  requesterId -> requestId (내가 받은 대기중 요청)
// session:{sessionId}       HASH  userId, seed, startedAt, status  (TTL 적용)
// results:{userId}          LIST  게임 결과 JSON (최근 100개, 감사용 로그)
// leaderboard:global        ZSET  userId -> best_score
// leaderboard:weekly:YYYY-WW ZSET userId -> 주간 점수
// presence:{userId}         STRING '1' (TTL 60초, 온라인 상태)
// ratelimit:*               @upstash/ratelimit 내부 키

function userKey(id) { return `user:${id}`; }
function profileKey(id) { return `profile:${id}`; }
function friendsKey(id) { return `friends:${id}`; }
function friendReqKey(id) { return `friendreq:${id}`; }
function friendOutKey(id) { return `friendreq:out:${id}`; }
function friendInKey(id) { return `friendreq:in:${id}`; }
function sessionKey(id) { return `session:${id}`; }
function resultsKey(id) { return `results:${id}`; }

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function toBool(v) { return v === true || v === 'true' || v === '1'; }

async function getUserById(id) {
  const data = await safeRedis((r) => r.hgetall(userKey(id)));
  if (!data || !data.id) return null;
  return {
    id: data.id,
    email: data.email,
    username: data.username,
    password_hash: data.password_hash,
    level: toNum(data.level, 1),
    experience: toNum(data.experience, 0),
    tutorial_completed: toBool(data.tutorial_completed),
    created_at: data.created_at,
    updated_at: data.updated_at
  };
}

async function getUserByEmail(email) {
  const id = await safeRedis((r) => r.get(`idx:email:${email}`));
  if (!id) return null;
  return getUserById(id);
}

async function getUserByUsername(username) {
  const id = await safeRedis((r) => r.get(`idx:username:${username}`));
  if (!id) return null;
  return getUserById(id);
}

async function getProfile(userId) {
  const data = await safeRedis((r) => r.hgetall(profileKey(userId)));
  return {
    avatar: (data && data.avatar) || 'default',
    best_score: toNum(data && data.best_score, 0),
    best_wave: toNum(data && data.best_wave, 0),
    total_games: toNum(data && data.total_games, 0),
    wins: toNum(data && data.wins, 0)
  };
}

// Rate limiters (Redis 장애 시 fail-open)
function makeLimiter(limit, windowSec) {
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
    prefix: 'ratelimit:tf'
  });
}

const limiters = {
  login: makeLimiter(10, 60),
  register: makeLimiter(5, 60),
  friendRequest: makeLimiter(20, 60),
  gameFinish: makeLimiter(20, 60),
  leaderboard: makeLimiter(60, 60)
};

async function rateLimit(name, req, res) {
  const limiter = limiters[name];
  if (!limiter) return true;
  try {
    const key = `${name}:${req.userId || req.ip}`;
    const { success } = await limiter.limit(key);
    if (!success) {
      res.status(429).json({ error: 'TOO_MANY_REQUESTS' });
      return false;
    }
    return true;
  } catch (err) {
    console.error('[RateLimit] 오류:', err.message);
    return true; // fail open
  }
}

// =========================================================
// Authentication
// =========================================================
function setSessionCookie(res, userId) {
  res.cookie(COOKIE_NAME, userId, {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_MS
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// =========================================================
// Middleware
// =========================================================
async function requireAuth(req, res, next) {
  const userId = req.signedCookies && req.signedCookies[COOKIE_NAME];
  if (!userId) {
    return res.status(401).json({ error: 'UNAUTHENTICATED' });
  }
  try {
    const user = await getUserById(userId);
    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'UNAUTHENTICATED' });
    }
    req.user = {
      id: user.id,
      email: user.email,
      username: user.username,
      level: user.level,
      experience: user.experience,
      tutorial_completed: user.tutorial_completed
    };
    req.userId = userId;
    // presence heartbeat (best-effort)
    safeRedis((r) => r.set(`presence:${userId}`, '1', { ex: 60 }));
    next();
  } catch (err) {
    console.error('[Auth] 오류:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
}

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// =========================================================
// Validation Schemas
// =========================================================
const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(2).max(20).regex(/^[a-zA-Z0-9_가-힣]+$/, 'INVALID_USERNAME'),
  password: z.string().min(8).max(72)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const gameFinishSchema = z.object({
  sessionId: z.string().uuid(),
  score: z.number().int().min(0).max(10_000_000),
  wave: z.number().int().min(0).max(9999),
  result: z.enum(['win', 'lose', 'quit'])
});

// =========================================================
// User API
// =========================================================
app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'INVALID_INPUT', details: parsed.error.flatten() });
  }
  const ok = await rateLimit('register', req, res);
  if (!ok) return;

  const { email, username, password } = parsed.data;

  // 유일성 확보: 이메일 -> 닉네임 순으로 SETNX. 실패 시 앞서 잡은 키는 되돌린다.
  const userId = randomUUID();
  const emailClaimed = await safeRedis((r) => r.set(`idx:email:${email}`, userId, { nx: true }));
  if (!emailClaimed) {
    return res.status(409).json({ error: 'DUPLICATE_USER' });
  }
  const usernameClaimed = await safeRedis((r) => r.set(`idx:username:${username}`, userId, { nx: true }));
  if (!usernameClaimed) {
    await safeRedis((r) => r.del(`idx:email:${email}`));
    return res.status(409).json({ error: 'DUPLICATE_USER' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date().toISOString();

  await safeRedis((r) => r.hset(userKey(userId), {
    id: userId,
    email,
    username,
    password_hash: passwordHash,
    level: 1,
    experience: 0,
    tutorial_completed: 'false',
    created_at: now,
    updated_at: now
  }));
  await safeRedis((r) => r.hset(profileKey(userId), {
    avatar: 'default',
    best_score: 0,
    best_wave: 0,
    total_games: 0,
    wins: 0
  }));
  await safeRedis((r) => r.hset('directory:users', { [username]: userId }));

  setSessionCookie(res, userId);
  res.status(201).json({ id: userId, email, username });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'INVALID_INPUT' });
  }
  const ok = await rateLimit('login', req, res);
  if (!ok) return;

  const { email, password } = parsed.data;
  const user = await getUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  }
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  }
  setSessionCookie(res, user.id);
  res.json({ ok: true });
}));

app.post('/api/auth/logout', requireAuth, asyncHandler(async (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
}));

app.get('/api/auth/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: req.user });
}));

app.post('/api/user/tutorial-complete', requireAuth, asyncHandler(async (req, res) => {
  await safeRedis((r) => r.hset(userKey(req.userId), {
    tutorial_completed: 'true',
    updated_at: new Date().toISOString()
  }));
  res.json({ ok: true });
}));

app.get('/api/users/search', requireAuth, asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 1) return res.json({ users: [] });

  const directory = await safeRedis((r) => r.hgetall('directory:users'), {});
  const matches = Object.entries(directory || {})
    .filter(([username, id]) => username.toLowerCase().includes(q) && id !== req.userId)
    .slice(0, 10);

  const users = [];
  for (const [username, id] of matches) {
    const user = await getUserById(id);
    if (user) users.push({ id: user.id, username: user.username, level: user.level });
  }
  res.json({ users });
}));

app.get('/api/profile', requireAuth, asyncHandler(async (req, res) => {
  const profile = await getProfile(req.userId);
  const friendIds = await safeRedis((r) => r.smembers(friendsKey(req.userId)), []);
  res.json({
    profile: {
      username: req.user.username,
      level: req.user.level,
      experience: req.user.experience,
      best_score: profile.best_score,
      best_wave: profile.best_wave,
      total_games: profile.total_games,
      wins: profile.wins,
      friend_count: (friendIds || []).length
    }
  });
}));

// =========================================================
// Friend API
// =========================================================
app.get('/api/friends', requireAuth, asyncHandler(async (req, res) => {
  const friends = [];

  const acceptedIds = await safeRedis((r) => r.smembers(friendsKey(req.userId)), []);
  for (const friendId of acceptedIds || []) {
    const friend = await getUserById(friendId);
    if (!friend) continue;
    const online = !!(await safeRedis((r) => r.get(`presence:${friendId}`)));
    friends.push({ id: `acc:${friendId}`, friendId, username: friend.username, status: 'accepted', direction: null, online });
  }

  const outgoing = await safeRedis((r) => r.hgetall(friendOutKey(req.userId)), {});
  for (const [receiverId, requestId] of Object.entries(outgoing || {})) {
    const friend = await getUserById(receiverId);
    if (!friend) continue;
    friends.push({ id: `req:${requestId}`, friendId: receiverId, username: friend.username, status: 'pending', direction: 'outgoing', online: false });
  }

  const incoming = await safeRedis((r) => r.hgetall(friendInKey(req.userId)), {});
  for (const [requesterId, requestId] of Object.entries(incoming || {})) {
    const friend = await getUserById(requesterId);
    if (!friend) continue;
    friends.push({ id: `req:${requestId}`, friendId: requesterId, username: friend.username, status: 'pending', direction: 'incoming', online: false });
  }

  res.json({ friends });
}));

app.post('/api/friends/request', requireAuth, asyncHandler(async (req, res) => {
  const ok = await rateLimit('friendRequest', req, res);
  if (!ok) return;

  const targetUsername = String(req.body.username || '').trim();
  if (!targetUsername) return res.status(400).json({ error: 'INVALID_INPUT' });

  const target = await getUserByUsername(targetUsername);
  if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });
  const targetId = target.id;

  if (targetId === req.userId) return res.status(400).json({ error: 'CANNOT_ADD_SELF' });

  const alreadyFriends = await safeRedis((r) => r.sismember(friendsKey(req.userId), targetId));
  if (alreadyFriends) return res.status(409).json({ error: 'ALREADY_FRIENDS' });

  const existingOutgoing = await safeRedis((r) => r.hget(friendOutKey(req.userId), targetId));
  const existingIncoming = await safeRedis((r) => r.hget(friendInKey(req.userId), targetId));
  if (existingOutgoing || existingIncoming) return res.status(409).json({ error: 'REQUEST_EXISTS' });

  const requestId = randomUUID();
  const now = new Date().toISOString();
  await safeRedis((r) => r.hset(friendReqKey(requestId), {
    id: requestId,
    requester_id: req.userId,
    receiver_id: targetId,
    status: 'pending',
    created_at: now,
    updated_at: now
  }));
  await safeRedis((r) => r.hset(friendOutKey(req.userId), { [targetId]: requestId }));
  await safeRedis((r) => r.hset(friendInKey(targetId), { [req.userId]: requestId }));

  res.status(201).json({ id: `req:${requestId}` });
}));

app.post('/api/friends/accept', requireAuth, asyncHandler(async (req, res) => {
  const raw = String(req.body.id || '');
  const requestId = raw.startsWith('req:') ? raw.slice(4) : raw;
  if (!requestId) return res.status(400).json({ error: 'INVALID_INPUT' });

  const request = await safeRedis((r) => r.hgetall(friendReqKey(requestId)));
  if (!request || !request.id || request.status !== 'pending' || request.receiver_id !== req.userId) {
    return res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
  }

  await safeRedis((r) => r.sadd(friendsKey(request.requester_id), request.receiver_id));
  await safeRedis((r) => r.sadd(friendsKey(request.receiver_id), request.requester_id));
  await safeRedis((r) => r.hdel(friendOutKey(request.requester_id), request.receiver_id));
  await safeRedis((r) => r.hdel(friendInKey(request.receiver_id), request.requester_id));
  await safeRedis((r) => r.del(friendReqKey(requestId)));

  res.json({ ok: true });
}));

app.post('/api/friends/reject', requireAuth, asyncHandler(async (req, res) => {
  const raw = String(req.body.id || '');
  const requestId = raw.startsWith('req:') ? raw.slice(4) : raw;
  if (!requestId) return res.status(400).json({ error: 'INVALID_INPUT' });

  const request = await safeRedis((r) => r.hgetall(friendReqKey(requestId)));
  if (!request || !request.id || request.status !== 'pending' || request.receiver_id !== req.userId) {
    return res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
  }

  await safeRedis((r) => r.hdel(friendOutKey(request.requester_id), request.receiver_id));
  await safeRedis((r) => r.hdel(friendInKey(request.receiver_id), request.requester_id));
  await safeRedis((r) => r.del(friendReqKey(requestId)));

  res.json({ ok: true });
}));

app.delete('/api/friends/:id', requireAuth, asyncHandler(async (req, res) => {
  const raw = String(req.params.id || '');

  if (raw.startsWith('acc:')) {
    const otherId = raw.slice(4);
    const isFriend = await safeRedis((r) => r.sismember(friendsKey(req.userId), otherId));
    if (!isFriend) return res.status(404).json({ error: 'NOT_FOUND' });
    await safeRedis((r) => r.srem(friendsKey(req.userId), otherId));
    await safeRedis((r) => r.srem(friendsKey(otherId), req.userId));
    return res.json({ ok: true });
  }

  const requestId = raw.startsWith('req:') ? raw.slice(4) : raw;
  const request = await safeRedis((r) => r.hgetall(friendReqKey(requestId)));
  if (!request || !request.id || (request.requester_id !== req.userId && request.receiver_id !== req.userId)) {
    return res.status(404).json({ error: 'NOT_FOUND' });
  }
  await safeRedis((r) => r.hdel(friendOutKey(request.requester_id), request.receiver_id));
  await safeRedis((r) => r.hdel(friendInKey(request.receiver_id), request.requester_id));
  await safeRedis((r) => r.del(friendReqKey(requestId)));
  res.json({ ok: true });
}));

// =========================================================
// Game API
// =========================================================
app.post('/api/game/start', requireAuth, asyncHandler(async (req, res) => {
  const sessionId = randomUUID();
  const seed = randomUUID();
  const startedAt = Date.now();

  await safeRedis((r) => r.hset(sessionKey(sessionId), {
    userId: req.userId,
    seed,
    startedAt,
    status: 'active'
  }));
  await safeRedis((r) => r.expire(sessionKey(sessionId), SESSION_TTL_SEC));

  res.status(201).json({ sessionId, seed, startedAt });
}));

app.post('/api/game/finish', requireAuth, asyncHandler(async (req, res) => {
  const parsed = gameFinishSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT' });
  const ok = await rateLimit('gameFinish', req, res);
  if (!ok) return;

  const { sessionId, score, wave, result: gameResult } = parsed.data;

  const session = await safeRedis((r) => r.hgetall(sessionKey(sessionId)));
  if (!session || !session.userId || session.userId !== req.userId) {
    return res.status(404).json({ error: 'SESSION_NOT_FOUND' });
  }
  if (session.status !== 'active') {
    return res.status(409).json({ error: 'SESSION_ALREADY_FINISHED' });
  }

  const startedAt = toNum(session.startedAt, Date.now());
  const durationSec = Math.max(0, Math.round((Date.now() - startedAt) / 1000));

  // 최소 플레이 시간/웨이브 대비 점수 상한 등 기초 검증(부정 방지)
  if (durationSec < 5 && score > 0) {
    return res.status(400).json({ error: 'SUSPICIOUS_DURATION' });
  }
  const maxPlausibleScore = durationSec * 200 + wave * 5000 + 5000;
  if (score > maxPlausibleScore) {
    return res.status(400).json({ error: 'SUSPICIOUS_SCORE' });
  }

  await safeRedis((r) => r.hset(sessionKey(sessionId), { status: 'finished', finishedAt: Date.now() }));

  const won = gameResult === 'win' ? 1 : 0;

  await safeRedis((r) => r.lpush(resultsKey(req.userId), JSON.stringify({
    score, wave, duration: durationSec, result: gameResult, created_at: new Date().toISOString()
  })));
  await safeRedis((r) => r.ltrim(resultsKey(req.userId), 0, 99));

  const profile = await getProfile(req.userId);
  const bestScore = Math.max(profile.best_score, score);
  const bestWave = Math.max(profile.best_wave, wave);
  await safeRedis((r) => r.hset(profileKey(req.userId), {
    best_score: bestScore,
    best_wave: bestWave,
    total_games: profile.total_games + 1,
    wins: profile.wins + won
  }));

  const expGain = Math.round(score / 20) + wave * 10;
  const newExperience = req.user.experience + expGain;
  const newLevel = 1 + Math.floor(newExperience / 1000);
  await safeRedis((r) => r.hset(userKey(req.userId), {
    experience: newExperience,
    level: newLevel,
    updated_at: new Date().toISOString()
  }));

  // Redis 랭킹 갱신
  await safeRedis((r) => r.zadd('leaderboard:global', { score: bestScore, member: req.userId }));
  await safeRedis((r) => r.zadd(weeklyLeaderboardKey(), { score, member: req.userId, gt: true }));

  let rank = null;
  const rankValue = await safeRedis((r) => r.zrevrank('leaderboard:global', req.userId));
  if (rankValue !== null && rankValue !== undefined) rank = rankValue + 1;

  res.json({ ok: true, expGain, rank });
}));

// =========================================================
// Leaderboard API
// =========================================================
async function resolveUsernames(userIds) {
  const map = {};
  for (const id of userIds) {
    const user = await getUserById(id);
    if (user) map[id] = user.username;
  }
  return map;
}

function parseZrangeWithScores(entries) {
  const ids = [];
  const scores = [];
  for (let i = 0; i < entries.length; i += 2) {
    ids.push(entries[i]);
    scores.push(Number(entries[i + 1]));
  }
  return { ids, scores };
}

app.get('/api/leaderboard/global', requireAuth, asyncHandler(async (req, res) => {
  const ok = await rateLimit('leaderboard', req, res);
  if (!ok) return;

  const redisEntries = await safeRedis((r) => r.zrange('leaderboard:global', 0, 49, { rev: true, withScores: true }), []);
  const { ids, scores } = parseZrangeWithScores(redisEntries || []);
  const usernames = await resolveUsernames(ids);
  const list = ids.map((id, i) => ({ userId: id, username: usernames[id] || '???', score: scores[i], rank: i + 1 }));
  const myRankRaw = await safeRedis((r) => r.zrevrank('leaderboard:global', req.userId));
  res.json({ leaderboard: list, myRank: myRankRaw !== null && myRankRaw !== undefined ? myRankRaw + 1 : null });
}));

app.get('/api/leaderboard/weekly', requireAuth, asyncHandler(async (req, res) => {
  const ok = await rateLimit('leaderboard', req, res);
  if (!ok) return;

  const key = weeklyLeaderboardKey();
  const redisEntries = await safeRedis((r) => r.zrange(key, 0, 49, { rev: true, withScores: true }), []);
  const { ids, scores } = parseZrangeWithScores(redisEntries || []);
  const usernames = await resolveUsernames(ids);
  const list = ids.map((id, i) => ({ userId: id, username: usernames[id] || '???', score: scores[i], rank: i + 1 }));
  const myRankRaw = await safeRedis((r) => r.zrevrank(key, req.userId));
  res.json({ leaderboard: list, myRank: myRankRaw !== null && myRankRaw !== undefined ? myRankRaw + 1 : null });
}));

app.get('/api/leaderboard/friends', requireAuth, asyncHandler(async (req, res) => {
  const ok = await rateLimit('leaderboard', req, res);
  if (!ok) return;

  const friendIds = await safeRedis((r) => r.smembers(friendsKey(req.userId)), []);
  const ids = [req.userId, ...(friendIds || [])];

  const rows = [];
  for (const id of ids) {
    const user = await getUserById(id);
    const profile = await getProfile(id);
    if (user) rows.push({ userId: id, username: user.username, score: profile.best_score });
  }
  rows.sort((a, b) => b.score - a.score);
  const list = rows.map((row, i) => ({ ...row, rank: i + 1, isMe: row.userId === req.userId }));
  res.json({ leaderboard: list });
}));

// =========================================================
// Health Check
// =========================================================
app.get('/api/health', asyncHandler(async (req, res) => {
  const pong = await safeRedis((r) => r.ping(), null);
  res.json({ status: 'ok', database: pong ? 'connected' : 'error' });
}));

// =========================================================
// Static Files
// =========================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'style.css'));
});
app.get('/game.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'game.js'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'SERVER_ERROR' });
});

// =========================================================
// Server Start
// =========================================================
app.listen(PORT, () => {
  console.log(`[Server] ENDLESS RAIL 서버가 포트 ${PORT}에서 실행 중입니다. (데이터 저장소: Upstash Redis)`);
});
