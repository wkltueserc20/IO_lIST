interface Props {
  onAddSend: () => void;
  onAddReceive: () => void;
}

export function EmptyDeviceGuide({ onAddSend, onAddReceive }: Props) {
  return (
    <div className="empty-device-guide">
      <div className="empty-device-guide__icon">📋</div>
      <div className="empty-device-guide__title">尚無 IO 點位</div>
      <div className="empty-device-guide__desc">選擇要新增的 IO 類型開始建立</div>
      <div className="empty-device-guide__actions">
        <button className="empty-device-guide__btn" onClick={onAddSend}>
          ＋ 新增發送 IO
        </button>
        <button className="empty-device-guide__btn" onClick={onAddReceive}>
          ＋ 新增接受 IO
        </button>
      </div>
    </div>
  );
}
