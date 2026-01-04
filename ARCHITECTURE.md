# 아키텍처 문서 (Architecture Documentation)

이 문서는 프로젝트의 주요 훅(Hooks) 구조와 각 훅의 역할, 그리고 UI와의 연결 관계를 설명합니다. 리팩토링을 통해 비즈니스 로직과 UI가 분리되었으며, 각 훅은 단일 책임 원칙(SRP)에 따라 구성되었습니다.

## 1. 훅(Hooks) 구조 및 역할

### 핵심 데이터 관리 (Core Data Management)
| 훅 이름 | 파일 위치 | 역할 및 책임 |
|---------|-----------|--------------|
| `usePortfolioData` | `hooks/usePortfolioData.ts` | **Root Store 역할**.<br>- 앱의 핵심 상태(`assets`, `history`, `watchlist` 등)를 정의하고 관리합니다.<br>- 초기 데이터 로딩 및 상태 초기화를 담당합니다. |
| `useGoogleDriveSync` | `hooks/useGoogleDriveSync.ts` | **클라우드 동기화**.<br>- Google Drive API와 통신하여 파일 저장/불러오기를 수행합니다.<br>- 로그인/로그아웃 상태를 관리합니다. |

### 비즈니스 로직 및 계산 (Business Logic & Calculations)
| 훅 이름 | 파일 위치 | 역할 및 책임 |
|---------|-----------|--------------|
| `usePortfolioCalculator` | `hooks/usePortfolioCalculator.ts` | **순수 계산 로직**.<br>- 환율 변환 (`getValueInKRW`)<br>- 자산 수익률, 평가금액 계산 (`calculateAssetMetrics`)<br>- 전체 포트폴리오 통계 (`calculatePortfolioStats`)<br>- 매도 통계 및 알림 계산<br>- **특징**: UI나 상태에 의존하지 않는 순수 함수에 가까운 로직을 포함합니다. |
| `usePortfolioStats` | `hooks/usePortfolioStats.ts` | **통계 데이터 제공**.<br>- `usePortfolioCalculator`를 래핑하여 컴포넌트에서 쉽게 사용할 수 있는 통계 객체를 반환합니다.<br>- `PortfolioContext`를 통해 전역적으로 파생 데이터를 제공합니다. |
| `usePortfolioHistory` | `hooks/usePortfolioHistory.ts` | **히스토리 추적**.<br>- 자산 데이터 변경 시 일별 스냅샷을 생성하여 차트용 데이터를 관리합니다. |

### 데이터 조작 및 상호작용 (Interaction & Mutations)
| 훅 이름 | 파일 위치 | 역할 및 책임 |
|---------|-----------|--------------|
| `useAssetActions` | `hooks/useAssetActions.ts` | **사용자 액션 처리**.<br>- 자산 추가, 수정, 삭제, 매도 처리 로직을 담당합니다.<br>- 관심종목(Watchlist) 관리 및 CSV 일괄 업로드를 처리합니다. |
| `useMarketData` | `hooks/useMarketData.ts` | **외부 데이터 동기화**.<br>- 시세 API(Upbit, Cloud Run) 호출 및 데이터 갱신을 담당합니다.<br>- 환율 정보 업데이트 및 실패 처리를 관리합니다. |
| `usePortfolioExport` | `hooks/usePortfolioExport.ts` | **내보내기/가져오기**.<br>- JSON/CSV 파일 내보내기 및 JSON 파일 가져오기 기능을 제공합니다. |

---

## 2. 데이터 흐름 및 UI 연결 (Data Flow & UI Connection)

### 전체 구조 (Context Pattern)
애플리케이션은 `PortfolioContext`를 중심으로 데이터가 흐릅니다.

1.  **데이터 소스**: `usePortfolioData`가 상태를 보유합니다.
2.  **로직 주입**: `useMarketData`, `useAssetActions`, `usePortfolioStats` 등이 이 상태를 받아 로직을 수행합니다.
3.  **UI 제공**: `PortfolioProvider`가 이 모든 데이터와 함수를 묶어 하위 컴포넌트에 제공합니다.

### 주요 UI 컴포넌트 연결

#### 1. 대시보드 (`DashboardView.tsx`)
*   **연결**: `usePortfolioCalculator`를 직접 사용하여 뷰 전용 통계를 계산합니다.
*   **이유**: 대시보드는 필터링(예: "미국주식"만 보기)에 따라 동적으로 통계를 재계산해야 하므로, 전역 스토어의 값보다 계산 로직을 직접 사용하는 것이 효율적입니다.

#### 2. 포트폴리오 테이블 (`PortfolioTable.tsx`, `usePortfolioData.ts(local)`)
*   **연결**: `components/portfolio-table/usePortfolioData.ts`에서 `usePortfolioCalculator`의 `calculateAssetMetrics`를 사용합니다.
*   **역할**: 각 행(Row)에 표시될 원화 환산가, 수익률, 일간 변동폭 등을 계산하여 테이블에 주입합니다.

#### 3. 자산 추가/수정 모달 (`AddAssetForm.tsx`, `EditAssetModal.tsx`)
*   **연결**: `useAssetActions`의 `handleAddAsset`, `handleUpdateAsset` 함수를 호출합니다.
*   **흐름**: 사용자 입력 -> 유효성 검사 -> 훅 호출 -> 상태 업데이트 -> 자동 저장(Drive).

#### 4. 시세 갱신 버튼 (`Header.tsx`)
*   **연결**: `useMarketData`의 `handleRefreshAllPrices`를 호출합니다.
*   **흐름**: 버튼 클릭 -> API 호출 -> 상태(`assets`) 업데이트 -> `usePortfolioHistory` 감지 및 스냅샷 생성.

---

## 3. 리팩토링 가이드라인

향후 기능을 추가하거나 수정할 때 다음 규칙을 따르십시오.

1.  **계산 로직 변경 시**: `hooks/usePortfolioCalculator.ts`를 수정하세요. 모든 UI에 일관되게 반영됩니다.
2.  **데이터 구조 변경 시**: `hooks/usePortfolioData.ts`와 `types/index.ts`를 수정하세요.
3.  **외부 API 변경 시**: `services/` 폴더와 `hooks/useMarketData.ts`를 확인하세요.
4.  **UI 컴포넌트**: 로직을 직접 구현하지 말고, `hooks/`에서 제공하는 기능을 import하여 사용하세요.
