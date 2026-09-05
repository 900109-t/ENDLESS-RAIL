'use strict';

// =========================================================
// Configuration
// =========================================================
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const path = require('path');
const { Pool } = require('pg');
const { Redis } = require('@upstash/redis');
const { Ratelimit } = require('@upstash/ratelimit');
const { z } = require('zod');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'train-frontier-dev-secret-change-me';
const COOKIE_NAME = 'tf_session';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30일

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser(SESSION_SECRET));

// =========================================================
// Database (PostgreSQL via pg)
// =========================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : (process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }),
  max: 10
});

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 1,
        experience INTEGER NOT NULL DEFAULT 0,
        tutorial_completed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        avatar TEXT NOT NULL DEFAULT 'default',
        best_score INTEGER NOT NULL DEFAULT 0,
        best_wave INTEGER NOT NULL DEFAULT 0,
        total_games INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS friends (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(requester_id, receiver_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS game_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        score INTEGER NOT NULL,
        wave INTEGER NOT NULL,
        duration INTEGER NOT NULL,
        result TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS upgrades (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        upgrade_type TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 0,
        UNIQUE(user_id, upgrade_type)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        amount INTEGER NOT NULL DEFAULT 0,
        UNIQUE(user_id, item_id)
      );
    `);

    // 서버 재시작 시 세션 검증(부정 점수 방지)을 위한 게임 세션 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        seed TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'active'
      );
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_game_results_user ON game_results(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_friends_receiver ON friends(receiver_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_friends_requester ON friends(requester_id);`);
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    await client.query('COMMIT');
    console.log('[DB] 테이블 초기화 완료');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DB] 초기화 실패:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// =========================================================
// Redis (Upstash)
// =========================================================
let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
  });
} else {
  console.warn('[Redis] 환경변수 미설정 - Redis 기능 비활성화(랭킹은 DB로 대체)');
}

