import type { PublicPlayer } from '../../../shared/types';

export function PlayerBadge({
  player,
  isMe,
  isTurn,
  serverNow,
}: {
  player: PublicPlayer;
  isMe: boolean;
  isTurn: boolean;
  serverNow: number;
}) {
  const active = player.lastActionAt !== null && serverNow - player.lastActionAt < 1200;
  return (
    <div className={`player-badge ${isTurn ? 'player-badge-turn' : ''} ${active ? 'player-badge-active' : ''}`}>
      <span className={`dot ${player.connected ? 'dot-on' : 'dot-off'}`} />
      <span className="player-badge-name">
        {player.name}
        {isMe ? ' (나)' : ''}
        {player.isHost ? ' 👑' : ''}
      </span>
      <span className="player-badge-cards">🂠 {player.cardCount}</span>
    </div>
  );
}
