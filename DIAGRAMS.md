# 다이어그램 (유저 히스토리 / 좌석 상태)

서비스 동작을 시각화한 UML. **렌더 방법:** 아래 `mermaid` 블록을
[mermaid.live](https://mermaid.live) 에 붙여넣거나, GitHub 마크다운에서 그대로 보면 그림으로 렌더됨.

> 반영 기준: `migrations/010`(1인 최대 4좌석), `migrations/011`(HOLD 종료 시 핀 삭제) 포함.
> 체크아웃은 아직 미구현(계획)이라 점선 의미로 표기.

---

## 1. 유저 히스토리 (활동 다이어그램)

사용자가 시간 순으로 걷는 경로 + 패널티/만료 분기.

```mermaid
flowchart TD
    Start([시작]) --> Auth[회원가입 / 로그인]
    Auth --> View[좌석 목록 조회]
    View --> Pick[빈 좌석 선택]
    Pick --> Blocked{차단된 사용자인가?}
    Blocked -->|예| Reject1[예약 거절 · 패널티 제한]
    Blocked -->|아니오| HasHold{활성 선점이 4개인가?}
    HasHold -->|예| Reject2[예약 거절 · 최대 4개]
    HasHold -->|아니오| Avail{좌석이 비어있나?}
    Avail -->|아니오| Reject3[예약 거절 · 이미 선점됨]
    Avail -->|예| Hold[좌석 HOLD<br/>10분 타이머 + 핀코드 발급]
    Hold --> Decision{10분 안에 무엇을?}
    Decision -->|키오스크 핀 인증| Confirm[좌석 확정 OCCUPIED]
    Decision -->|자발적 취소 0~5분| Cancel0[취소 · 패널티 없음]
    Decision -->|자발적 취소 5~10분| Cancel1[취소 · 패널티 1점]
    Decision -->|미도착 10분 초과| Expire[자동 만료 · 패널티 2점]
    Confirm --> Eat[식사]
    Eat --> Checkout[체크아웃<br/>계획 · 미구현]
    Cancel1 --> PenaltyCheck{누적 3점 이상?}
    Expire --> PenaltyCheck
    PenaltyCheck -->|예| Block[7일 예약 차단]
    PenaltyCheck -->|아니오| End([종료])
    Cancel0 --> End
    Checkout --> End
    Block --> End
```

---

## 2. 좌석 상태 다이어그램

좌석(seat)의 상태 전이. HOLD를 벗어나면 핀이 자동 삭제됨(011 트리거).

```mermaid
stateDiagram-v2
    [*] --> AVAILABLE
    AVAILABLE --> HOLD: 좌석 선점 (10분 타이머 + 핀 발급)
    HOLD --> OCCUPIED: 키오스크 핀 인증 성공
    HOLD --> AVAILABLE: 자발적 취소 (0~5분 패널티0 / 5~10분 1점)
    HOLD --> AVAILABLE: 10분 경과 자동 만료 (패널티 2점)
    OCCUPIED --> AVAILABLE: 체크아웃 (계획 · 미구현)
    note right of HOLD
        HOLD를 벗어나면 pin_code 자동 삭제(NULL)
        — migrations/011 트리거
    end note
    note right of OCCUPIED
        현재는 종착 상태 (체크아웃 추가 예정)
    end note
```

---

## 참고: 예약(reservation) 상태

좌석 상태와 별개로 예약 레코드는 4가지 상태를 가짐:
`HOLD`(선점 중) → `OCCUPIED`(확정) / `CANCELLED`(취소) / `EXPIRED`(만료).
좌석은 취소·만료 시 `AVAILABLE`로 돌아가고, 예약 레코드는 이력으로 남음.
