# 設備通訊 IO 對照表

設備 IO 點位與主系統點位的對照管理工具，支援多設備、多表格、類 Excel 操作介面。

## 功能

- **多設備管理** — 側邊欄新增／刪除設備，每台設備各有發送與接受 IO 表
- **類 Excel 表格操作**
  - 單擊格子 → 選取（藍色框）
  - 再點一下或雙擊 → 進入編輯模式（顯示 input）
  - 拖曳多格 → 範圍選取
  - Ctrl+C / Ctrl+X / Ctrl+V → 複製 / 剪下 / 貼上（TSV 格式）
  - Delete → 清空選取格
  - Ctrl+Z → 復原
  - Escape → 取消選取或取消編輯
- **資料類型欄** — 下拉選單，可自訂資料類型清單
- **位址填充** — 拖曳格子右下角把手自動遞增填充位址
- **衝突偵測** — 主系統位址重複時標示警告
- **批次替換** — 支援完整比對或包含比對，可跨設備替換
- **排序** — 點擊欄標題可對位址欄排序（自然排序）
- **儲存／載入** — 匯出為 JSON 檔，支援 File System Access API

## 技術棧

- React 18 + TypeScript
- Vite
- Zustand（含 undo history）
- CSS（無 UI 框架）

## 開發

```bash
npm install
npm run dev
```

## 建置

```bash
npm run build
```
