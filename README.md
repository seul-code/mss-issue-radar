# 중기부 이슈레이더

중소벤처기업부 관련 뉴스·정책 이슈를 하루 1회 모아 AI로 분류·요약해 보여주는 **개인 학습용** 대시보드입니다.
중소벤처기업부 공식 서비스가 아닙니다. 검색엔진 색인은 막아 두었습니다.

- 요구사항: [PRD.md](PRD.md) · 설계: [DESIGN.md](DESIGN.md) · 작업 계획: [PLAN.md](PLAN.md) · 작업 규칙: [CLAUDE.md](CLAUDE.md)
- 기술: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Vercel (Cron, Blob)

## 동작 요약

- 매일 한국 시각 7시대에 Vercel Cron이 `/api/cron`을 부른다. `CRON_SECRET`으로 보호된다.
- 수집: 중기부 보도자료 RSS, 정책브리핑 정책뉴스 API, 언론사 RSS 16곳.
- 분석: 1차 선별(저가 모델 1회) → 최종 분석(상위 모델 1회). 관련 이슈가 5건 미만이면 48시간 확장으로 1회 추가.
- 저장: 운영 배포에서만 Vercel Blob(Private)에 저장한다. 내 컴퓨터와 preview 배포는 Blob 토큰이 있어도 메모리 저장소를 쓴다.
- 화면: 방문은 저장된 결과만 읽는다. 페이지 방문이 AI를 부르지 않는다.
- 지난 날짜: `/d/YYYY-MM-DD`에서 볼 수 있다(기록 시작일 2026-10-12 ~ 오늘).

## 로컬 실행

```bash
npm install
npm run dev
```

- `AI_MODE`가 없으면 가짜 AI 응답으로 동작합니다. 실제 OpenAI는 호출하지 않습니다.
- 개발 서버에서만 `/?demo=normal|empty|failed|none|stale|interrupted|timeout|live`로 화면 상태를 바꿔 볼 수 있습니다.
- 검증: `npm run lint`, `npm run build`.

## 환경변수 (값은 `.env`·Vercel 환경변수에만, 저장소에 올리지 않음)

| 이름 | 용도 |
|---|---|
| `OPENAI_API_KEY` | OpenAI 호출 |
| `OPENAI_MODEL` / `OPENAI_LIGHT_MODEL` | 최종 분석 / 1차 선별 모델명 |
| `AI_MODE` | `live`일 때만 실제 OpenAI 호출. 운영 배포에서는 필수 |
| `DATA_GO_KR_API_KEY` | 정책뉴스 API 인증키. 운영에서 없으면 수집 전에 실패로 기록 |
| `CRON_SECRET` | 자동 실행 주소 비밀번호. 배포(preview 포함)에서 필수 |
| `BLOB_READ_WRITE_TOKEN` | Blob 저장소 연결 시 자동 등록. Production 환경에만 연결 권장 |

## 배포 전 확인

- **Blob 저장소를 첫 운영 빌드 전에 Production 환경에 연결**합니다. 토큰이 없으면 운영 빌드가 일부러 실패합니다.
- Production 환경변수에 위 값이 모두 있는지 확인합니다.
- OpenAI 콘솔의 월 사용 한도($10)를 확인합니다. 한도가 호출을 실제로 막는지는 미확인입니다.
- 언론사 RSS 이용 조건을 확인합니다.
- 남은 한계와 미검증 항목은 DESIGN.md 4-1·5·9장을 봅니다.
