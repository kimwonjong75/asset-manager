# KIM'S 퀀트자산관리 - 포트폴리오 관리 시스템

## 프로젝트 개요

KIM'S 퀀트자산관리는 계량적 투자 전략을 기반으로 한 종합 자산 관리 시스템입니다. Google Drive 연동을 통해 데이터를 안전하게 저장하고, 실시간 시세 정보를 제공하며, 다양한 자산 종류를 지원하는 포트폴리오 관리 도구입니다.

### 핵심 기능
- **멀티 자산 지원**: 한국주식, 미국주식, 해외주식, 채권, 암호화폐, 실물자산, 현금
- **실시간 시세 업데이트**: 외부 API를 통한 실시간 가격 정보
- **환율 자동 반영**: USD, JPY 등 주요 통화 환율 자동 적용
- **Google Drive 동기화**: 안전한 클라우드 저장소 연동 (LZ-String 압축 적용)
- **앱 시작 시 자동 시세 업데이트**: 오늘 업데이트 안 했으면 자동 갱신
- **히스토리 백필 + 종가 교정**: 앱을 안 열었던 날의 실제 과거 시세 채움 + 장중 기록된 가격을 종가로 교정
- **포트폴리오 분석**: 자산 배분, 수익률, 손익 추이 분석
- **리밸런싱 목표 관리**: 자산군별 목표 비중 및 목표 총 자산 금액 설정/저장
- **추가매수 기록**: 보유 종목의 추가매수 시 가중평균 단가 자동 계산 및 메모 이력 기재
- **스마트 필터**: 이동평균(MA), RSI, 매매신호, 수익률 등 기술적 지표 기반 포트폴리오 필터링 (그룹 내 OR, 그룹 간 AND 조합)
- **매도 알림**: 고점 대비 하락률 기준 알림 (스마트 필터 패널에 통합)
- **관심종목 관리**: 별도의 워치리스트 기능
- **CSV 대량 등록**: 대량의 자산 일괄 등록
- **차트 MA 오버레이**: 자산 차트에 사용자 커스텀 이동평균선(MA5~MA200) 오버레이
- **서버 신호 표시**: 서버 제공 매수/매도 신호 및 RSI 상태 배지 표시

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| **프론트엔드** | React 19.2.0, TypeScript, Vite |
| **스타일링** | Tailwind CSS |
| **차트** | Recharts |
| **아이콘** | Lucide React |
| **데이터 압축** | LZ-String |
| **배포** | GitHub Pages |
| **백엔드** | Google Cloud Run (Python) |

---

## 빠른 시작 (Quick Start)

### 필수 환경
- Node.js 18.x 이상
- npm 9.x 이상
- Google Cloud Console 프로젝트 (OAuth 설정)

### 설치 및 실행
```bash
# 1. 저장소 클론
git clone https://github.com/your-username/asset-manager.git
cd asset-manager

# 2. 의존성 설치
npm install

# 3. 환경 변수 설정 (.env.local 파일 생성)
echo "VITE_GOOGLE_CLIENT_ID=your_google_client_id" > .env.local

# 4. 개발 서버 실행
npm run dev
```

### Google OAuth 설정
1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트 생성
2. OAuth 2.0 클라이언트 ID 생성 (웹 애플리케이션)
3. 승인된 JavaScript 원본에 `http://localhost:5173` 추가
4. 승인된 리디렉션 URI에 `http://localhost:5173` 추가
5. Google Drive API 활성화
6. 클라이언트 ID를 `.env.local`에 설정

---

## 사용 가이드

### 1. 로그인 및 데이터 동기화
1. 앱 실행 후 **Google 로그인** 버튼 클릭
2. Google 계정으로 인증 → Drive 접근 권한 허용
3. 기존 데이터가 있으면 자동 로드, 없으면 새로 시작
4. 모든 변경사항은 자동으로 Google Drive에 저장 (2초 디바운스)

### 2. 자산 추가/수정/삭제
1. **자산 추가**: 포트폴리오 탭 → "자산 추가" 버튼
   - 티커 심볼 입력 (예: 005930, AAPL, BTC)
   - 거래소 선택 (KRX, NASDAQ, Upbit 등)
   - 매수가, 수량, 매수일 입력
2. **자산 수정**: 테이블 행의 "관리" → "수정"
3. **자산 삭제**: 테이블 행의 "관리" → "삭제"

### 3. 시세 업데이트 및 히스토리 백필
- **수동 업데이트**: 대시보드의 "시세 업데이트" 버튼
- **자동 업데이트**: 앱 시작 시 오늘 업데이트하지 않았으면 자동 갱신
- **히스토리 백필**: 앱을 안 열었던 날의 시세는 실제 과거 종가로 자동 채움

