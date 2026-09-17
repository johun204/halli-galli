// 종이 언제 울릴지 알려주는 힌트는 일부러 없음 - 판단은 플레이어의 몫
export function Bell({ onRing }: { onRing: () => void }) {
  function handlePress() {
    if (navigator.vibrate) navigator.vibrate(30);
    onRing();
  }
  return (
    <button className="bell" onPointerDown={handlePress}>
      🔔
    </button>
  );
}
