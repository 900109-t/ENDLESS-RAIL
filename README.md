# 🚂 ENDLESS RAIL

달리는 열차 자체가 본진인 모바일 전용 열차 디펜스 + 로그라이크 웹게임.
대재난 이후 붕괴한 철도망 위에서, 마지막 장갑열차를 몰고 최후의 생존 도시 **FRONTIER**까지 살아서 도착하는 것이 목표다.

## 게임 설명

- 기관차 + 최대 4개 객차(기관총/포병/발전/수리/보급/승무원/방어/특수)로 열차를 구성한다.
- 웨이브마다 접근하는 적(Runner, Tank, Swarm, Bomber, Shield, Sniper, Mechanic, Flyer, Crusher + 보스 3종)을 방어시설로 막는다.
- 지역마다 로그라이크 노드 맵(전투/엘리트/보급/상인/이벤트/폐역/보스)에서 경로를 선택한다.
- 판마다 8~15분, 자원(Scrap/Energy/Fuel/Core)을 모아 런 중 성장 + 영구 성장을 동시에 진행한다.
- 회원가입/로그인, 온라인 랭킹(전체/주간/친구), 친구 시스템, 프로필이 실제 서버와 연동되어 새로고침 후에도 유지된다.

## 기술 스택

- **Frontend**: HTML5, CSS3, Vanilla JavaScript, Canvas 2D API (프레임워크 미사용)
- **Backend**: Node.js, Express, PostgreSQL(`pg` 직접 연결, Prisma 미사용), Upstash Redis, `@upstash/ratelimit`, bcrypt, cookie-parser, zod

## 파일 구조 (정확히 6개, 폴더 없음)

```
endless-rail/
├── index.html   # 모든 화면 (로그인/메뉴/게임/랭킹/친구/프로필/설정)
├── style.css    # 모든 스타일 (모바일 세로 레이아웃, safe-area, 애니메이션)
├── game.js      # 모든 클라이언트 로직 (게임 엔진 + API 연동 + UI)
├── server.js    # 모든 백엔드 로직 (Express + PostgreSQL + Redis + API)
├── package.json # 의존성 및 실행 스크립트
└── README.md    # 본 문서
```

## 로컬 설치

```bash
npm install
```

### 환경변수

프로젝트 루트에 `.env` 파일을 직접 만들거나 실행 환경(예: Railway)에 아래 값을 등록한다. (`.env` 파일 자체는 저장소에 커밋하지 않는다.)

```
DATABASE_URL=your_postgresql_url
UPSTASH_REDIS_REST_URL=your_upstash_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_token
SESSION_SECRET=your_random_secret
PORT=3000
```

### PostgreSQL 준비

로컬 PostgreSQL 또는 Railway PostgreSQL 플러그인의 접속 문자열을 `DATABASE_URL`에 넣으면 된다. 서버가 처음 시작될 때 `users`, `profiles`, `friends`, `game_results`, `upgrades`, `inventory` 테이블을 `CREATE TABLE IF NOT EXISTS`로 자동 생성하므로 별도 마이그레이션 도구가 필요 없다.

### Upstash Redis 준비

