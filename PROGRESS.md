# 진행 상황 요약 (Continuation Notes)

최종 업데이트: 2026-09-10 (저녁)
대상: 골프장 현황 대시보드 (`(주)오션디앤씨 스톤게이트CC`, 부산 기장군)

이 문서는 다른 세션/환경(집 PC 등)에서 작업을 이어갈 때 맥락을 빠르게 따라잡기 위한 요약입니다. 상세 요구사항과 결정 근거는 `PRD.md`를 참고하세요.

---

## 1. 지금까지 완료된 것

1. **PRD.md 작성 완료** — 배경, 목표, KPI, 핵심 기능 6종, 실제 엑셀 샘플 3종 분석, 확정 결정사항 정리됨.
2. **화면 설계(프로토타입) — 진행 중, 방향은 잡힘**
   - 게시 링크: https://claude.ai/code/artifact/7e2ca611-c4aa-4a23-be07-370b9fd9a2c9
   - 아트보드 4개: `design/Start.dc.html`(인트로 화면, 실제 스톤게이트CC 홈페이지 사진 사용), `design/Main.dc.html`(대표 데스크톱 — **왼쪽 고정 사이드바 + Dashboard 통합 요약 화면 + 매출/예약/자금/그린피/날씨 5개 전용 상세 페이지** 구조로 최종 확정), `design/MainMobile.dc.html`(⚠️ 아직 맨 처음 버전 그대로 — Main.dc.html의 이후 변경사항들이 반영 안 됨, 나중에 동기화 필요), `design/Upload.dc.html`(PIN 보호 업로드 화면, PIN: `1234`)
   - 디자인 세부 사항(색상/톤 등)은 "나중에 다시 다듬기"로 보류 중 — 지금은 실제 구현(Firebase/Next.js)에 집중하는 단계
   - **미해결 이슈**: 사용자가 "매출현황 클릭해도 안 넘어간다"고 리포트했으나, 어느 아트보드(데스크톱 vs 모바일)에서였는지, 새로고침을 했었는지 등 확인 전에 대화가 다른 주제로 넘어감 → **다음 세션에서 재확인 필요** (코드 리뷰상으로는 데스크톱 Main.dc.html 로직 자체엔 문제 없음이 이미 확인됨 — 브라우저 캐시나 모바일 아트보드 혼동일 가능성 높음)
3. **Firebase 프로젝트 설정 완료 + Next.js 코드베이스 착수** (아래 §4, §5 참고) — Admin SDK로 Firestore 쓰기/읽기 왕복 테스트(`/api/health`)까지 성공 확인됨 (2026-09-10)

---

## 2. 확정된 핵심 결정 사항 (PRD.md §7 참조)

| 항목 | 결정 |
|---|---|
| 일일 매출 데이터 | 무노스 "하루" 단위 재추출 가능. 매출집계 6개 항목만 사용 |
| 기술 스택 | **Firebase (Firestore)** + Next.js (Vercel 배포) |
| Storage(원본 엑셀 파일 보관) | **사용 안 함** — Google이 Firebase Storage에 Blaze(결제) 요금제를 요구하도록 정책 변경, PRD상 원본 파일 보관은 필수 요건이 아니라 파싱된 데이터만 Firestore에 저장하는 것으로 결정 (2026-09-09) |
| 업로드 보안 | PIN 도입 + **쓰기 작업은 전부 서버(Next.js API Route)에서 Firebase Admin SDK로 처리** — 클라이언트가 Firestore에 직접 쓰지 않음 (Firestore 규칙은 읽기만 공개, 쓰기는 기본 차단) — 아키텍처 세부 결정 (2026-09-09) |
| 업로드 페이지 경로 | `/upload` 확정 |
| 주말 자금 현황 | 공란("데이터 없음") 처리 |
| 그린피 "결제" 의미 | 전자결재(승인) 프로세스, 실제 결제 아님 |
| 비회원 그린피 | 1단계 범위 제외 |
| 그린피 시뮬레이션 단위 | 부(1부/2부/3부) 단위, 최근 30일 평균 라운드 수 기본값 |

---

## 3. 남은 결정 항목 (PRD.md §8, 기본안 있음 — 이견 없으면 그대로 진행)
- 예외 시트/파일 대응 정책 (기본안: 자동 스킵 + 화면 경고)
- 그린피 시뮬레이션 계산 로직 세부 (기본안: 최근 30일 실제 라운드 수 평균 — 이미 프로토타입에 반영됨)

---

## 4. 다음에 이어서 할 것 (착수 순서)

