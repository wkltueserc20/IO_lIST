interface Props {
  conflictCount: number;
  onClick: () => void;
}

export function ConflictBadge({ conflictCount, onClick }: Props) {
  if (conflictCount === 0) return null;
  return (
    <button className="conflict-badge" onClick={onClick}>
      ⚠ {conflictCount} 個地址衝突
    </button>
  );
}
