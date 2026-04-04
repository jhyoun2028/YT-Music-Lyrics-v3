# YT Music Lyrics Extension — 세션 노트

## 프로젝트 위치
- **작업 폴더**: `~/Desktop/YT-Lyrics-Final` (Chrome에서 이 폴더를 Load unpacked)
- **Git 레포 (v1.7 기반)**: `~/Library/Mobile Documents/com~apple~CloudDocs/Desktop/YT music Lyrics`
- **GitHub**: https://github.com/jhyoun2028/yt-music-lyrics

## 현재 상태 (마지막 작업)

### 해결된 것
- ✅ rAF 기반 싱크 루프 (video.currentTime 대신 movie_player.getCurrentTime 사용)
- ✅ playerBridge.js — MAIN world에서 YTM 플레이어 API 접근, 20ms 간격 시간 보간
- ✅ window.postMessage로 MAIN ↔ ISOLATED world 통신
- ✅ drift correction 제거 (누적 보정이 싱크 망가뜨리던 근본 원인)
- ✅ BASE_OFFSET 제거 (임의 고정값이 비주류 곡 싱크 파괴)
- ✅ 탭 전환 시 싱크 밀림 수정 (visibilitychange + 시간 점프 감지)
- ✅ 자막 클릭 seek 후 싱크 밀림 수정 (activeIndex 리셋)
- ✅ DOM 캐싱 (.aml-line + offsetTop)
- ✅ Extension context invalidated 방어 (isExtensionValid 가드)
- ✅ LRC [offset:] 태그 파싱
- ✅ Cubey API 연동 (Turnstile 자동 인증 → JWT → lyrics.api.dacubeking.com)
- ✅ playerBridge에서 videoId 수신 (playlist 페이지에서도 정상 작동)

### 방금 작업 중이던 것 (아직 테스트 안 함!)
- **TTML 파싱 추가** — `goLyricsApiTtml` 필드에서 싱크 가사 추출
- Cubey API가 `musixmatchSyncedLyrics: null`이어도 `goLyricsApiTtml: true`인 곡이 있음
- "zombie by millimax" 같은 비주류 곡의 싱크 가사가 여기 있음
- `parseTTML()` 함수 추가했고, `parseCubeyResponse()`에서 TTML을 최우선으로 체크
- **리로드해서 zombie 재생하면 `cubey-ttml | line`으로 나와야 함**

## 아키텍처

### 파일 구조
```
~/Desktop/YT-Lyrics-Final/
├── manifest.json      — v2.0.0, host_permissions에 dacubeking.com 포함
├── content.js         — 메인 확장 로직 (ISOLATED world)
├── playerBridge.js    — YTM 플레이어 API 접근 (MAIN world)
├── lyrics.css         — Apple Music 스타일 UI
├── popup.html/js      — ON/OFF 토글
└── icons/             — 확장 아이콘
```

### 가사 소스 우선순위
```
1. Musixmatch (mxmFetchLyrics) — 대부분 유명 곡 여기서 해결
2. lrclib (fetchSyncedLyrics) — Musixmatch 없으면
3. Cubey API (cubeyFetchLyrics) — 위 둘 다 없을 때만 (Turnstile 인증 필요)
   └── goLyricsApiTtml (TTML 싱크) ← 방금 추가, 테스트 필요!
   └── musixmatchSyncedLyrics
   └── lrclibSyncedLyrics
   └── lrclibPlainLyrics
4. YTM 내장 plain text (tryPlainLyrics) — 최후 fallback
```

### 싱크 엔진
- `playerBridge.js` (MAIN world) → `window.postMessage` → `content.js` (ISOLATED world)
- `movie_player.getCurrentTime()` + 시간 보간 (20ms tick)
- `processSync(t)` — 현재 시간으로 활성 라인 찾기
- `setActive(index)` — ±4 범위만 CSS 클래스 업데이트 (DOM 캐싱)
- CSS transform 스크롤 (GPU 합성, 300ms 트랜지션)

### Cubey API 인증 흐름
```
1. iframe → lyrics.api.dacubeking.com/challenge (Cloudflare Turnstile)
2. iframe postMessage → turnstile-token
3. POST /verify-turnstile { token } → JWT 발급
4. GET /lyrics?song=&artist=&duration=&videoId= (Authorization: Bearer JWT)
5. JWT는 localStorage에 캐싱 (만료 전까지 재사용)
```

## 알려진 한계
- **synced 가사 없는 곡**: Musixmatch/lrclib/Cubey 모두 없으면 plain text fallback
- **Spotify 연동 제거됨**: CDN 차단으로 서버 측 불가, 클라이언트도 불안정
- **프록시 서버 불필요**: 현재 모든 API 호출이 클라이언트에서 직접

## 다음에 할 것
1. TTML 파싱 테스트 (zombie by millimax로)
2. 디버그 로그 정리 (console.log 제거)
3. GitHub push (YT-Lyrics-Final은 아직 git init 안 됨)
4. UI 개선 (선택)