### 4.1 Firebase 계정/키 세팅 — 완료
1. ✅ Firebase 프로젝트 생성 완료
2. ✅ Firestore Database 활성화 완료
3. ⏭️ Storage — 건너뛰기로 결정 (위 §2 참고)
4. ✅ 웹 앱 등록 + `firebaseConfig` 확보 완료
5. ✅ 서비스 계정 키(Admin SDK) 발급 완료 — 파일 `stonegate-8f538-firebase-adminsdk-fbsvc-689b1b064f.json`을 프로젝트 루트에서 읽어 `web/.env.local`에 옮겨 넣음 (`.gitignore`로 보호됨, 원본 json 파일도 계속 로컬에 남아있으나 커밋 대상 아님)

### 4.2 Next.js 코드베이스 — 착수함
- ✅ `web/` 폴더에 Next.js(App Router, TypeScript) 프로젝트 스캐폴딩 완료, `firebase` + `firebase-admin` + `xlsx` 설치 완료
- ✅ `web/src/lib/firebase-client.ts` (브라우저용, 읽기 전용 Firestore) / `web/src/lib/firebase-admin.ts` (서버 전용, Admin SDK) 작성 완료
- ✅ `web/src/app/api/health/route.ts` — Firestore 쓰기/읽기 왕복 테스트 성공 확인 (`{"ok":true,...}`)
- ✅ `web/.env.local` 설정 완료 (Firebase client config + Admin SDK 자격증명 + `UPLOAD_PIN=1234` 임시값 — **실제 운영 전 반드시 변경할 것**)
- ✅ **Firestore 데이터 스키마 타입 정의 완료** — `web/src/types/firestore.ts` (`ReservationDoc`, `DailySalesDoc`, `CashFlowDoc`(은행별 배열 + 입출금 상세 포함), `GreenFeeRatesDoc`(1부/2부/3부, 3부만 요일군 다름 반영), `GreenFeeApprovalDoc`, `WeatherCacheDoc`, `UploadLogDoc`), 컬렉션 이름 상수는 `web/src/lib/collections.ts`
- ✅ **Firestore 보안 규칙 작성 완료** — `web/firestore.rules` (대시보드 데이터 컬렉션 전체 공개 읽기 / 쓰기 전부 차단). `web/firebase.json` + `web/.firebaserc`(project: `stonegate-8f538`)도 추가해둠.
  - ✅ **콘솔에 수동 게시 완료 + 클라이언트 SDK로 직접 검증 완료 (2026-09-11)**: `weatherCache` 등 허용된 컬렉션은 읽기 성공, `_health`는 읽기 거부(`permission-denied`), 클라이언트 직접 쓰기는 전부 거부 — 의도한 대로 정확히 동작 확인됨.
- ✅ **엑셀 파싱 로직 3종 작성 + 실제 샘플 파일로 검증 완료** (`web/src/lib/parsers/`)
  - `reservation.ts` — 예약현황(일별집계) .xls. 헤더 행("일자")을 텍스트로 찾아 위치를 특정, 18개 컬럼 그대로 매핑. 실제 샘플(8월 31일치) 100% 정확히 파싱 확인.
  - `cashFlow.ts` — 자금일보 .xlsx. 시트명이 `MMDD` 형식이 아니면 자동 스킵(§8.1 결정 그대로 구현, 실제로 "8월 28일" 이형 시트 정상 스킵 확인). 은행별 전일/입금/출금/금일 + 입출금 상세 항목까지 파싱. **실제 21일치 샘플 전부에서 "전일+입금-출금=금일" 검증 100% 통과.** 디버깅 중 실제 버그 2개 발견·수정: (1) 병합된 제목 행이 은행 데이터로 잘못 인식되던 것, (2) 회사 전체 합계에 계좌 간 내부이체(대체입/대체출)가 이중 반영되던 것 — 개별 은행별로는 내부이체를 반영해야 그 은행 자체의 잔액 계산이 맞고, 전사 합계에서는 내부이체가 서로 상쇄되므로 반영하면 안 됨(로직으로 확인 및 수정 완료).
  - `dailySales.ts` — 일일영업집계 .xls 중 "매출집계" 서브테이블만 파싱 (그린피/카트료/대여료/식음/상품/기타매출 6항목 + 합계). 파일 안에 적힌 "영업일자 : YYYY년MM월DD일 ~ YYYY년MM월DD일" 범위를 직접 읽어서, 시작일=종료일이면 그 날짜로 자동 확정하고 **범위가 하루보다 넓으면 저장을 거부하고 재추출을 요청** — 실제 "하루 단위" 샘플이 아직 없는 리스크를 이 안전장치로 관리 (§4.3에서 실제 1일치 파일로 최종 재검증 필요, 그 전까지 이 가드가 잘못된 데이터 저장을 막아줌). 디버깅 중 실제 버그 발견·수정: "그린피"라는 헤더가 무관한 다른 서브테이블(그린피 단가별 팀수표)에도 존재해서 엉뚱한 값(0)을 읽어오던 것 — "카트료"(이 서브테이블에만 존재하는 유일 텍스트)를 기준점으로 삼아 가장 가까운 헤더를 선택하도록 수정.