### 4. CSV 대량 등록
1. 포트폴리오 탭 → "CSV 업로드" 버튼
2. CSV 파일 형식:
   ```
   ticker,exchange,name,quantity,purchasePrice,purchaseDate,currency
   005930,KRX,삼성전자,10,70000,2024-01-15,KRW
   AAPL,NASDAQ,애플,5,180,2024-02-01,USD
   ```
3. 파일 선택 후 미리보기 확인 → 등록

### 5. 추가매수
1. 보유 종목의 "관리" → "매수" 클릭
2. 매수일자, 매수가, 매수 수량 입력
3. 예상 매수금액, 변경 후 평균단가 실시간 미리보기
4. 확인 시 가중평균 단가 자동 계산 및 메모에 이력 기재

### 6. 리밸런싱 목표 설정
1. 대시보드 탭 → 리밸런싱 섹션
2. 자산군별 목표 비중(%) 설정
3. 목표 총 자산 금액 설정 (선택)
4. 현재 평가액과 목표 금액의 차이를 계산하여 매수/매도 가이드 제공

### 7. 차트 MA 오버레이
1. 포트폴리오 테이블에서 종목의 차트 아이콘 클릭
2. MA 토글 칩으로 이동평균선 표시/숨김 선택 (MA5/10/20/60/120/200)
3. 기본 활성: MA20 (빨강), MA60 (파랑)
4. 현금(CASH) 자산은 MA 토글 숨김

---

## 핵심 로직 개요

> 상세 코드 및 의존관계는 [RULES.md](./RULES.md) 참조

### 시세 조회 흐름
```
자산 목록
    │
    ├─ 암호화폐 (Upbit/Bithumb 또는 한글거래소+암호화폐)
    │   └─ Cloud Run /upbit → Upbit API (KRW 가격)
    │
    └─ 주식/ETF/해외주식
        └─ Cloud Run / → FinanceDataReader
    │
    └─ 결과 병합 → UI 반영
```
- **분기 기준**: `exchange`가 Upbit/Bithumb이거나, 한글 거래소명 + 암호화폐 카테고리
- **병렬 조회**: 암호화폐와 일반 자산을 동시에 조회하여 성능 최적화
- **청크 처리**: API 제한으로 20개씩 나누어 요청

### 환율 적용 방식
| 구분 | 적용 환율 | 용도 |
|------|----------|------|
| **현재가** | 대시보드 실시간 환율 | 현재 평가액 계산 |
| **매수가** | 구매 당시 환율 (`purchaseExchangeRate`) | 수익률 계산 |
| **폴백** | 현재 환율 | 구매 환율 없는 기존 자산 |

- 자산 추가 시 해당 날짜의 환율이 자동 저장됨
- 대시보드와 손익 차트의 수익률이 동일한 기준으로 계산됨

### Google Drive 동기화
1. **저장**: 변경 발생 → 2초 디바운스 → LZ-String 압축 → Google Drive 업로드
2. **로드**: Google Drive 다운로드 → 압축 해제 → 데이터 마이그레이션 → 상태 반영
3. **토큰 갱신**: 만료 5분 전 자동 갱신
4. **공유 폴더**: 다른 계정과 동일 데이터 공유 가능 (`drive` scope 사용)

### 히스토리 백필 + 종가 교정
앱을 안 열었던 날의 데이터를 **실제 과거 종가**로 채우고, 기존 스냅샷도 교정:
1. 앱 시작 시 누락된 날짜 범위 감지
2. 주식/ETF: `/history` 엔드포인트로 과거 시세 조회
3. 암호화폐: `/upbit/history` 엔드포인트로 과거 시세 조회
4. **기존 스냅샷 교정**: 장중 업데이트로 기록된 가격을 실제 종가로 소급 교정 (오늘 제외)
5. **폴백**: API 실패 또는 90일 초과 시 마지막 데이터 복사 (보간)

### 차트 (종가 기반 + MA 오버레이)
- **데이터 소스**: 차트를 열면 MA 여부와 무관하게 항상 `/history` API에서 실제 종가를 조회 (장중가 스냅샷 오염 방지)
- **MA 계산**: 프론트엔드에서 SMA(단순이동평균) 계산 (`utils/maCalculations.ts`)
- **폴백**: ticker 없는 자산(현금 등)은 PortfolioSnapshot 기반
- **캐시**: 모듈 레벨 캐시 (TTL 10분)로 중복 API 호출 방지
- **설정 저장**: localStorage에 MA 토글 상태 저장

