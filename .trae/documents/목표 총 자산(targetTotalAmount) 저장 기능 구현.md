# `targetTotalAmount` 저장 기능 구현 계획

## 변경 사항
1.  **데이터 구조 변경 (`types/index.ts`)**
    *   `AllocationTargets` 타입을 단순 객체(`Record<string, number>`)에서 `weights`와 `targetTotalAmount`를 포함하는 구조로 변경하여 목표 금액도 함께 저장할 수 있도록 합니다.
    *   `targetTotalAmount` 필드를 추가하여 사용자가 입력한 목표 총 자산을 저장합니다.

2.  **데이터 마이그레이션 및 로드 (`hooks/usePortfolioData.ts`)**
    *   Google Drive에서 데이터를 불러올 때, 기존 포맷(단순 가중치 객체)을 신규 포맷(`{ weights, targetTotalAmount }`)으로 자동 변환하는 로직을 추가합니다.

3.  **로직 수정 (`hooks/useRebalancing.ts`)**
    *   `allocationTargets` prop에서 `weights`와 `targetTotalAmount`를 분리하여 사용하도록 수정합니다.
    *   `handleSave` 함수에서 가중치뿐만 아니라 현재 설정된 `targetTotalAmount`도 함께 저장하도록 변경합니다.
    *   초기화 로직에서 저장된 `targetTotalAmount`가 있다면 이를 우선적으로 사용하도록 수정합니다.

4.  **UI 연동 확인 (`components/dashboard/RebalancingTable.tsx`)**
    *   변경된 훅 로직이 UI에 정상적으로 반영되는지 확인합니다.

## 파일 수정 목록
*   `types/index.ts`
*   `hooks/usePortfolioData.ts`
*   `hooks/useRebalancing.ts`