async function safeRedis(fn, fallback = null) {
  if (!redis) return fallback;
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

// Rate limiters (fail-open if redis unavailable)
function makeLimiter(limit, windowSec) {
  if (!redis) return null;
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
    const result = await pool.query('SELECT id, email, username, level, experience, tutorial_completed FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'UNAUTHENTICATED' });
    }
    req.user = result.rows[0];
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

  const dup = await pool.query('SELECT id FROM users WHERE email = $1 OR username = $2', [email, username]);
  if (dup.rows.length > 0) {
    return res.status(409).json({ error: 'DUPLICATE_USER' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query(
      `INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      [email, username, passwordHash]
    );
    const userId = userResult.rows[0].id;
    await client.query(`INSERT INTO profiles (user_id) VALUES ($1)`, [userId]);
    await client.query('COMMIT');

    setSessionCookie(res, userId);
    res.status(201).json({ id: userId, email, username });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'INVALID_INPUT' });
  }
  const ok = await rateLimit('login', req, res);
  if (!ok) return;

  const { email, password } = parsed.data;
  const result = await pool.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  }
  const user = result.rows[0];
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
  await pool.query('UPDATE users SET tutorial_completed = TRUE, updated_at = now() WHERE id = $1', [req.userId]);
  res.json({ ok: true });
}));

app.get('/api/users/search', requireAuth, asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 1) return res.json({ users: [] });
  const result = await pool.query(
    `SELECT id, username, level FROM users WHERE username ILIKE $1 AND id != $2 LIMIT 10`,
    [`%${q}%`, req.userId]
  );
  res.json({ users: result.rows });
}));

app.get('/api/profile', requireAuth, asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT u.username, u.level, u.experience, p.best_score, p.best_wave, p.total_games, p.wins
     FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`,
    [req.userId]
  );
  const friendCountResult = await pool.query(
    `SELECT COUNT(*) FROM friends WHERE (requester_id = $1 OR receiver_id = $1) AND status = 'accepted'`,
    [req.userId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ profile: { ...result.rows[0], friend_count: Number(friendCountResult.rows[0].count) } });
}));

// =========================================================
// Friend API
// =========================================================
app.get('/api/friends', requireAuth, asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT f.id, f.status, f.requester_id, f.receiver_id,
            CASE WHEN f.requester_id = $1 THEN ru.username ELSE qu.username END AS friend_username,
            CASE WHEN f.requester_id = $1 THEN ru.id ELSE qu.id END AS friend_id
     FROM friends f
     JOIN users qu ON qu.id = f.requester_id
     JOIN users ru ON ru.id = f.receiver_id
     WHERE (f.requester_id = $1 OR f.receiver_id = $1)`,
    [req.userId]
  );

  const friends = [];
  for (const row of result.rows) {
    let online = false;
    if (row.status === 'accepted') {
      online = !!(await safeRedis((r) => r.get(`presence:${row.friend_id}`)));
    }
    friends.push({
      id: row.id,
      friendId: row.friend_id,
      username: row.friend_username,
      status: row.status,
      direction: row.requester_id === req.userId ? 'outgoing' : 'incoming',
      online
    });
  }
  res.json({ friends });
}));

app.post('/api/friends/request', requireAuth, asyncHandler(async (req, res) => {
  const ok = await rateLimit('friendRequest', req, res);
  if (!ok) return;

  const targetUsername = String(req.body.username || '').trim();
  if (!targetUsername) return res.status(400).json({ error: 'INVALID_INPUT' });

  const targetResult = await pool.query('SELECT id FROM users WHERE username = $1', [targetUsername]);
  if (targetResult.rows.length === 0) return res.status(404).json({ error: 'USER_NOT_FOUND' });
  const targetId = targetResult.rows[0].id;

  if (targetId === req.userId) return res.status(400).json({ error: 'CANNOT_ADD_SELF' });

  const existing = await pool.query(
    `SELECT status FROM friends WHERE (requester_id = $1 AND receiver_id = $2) OR (requester_id = $2 AND receiver_id = $1)`,
    [req.userId, targetId]
  );
  if (existing.rows.length > 0) {
    if (existing.rows[0].status === 'accepted') return res.status(409).json({ error: 'ALREADY_FRIENDS' });
    return res.status(409).json({ error: 'REQUEST_EXISTS' });
  }

  const insertResult = await pool.query(
    `INSERT INTO friends (requester_id, receiver_id, status) VALUES ($1, $2, 'pending') RETURNING id`,
    [req.userId, targetId]
  );
  res.status(201).json({ id: insertResult.rows[0].id });
}));

app.post('/api/friends/accept', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'INVALID_INPUT' });
  const result = await pool.query(
    `UPDATE friends SET status = 'accepted', updated_at = now() WHERE id = $1 AND receiver_id = $2 AND status = 'pending' RETURNING id`,
    [id, req.userId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
  res.json({ ok: true });
}));

app.post('/api/friends/reject', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'INVALID_INPUT' });
  const result = await pool.query(
    `DELETE FROM friends WHERE id = $1 AND receiver_id = $2 AND status = 'pending' RETURNING id`,
    [id, req.userId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
  res.json({ ok: true });
}));

app.delete('/api/friends/:id', requireAuth, asyncHandler(async (req, res) => {
  const result = await pool.query(
    `DELETE FROM friends WHERE id = $1 AND (requester_id = $2 OR receiver_id = $2) RETURNING id`,
    [req.params.id, req.userId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ ok: true });
}));

// =========================================================
// Game API
// =========================================================
app.post('/api/game/start', requireAuth, asyncHandler(async (req, res) => {
  const seed = randomUUID();
  const result = await pool.query(
    `INSERT INTO game_sessions (user_id, seed) VALUES ($1, $2) RETURNING id, started_at`,
    [req.userId, seed]
  );
  res.status(201).json({
    sessionId: result.rows[0].id,
    seed,
    startedAt: result.rows[0].started_at
  });
}));

app.post('/api/game/finish', requireAuth, asyncHandler(async (req, res) => {
  const parsed = gameFinishSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT' });
  const ok = await rateLimit('gameFinish', req, res);
  if (!ok) return;

  const { sessionId, score, wave, result: gameResult } = parsed.data;

  const sessionResult = await pool.query(
    `SELECT id, started_at, status FROM game_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, req.userId]
  );
  if (sessionResult.rows.length === 0) return res.status(404).json({ error: 'SESSION_NOT_FOUND' });
  const session = sessionResult.rows[0];
  if (session.status !== 'active') return res.status(409).json({ error: 'SESSION_ALREADY_FINISHED' });

  const startedAt = new Date(session.started_at).getTime();
  const durationSec = Math.max(0, Math.round((Date.now() - startedAt) / 1000));

  // 최소 플레이 시간/파형 대비 점수 상한 등 기초 검증(부정 방지)
  if (durationSec < 5 && score > 0) {
    return res.status(400).json({ error: 'SUSPICIOUS_DURATION' });
  }
  const maxPlausibleScore = durationSec * 200 + wave * 5000 + 5000;
  if (score > maxPlausibleScore) {
    return res.status(400).json({ error: 'SUSPICIOUS_SCORE' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE game_sessions SET status = 'finished', finished_at = now() WHERE id = $1`,
      [sessionId]
    );

    await client.query(
      `INSERT INTO game_results (user_id, score, wave, duration, result) VALUES ($1, $2, $3, $4, $5)`,
      [req.userId, score, wave, durationSec, gameResult]
    );

    const won = gameResult === 'win' ? 1 : 0;
    await client.query(
      `UPDATE profiles SET
         best_score = GREATEST(best_score, $2),
         best_wave = GREATEST(best_wave, $3),
         total_games = total_games + 1,
         wins = wins + $4
       WHERE user_id = $1`,
      [req.userId, score, wave, won]
    );

    const expGain = Math.round(score / 20) + wave * 10;
    await client.query(
      `UPDATE users SET experience = experience + $2,
         level = 1 + FLOOR((experience + $2) / 1000),
         updated_at = now()
       WHERE id = $1`,
      [req.userId, expGain]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Redis 랭킹 갱신 (실패해도 DB 저장은 유지됨)
  await safeRedis(async (r) => {
    const bestResult = await pool.query('SELECT best_score FROM profiles WHERE user_id = $1', [req.userId]);
    const bestScore = bestResult.rows[0]?.best_score ?? score;
    await r.zadd('leaderboard:global', { score: bestScore, member: req.userId });
    await r.zadd(weeklyLeaderboardKey(), { score, member: req.userId, gt: true });
  });

  let rank = null;
  const rankValue = await safeRedis((r) => r.zrevrank('leaderboard:global', req.userId));
  if (rankValue !== null && rankValue !== undefined) rank = rankValue + 1;

  res.json({ ok: true, expGain, rank });
}));

// =========================================================
// Leaderboard API
// =========================================================
async function resolveUsernames(userIds) {
  if (userIds.length === 0) return {};
  const result = await pool.query(`SELECT id, username FROM users WHERE id = ANY($1)`, [userIds]);
  const map = {};
  for (const row of result.rows) map[row.id] = row.username;
  return map;
}

app.get('/api/leaderboard/global', requireAuth, asyncHandler(async (req, res) => {
  const ok = await rateLimit('leaderboard', req, res);
  if (!ok) return;

  const redisEntries = await safeRedis((r) => r.zrange('leaderboard:global', 0, 49, { rev: true, withScores: true }));

  if (redisEntries) {
    const ids = [];
    const scores = [];
    for (let i = 0; i < redisEntries.length; i += 2) {
      ids.push(redisEntries[i]);
      scores.push(Number(redisEntries[i + 1]));
    }
    const usernames = await resolveUsernames(ids);
    const list = ids.map((id, i) => ({ userId: id, username: usernames[id] || '???', score: scores[i], rank: i + 1 }));
    const myRankRaw = await safeRedis((r) => r.zrevrank('leaderboard:global', req.userId));
    return res.json({ leaderboard: list, myRank: myRankRaw !== null && myRankRaw !== undefined ? myRankRaw + 1 : null });
  }

  // Fallback: PostgreSQL 기준
  const fallback = await pool.query(
    `SELECT u.id AS user_id, u.username, p.best_score AS score
     FROM profiles p JOIN users u ON u.id = p.user_id
     ORDER BY p.best_score DESC LIMIT 50`
  );
  const list = fallback.rows.map((r, i) => ({ userId: r.user_id, username: r.username, score: r.score, rank: i + 1 }));
  res.json({ leaderboard: list, myRank: null });
}));

app.get('/api/leaderboard/weekly', requireAuth, asyncHandler(async (req, res) => {
  const ok = await rateLimit('leaderboard', req, res);
  if (!ok) return;

  const key = weeklyLeaderboardKey();
  const redisEntries = await safeRedis((r) => r.zrange(key, 0, 49, { rev: true, withScores: true }));
  if (!redisEntries) return res.json({ leaderboard: [], myRank: null });

  const ids = [];
  const scores = [];
  for (let i = 0; i < redisEntries.length; i += 2) {
    ids.push(redisEntries[i]);
    scores.push(Number(redisEntries[i + 1]));
  }
  const usernames = await resolveUsernames(ids);
  const list = ids.map((id, i) => ({ userId: id, username: usernames[id] || '???', score: scores[i], rank: i + 1 }));
  const myRankRaw = await safeRedis((r) => r.zrevrank(key, req.userId));
  res.json({ leaderboard: list, myRank: myRankRaw !== null && myRankRaw !== undefined ? myRankRaw + 1 : null });
}));

app.get('/api/leaderboard/friends', requireAuth, asyncHandler(async (req, res) => {
  const ok = await rateLimit('leaderboard', req, res);
  if (!ok) return;

  const friendsResult = await pool.query(
    `SELECT CASE WHEN requester_id = $1 THEN receiver_id ELSE requester_id END AS friend_id
     FROM friends WHERE (requester_id = $1 OR receiver_id = $1) AND status = 'accepted'`,
    [req.userId]
  );
  const ids = [req.userId, ...friendsResult.rows.map((r) => r.friend_id)];

  const scores = await pool.query(
    `SELECT u.id AS user_id, u.username, p.best_score AS score
     FROM profiles p JOIN users u ON u.id = p.user_id
     WHERE u.id = ANY($1) ORDER BY p.best_score DESC`,
    [ids]
  );
  const list = scores.rows.map((r, i) => ({ userId: r.user_id, username: r.username, score: r.score, rank: i + 1, isMe: r.user_id === req.userId }));
  res.json({ leaderboard: list });
}));

// =========================================================
// Health Check
// =========================================================
app.get('/api/health', asyncHandler(async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    await pool.query('SELECT 1');
    dbStatus = 'connected';
  } catch (err) {
    dbStatus = 'error';
  }
  let redisStatus = 'disabled';
  if (redis) {
    const pong = await safeRedis((r) => r.ping(), null);
    redisStatus = pong ? 'connected' : 'error';
  }
  res.json({ status: 'ok', database: dbStatus, redis: redisStatus });
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
async function start() {
  try {
    await initDatabase();
  } catch (err) {
    console.error('[Server] DB 초기화 실패. DATABASE_URL 환경변수를 확인하세요.', err.message);
  }
  app.listen(PORT, () => {
    console.log(`[Server] TRAIN FRONTIER 서버가 포트 ${PORT}에서 실행 중입니다.`);
  });
}

start();