[Upstash](https://upstash.com)에서 Redis 데이터베이스를 만들고 REST URL/TOKEN을 발급받아 `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`에 넣는다. 글로벌/주간 랭킹(Sorted Set), 온라인 상태(TTL 키), Rate Limit에 사용된다. Redis가 일시적으로 응답하지 않아도 게임 진행과 PostgreSQL 저장은 계속 가능하도록 처리되어 있다.

## 실행 방법

```bash
npm start
```

브라우저에서 `http://localhost:3000` 접속. 모바일 기기에서는 같은 네트워크의 로컬 IP(`http://<내부IP>:3000`)로 접속해 테스트한다.

## Railway 배포

1. Railway 프로젝트 생성 후 이 저장소를 연결한다.
2. Railway PostgreSQL 플러그인을 추가하면 자동으로 `DATABASE_URL`이 주입된다.
3. Upstash 콘솔에서 만든 `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, 그리고 임의의 `SESSION_SECRET`을 Railway 환경변수에 등록한다.
4. `PORT`는 Railway가 자동으로 주입하며, `server.js`는 `process.env.PORT || 3000`으로 이를 읽는다.
5. 배포 후 `GET /api/health`로 서버/DB 상태를 확인한다.

## API 목록

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
POST   /api/user/tutorial-complete

GET    /api/users/search
GET    /api/profile

GET    /api/friends
POST   /api/friends/request
POST   /api/friends/accept
POST   /api/friends/reject
DELETE /api/friends/:id

POST   /api/game/start
POST   /api/game/finish

GET    /api/leaderboard/global
GET    /api/leaderboard/weekly
GET    /api/leaderboard/friends

GET    /api/health
```

## 데이터베이스 구조

- `users(id, email, username, password_hash, level, experience, tutorial_completed, created_at, updated_at)`
- `profiles(user_id, avatar, best_score, best_wave, total_games, wins)`
- `friends(id, requester_id, receiver_id, status, created_at, updated_at)`
- `game_results(id, user_id, score, wave, duration, result, created_at)`
- `upgrades(id, user_id, upgrade_type, level)`
- `inventory(id, user_id, item_id, amount)`

랭킹은 PostgreSQL을 영구 기준으로 삼고, `leaderboard:global` / `leaderboard:weekly:YYYY-WW` Redis Sorted Set으로 빠르게 조회한다.

## 게임 구조

```
로그인 → 메인 메뉴 → 튜토리얼(최초 1회) → 출발 → 로그라이크 맵 →
웨이브 전투 → 보상/업그레이드 → 랜덤 이벤트 → 다음 지역 → 보스 →
승리/게임오버 → 결과 저장(서버 검증) → 랭킹 반영
```

`game.js`는 Constants / State / Renderer / Input / Game Loop / Train / Cars / Weapons / Enemies / Bosses / Waves / Events / Roguelike Map / Tutorial / API Client / Auth UI / Friends UI / Leaderboard UI / Profile UI / Menu / Initialization 섹션으로 나뉘어 있다. `server.js`는 Configuration / Database / Redis / Authentication / Middleware / User API / Friend API / Leaderboard API / Game API / Health Check / Static Files / Server Start 섹션으로 나뉘어 있다.

## 테스트 방법 (수동 흐름)

1. 회원가입 → 2. 로그인 → 3. 프로필 조회 → 4. 다른 계정으로 친구 검색 →
5. 친구 요청 → 6. 게임 시작(`/api/game/start`) → 7. 플레이 후 게임 종료(`/api/game/finish`) →
8. 점수 저장 확인 → 9. 글로벌 랭킹 조회 → 10. 친구 랭킹 조회 → 11. 로그아웃

`/api/game/finish`는 서버에서 발급한 `gameSessionId`, 경과 시간, wave 진행, score 범위, 중복 제출 여부를 검증한 뒤에만 결과를 저장하므로 클라이언트가 보낸 점수를 그대로 신뢰하지 않는다.

## 문제 해결

- **서버가 시작되지 않음**: `DATABASE_URL`이 올바른지, PostgreSQL이 접속 가능한지 확인한다.
- **랭킹/온라인 상태가 안 뜸**: Upstash REST URL/TOKEN을 확인한다. Redis 장애 시에도 서버는 정상 응답하되 랭킹만 일시적으로 비어 보일 수 있다.
- **가로 화면에서 검은 화면만 보임**: 정상 동작이다. 이 게임은 세로 전용이며, 세로로 돌리면 자동으로 복귀한다.
- **로그인이 계속 풀림**: 쿠키가 HTTP-only로 설정되므로 브라우저 개발자 도구에서 쿠키 차단 여부를 확인한다.