- ✅ **`/upload` 페이지 + API Route 3종 실제 구현 완료, 실제 파일로 전체 파이프라인(파싱→PIN검증→Firestore저장→읽기 확인) 엔드투엔드 테스트 통과**
  - `web/src/app/upload/page.tsx` — PIN 게이트(클라이언트, UX용) → 파일 선택 시 브라우저에서 즉시 파싱 → `/api/upload/*`로 파싱된 JSON + PIN 전송. **디자인은 아직 안 입힘 (기본 HTML 그대로) — 나중에 프로토타입 디자인 적용 예정, 지금은 기능 검증 우선**
  - `web/src/lib/upload-auth.ts` + `web/src/app/api/upload/{reservation,cashflow,sales}/route.ts` — PIN을 서버에서 재검증(진짜 보안 경계, `UPLOAD_PIN` 환경변수와 비교) 후 Admin SDK로 Firestore 저장 + `uploadLog` 컬렉션에 기록
  - 실제 샘플 3개 파일로 로컬 서버에 직접 업로드 테스트: 예약현황 31/31 저장, 자금일보 21/21 저장("8월 28일" 이형 시트는 정상 스킵), 매출은 실제 파일이 월간 범위라 위 안전장치가 정상적으로 저장을 거부함(의도한 동작), 틀린 PIN은 401로 거부됨 — 전부 확인. Firestore에서 직접 읽어서 데이터도 재확인함.
- ⬜ **다음으로 할 것**: 대시보드 실제 구현 (프로토타입 디자인을 실데이터 연동 페이지로 옮기기 — 매출/예약/자금/그린피/날씨 5개 화면), 그 다음 기상청 API 연동
- 참고: 로컬 개발 서버는 `cd web && npm run dev` → http://localhost:3000

### 4.3 아직 시작 안 한 계정 준비
- 기상청 공공데이터포털 API 키 발급 (data.go.kr, 단기예보 API 활용신청 — 승인에 하루 정도 걸릴 수 있어 미리 신청 권장)
- Vercel 계정 준비 (배포용)
- GitHub 저장소 공개/비공개 여부 최종 결정 (현재 퍼블릭 유지 중)

---

## 5. Firebase 프로젝트 설정값 (비밀 아님 — Firebase 설계상 클라이언트에 공개돼도 안전한 값들)

```js
const firebaseConfig = {
  apiKey: "AIzaSyCycIosUfsrSlLfswIXl8r3HCeQGQaKVIA",
  authDomain: "stonegate-8f538.firebaseapp.com",
  projectId: "stonegate-8f538",
  storageBucket: "stonegate-8f538.firebasestorage.app",
  messagingSenderId: "887321860798",
  appId: "1:887321860798:web:6433e481735ce8017b1cef"
};
```
- 프로젝트 ID: `stonegate-8f538`
- Firestore 리전: `asia-northeast3` (서울)
- Firestore 보안 규칙: 프로덕션 모드로 시작 (현재 전부 차단 상태, `allow read, write: if false`) — 코드 구현 시 정식 규칙으로 교체 예정
- Storage: 미사용 (위 결정 참고)
- 서비스 계정 키: **발급 완료**, `web/.env.local`에 반영됨 (파일 자체는 로컬 전용, 절대 커밋 금지)

---

## 6. 중요 주의사항

- **`/EXCEL` 폴더는 `.gitignore`로 제외**되어 GitHub에 올라가지 않음 (실제 은행계좌번호·거래처·지급액 등 민감 데이터 포함).
- **Firebase 서비스 계정 키(JSON)도 `.gitignore`에 패턴 추가해둠** (`*firebase-adminsdk*.json`, `serviceAccountKey.json` 등) — 폴더에 파일이 도착해도 자동으로 커밋 대상에서 제외됨. 그래도 `git add` 전에 항상 `git status`로 한 번 더 확인할 것.
- 저장소(`github.com/inus209120-star/golf_dashboard`)는 **현재 퍼블릭**. `firebaseConfig` 값은 공개돼도 안전하지만, 서비스 계정 키·기상청 API 키 등 진짜 비밀값은 절대 이 저장소에 커밋하지 말 것 (전부 `.env.local`로만 관리).
- 화면 설계의 예약/매출/자금 수치는 전부 **예시 데이터**이며, 그린피 요금표만 실제 9월 안내문 수치 반영.
