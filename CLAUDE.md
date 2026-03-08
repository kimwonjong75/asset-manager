# Asset Manager - 개발 규칙

## 필수 참조
- **타입/훅/유틸 수정, 새 기능 추가 시 반드시 `RULES.md`를 먼저 읽을 것** (파일별 책임, 의존관계, 체크리스트 포함)

## 코드 구조 원칙
| 영역 | 책임 | 금지 |
|------|------|------|
| `components/` | UI 렌더링만 | 비즈니스 로직, API 호출 |
| `hooks/` | 데이터 처리, API 호출, 상태 관리 | UI 렌더링 |
| `utils/` | 순수 함수, 계산 로직 | 상태 변경, side effect |
| `services/` | 외부 API 호출 | 상태 관리 |

## 타입 안전성
- **`any` 타입 절대 금지** — 모든 타입은 `types/` 디렉토리에 정의
- 컴포넌트 Props 타입 명시 필수
- 3단계 이상 Props Drilling → `PortfolioContext` 사용

## API 연동
- 외부 API 호출은 전용 훅(`hooks/`)에서만 수행
- 실패 시 `try-catch` + fallback 데이터 필수 (부분 성공 허용)
- 새 Google Drive API fetch → 반드시 `authenticatedFetch()` 사용 (raw fetch 금지)

## 카테고리 시스템
- `asset.categoryId` (number)가 PRIMARY — `isBaseType(categoryId, 'CASH')` 사용
- `asset.category` (string)은 **DEPRECATED** — 새 코드에서 사용 금지
- 표시명: `getCategoryName(categoryId, categories)`

## 가격/통화
- MA/RSI 등 기술적 지표와 가격 비교 시 **`priceOriginal`** 사용 (통화 일치 보장)
- 당일 변동률 UI 표시: **`metrics.yesterdayChange`** 사용 (`changeRate` 직접 표시 금지)

## UI 제약사항
- 성공 메시지: `UpdateStatusIndicator` 사용 (**플로팅 토스트 추가 금지**)
- 드롭다운 메뉴: `ActionMenu` 컴포넌트 사용 (인라인 absolute 포지션 금지)
- `<main>`과 `<thead>` 사이에 `overflow` 속성 wrapper 추가 금지 (sticky 깨짐)
- 포트폴리오 테이블 기능 추가 시 `PortfolioMobileCard`에도 반영 필수

## 데이터 무결성
- 마이그레이션: 기존 값 보존 (`??` 연산자 사용, `=` 덮어쓰기 금지)
- 스냅샷 수량 역산: `unitPrice`가 0 또는 undefined이면 반드시 스킵
- 로드 파이프라인 순서: `repairCorruptedSnapshots` → `fillAllMissingDates` → `backfillWithRealPrices`

## 문서 유지보수
- 코드 수정 완료 후, RULES.md에 반영할 변경사항이 있으면 사용자에게 갱신을 제안할 것
- RULES.md의 삭제된 기능/파일 기술은 발견 즉시 제거 제안
