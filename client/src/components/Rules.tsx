import { useEffect } from 'react';

/** 게임 방법 - 홈/대기실/게임 중 어디서든 아래에서 올라오는 시트로 열어봄 */
export function RulesSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="게임 방법" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>게임 방법</h2>
          <button className="icon-button" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <ol className="rules-steps">
          <li>
            <b>카드 내기</b> 내 차례가 되면 카드 더미를 <b>위로 밀어서</b> 한 장 내요. 새로 내면 이전 카드는 덮여요.
          </li>
          <li>
            <b>과일 세기</b> 모두가 지금 보이는 카드에서 <b>같은 과일</b>끼리 개수를 더해요.
          </li>
          <li>
            <b>종 치기</b> 어떤 과일이든 합이 정확히 <b>5</b>가 되면 가운데 종을 먼저 쳐요. 깔린 카드를 전부 가져가고 다음
            차례는 내가 시작해요.
          </li>
          <li>
            <b>잘못 치면</b> 다른 사람들에게 내 카드를 한 장씩 나눠줘요.
          </li>
          <li>
            <b>카드가 떨어지면</b> 내 차례에 2초 동안 종 칠 기회가 있고, 못 가져오면 탈락이에요.
          </li>
          <li>
            <b>승리</b> 카드를 모두 모으거나 혼자 남으면 이겨요!
          </li>
        </ol>
        <p className="rules-tip">💡 PC에서는 스페이스 = 종, ↑ = 카드 내기</p>
        <button className="gate-button" onClick={onClose}>
          알겠어요
        </button>
      </div>
    </div>
  );
}