---

## 프로젝트 구조

```
asset-manager/
├── components/           # React 컴포넌트
│   ├── common/          # 공용 컴포넌트 (Toggle, Tooltip)
│   ├── dashboard/       # 대시보드 전용 컴포넌트
│   ├── layouts/         # 탭별 뷰 (Dashboard, Portfolio, Analytics, Watchlist)
│   └── portfolio-table/ # 포트폴리오 테이블 컴포넌트
├── hooks/               # 커스텀 훅 (데이터, 시세, 액션 관리)
├── services/            # 외부 API 연동 (시세, Google Drive, Gemini)
├── utils/               # 유틸리티 함수 (계산, 마이그레이션)
├── types/               # TypeScript 타입 정의
├── contexts/            # React Context (전역 상태)
├── constants/           # 상수 정의
├── App.tsx              # 메인 애플리케이션
└── index.tsx            # 애플리케이션 진입점
```

> **상세 파일별 책임 및 의존관계**: [RULES.md](./RULES.md) 참조

---

## Cloud Run 서버 엔드포인트

| 경로 | 메서드 | 설명 |
|------|--------|------|
| `/` | POST | 주식/ETF 시세 조회 (FinanceDataReader) |
| `/upbit` | POST | 암호화폐 시세 조회 (Upbit API 프록시) |
| `/history` | POST | 주식/ETF 과거 시세 (백필용) |
| `/upbit/history` | POST | 암호화폐 과거 시세 (백필용) |
| `/exchange-rate` | POST | 환율 조회 (현재/과거) |

---

## 배포 가이드

### 개발 서버 실행
```bash
npm run dev
```

### 프로덕션 빌드
```bash
npm run build
```

### GitHub Pages 배포
```bash
npm run deploy
```

### Cloud Run 배포
```bash
cd cloud-run
gcloud run deploy asset-manager \
  --source . \
  --region asia-northeast3 \
  --allow-unauthenticated
```

---

## 환경 변수 설정

### 필수 환경 변수 (.env.local)
```env
VITE_GOOGLE_CLIENT_ID=your_google_client_id
```

### 빌드 설정 (vite.config.ts)
```typescript
base: '/asset-manager/'  // GitHub Pages 경로
```

### Google Cloud Console 설정
1. OAuth 2.0 클라이언트 ID 생성
2. 승인된 리디렉션 URI 설정:
   - 개발: `http://localhost:5173`
   - 프로덕션: `https://your-username.github.io/asset-manager`
3. 필요한 API 활성화:
   - Google Drive API
   - Google OAuth 2.0

---

## 주요 변경 이력

> 전체 변경 이력: [CHANGELOG.md](./CHANGELOG.md)

### 최근 변경사항

| 날짜 | 변경 내용 |
|------|----------|
| 2026-02-08 | 스마트 필터 UI 개선 (그리드 레이아웃, 필터 도움말 모달), 툴팁 가독성 개선, 컬럼 설명 보강 |
| 2026-02-08 | 스마트 필터 기능 추가 (MA/RSI/신호/수익률 기반 필터링), 매도 알림을 스마트 필터에 통합 |
| 2026-02-07 | 차트 종가 기반 통일, 백필 스냅샷 교정, 어제대비 계산 수정 |
| 2026-02-05 | 차트 MA 오버레이 기능 추가 (MA5~MA200) |
| 2026-02-02 | 포트폴리오 테이블 툴팁 기능 추가 |
| 2026-02-02 | 히스토리 백필(Backfill) 기능 구현 |
| 2026-02-02 | 환율 조회를 Gemini API에서 Cloud Run으로 이전 |
| 2026-01-31 | Google Drive 저장 최적화 (LZ-String 압축) |
| 2026-01-30 | Google Drive 공유 폴더 지원 추가 |
| 2026-01-28 | 보유 종목 추가매수 기능 추가 |
| 2026-01-27 | 매도 알림 설정 영구 저장 |
| 2026-01-19 | 매도 자산 통계 및 수익률 계산 개선 |
| 2026-01-15 | 리밸런싱 목표 금액 저장 기능 추가 |

---

## 개발 문서

- **개발 규칙 및 의존관계**: [RULES.md](./RULES.md)
  - 파일/폴더별 책임 범위
  - 의존관계 매핑
  - 핵심 로직 상세
  - 수정 시 체크리스트
  - 확장 가이드
- **전체 변경 이력**: [CHANGELOG.md](./CHANGELOG.md)
