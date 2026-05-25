# 設備通訊 IO 對照表

工業設備與主系統（PLC / SCADA）之間的 IO 點位對照管理工具。支援瀏覽器 Web App 與 Tauri 原生桌面應用兩種執行模式。

## 功能特色

### 設備管理
- 左側清單新增、刪除、選擇、重新命名（雙擊）、拖曳排序設備
- 每台設備獨立維護「發送 IO」與「接受 IO」兩張表
- 側邊欄顯示完整度進度條與 IP 狀態指示點
- 設備 IP / Port 設定，跨設備重複 IP 自動警示（同 IP 不同 Port 橘色警告、同 IP 同 Port 紅色衝突）

### IO 表格
| 欄位 | 說明 |
|------|------|
| 設備名稱 | 自動填入，唯讀 |
| 設備 IO 點位位址 | 可拖曳下拉填充（智慧遞增：DM0→DM1、DM0.0→DM0.1、MR0→MR1） |
| 訊號名稱 | 自由輸入 |
| 資料類型 | BOOL / UINT / INT / WORD / DWORD / FLOAT / STRING，可自訂新增 |
| 主系統點位位址 | 同樣支援拖曳下拉填充；重複位址自動黃色警示 |
| 備註 | 自由輸入 |

### 資料操作
- **欄位排序**：點擊表頭升冪/降冪/清除，支援自然排序（DM1 < DM2 < DM10）
- **只看完整**：只顯示已填寫「設備 IO 點位」與「訊號名稱」的列
- **完整行綠色背景**：一眼識別已完整填寫的資料行
- **類 Excel 複製貼上**：拖曳選取儲存格範圍 → Ctrl+C/X 複製/剪下 → Ctrl+V 貼上（支援跨設備、跨表格）
- **批量替換**：整批搜尋取代位址，支援完整比對或包含文字，範圍可選目前設備或全部設備
- **復原（Ctrl+Z）**：最多 50 步操作歷程

### 主系統視角
- Toolbar「🔀 主系統視角」按鈕，切換為以主系統點位為主軸的反向對照表
- 自動彙整所有設備所有完整 IO 行（需同時填寫主系統點位、設備點位、訊號名稱）
- 方向標籤：**← 接收**（設備 sendIO）/ **→ 發送**（設備 receiveIO），從主系統角度呈現
- 自然排序（KM9 < KM10 < KM100）
- 重複主系統點位整列橘色警告
- 點擊側邊欄設備自動切回設備視角

### 檔案存取

| 功能 | 瀏覽器模式 | 桌面應用模式 |
|------|-----------|------------|
| 開啟 | File System Access API / `<input>` fallback | 原生檔案對話框 |
| 存檔 | File System Access API | 直接覆寫路徑 |
| 另存新檔 | File System Access API / 下載 fallback | 原生儲存對話框 |
| 匯出 Excel | 一設備一 Sheet，含所有 IO 欄位 | 同左 |
| 最近開啟 | 不支援 | 原生選單，持久化至 AppData |
| 自動存檔 | 不支援 | 每 5 分鐘靜默存檔 |

### 桌面應用（Tauri）
- 原生 OS 選單列（檔案 / 編輯）
- 視窗標題同步顯示專案名稱與未存狀態（`● 專案名稱 - IO 設備通訊對照表`）
- 關閉視窗前原生確認對話框（有未存變更時）
- 雙擊 `.json` 檔案直接開啟並載入

### PLC 即時監控（桌面版限定）
- 設備清單點擊 **📡** 按鈕開始 / 停止監控，即時讀取 PLC IO 點位的實際值
- IO 表格即時顯示各點位的當前值，BOOL 顯示 ON/OFF，數值型顯示實際數值
- 支援 PLC 品牌：
  - **KEYENCE**：KV Upper-Link Protocol（KV-XLE02 / KV-EP21 / 內建乙太網路），預設 Port 8501
  - **三菱**：SLMP / MC Protocol 3E Frame（QnU / iQ-R / iQ-F），Binary / ASCII 兩種模式，預設 Port 502
- 資料類型支援：BOOL、INT（有符號 16 位元）、UINT / WORD（無符號 16 位元）、DWORD / UDINT（32 位元）、DINT（有符號 32 位元）、FLOAT（32 位元浮點）
- 設備需在編輯面板中設定 **IP 位址**、**Port** 及 **PLC 品牌** 才可啟用監控
- **連線池（Connection Pool）**：TCP 連線在 tick 之間複用，避免每次輪詢重建連線握手；三菱 Binary/ASCII 模式偵測結果同步快取，無需每次重新探測
- **批次地址讀取**：同一台設備內相鄰（間距 ≤ 4 words）的 Word 地址自動合併為單一 `RDS` / Batch Read 請求（最多 100 words），大幅減少 TCP round-trip 次數

## 快速開始

### 瀏覽器模式

```bash
cd app
npm install
npm run dev
```

開啟瀏覽器至 `http://localhost:5173`

### 桌面應用（開發模式）

```bash
# 在專案根目錄（含 src-tauri/）
npm install
npm run dev
```

需先安裝 [Rust toolchain](https://rustup.rs/)。

### 桌面應用（打包）

```bash
# 在專案根目錄
npm run build
# 輸出至 src-tauri/target/release/bundle/
```

## 鍵盤快捷鍵

| 操作 | 按鍵 |
|------|------|
| 複製 | Ctrl+C |
| 貼上 | Ctrl+V |
| 剪下 | Ctrl+X |
| 清除格子 | Del |
| 復原 | Ctrl+Z |
| 取消選取 | Esc |

## 技術架構

| 技術 | 用途 |
|------|------|
| React 19 + TypeScript | 前端框架 |
| Vite | 建置工具 |
| TanStack Table v8 | 可排序表格 |
| Zustand | 全域狀態管理 |
| SheetJS (xlsx) | Excel 匯出 |
| Tauri v2 + Rust | 桌面應用殼層 |
| tauri-plugin-dialog | 原生開檔/存檔對話框 |
| Rust TCP（純標準函式庫） | KEYENCE / 三菱 PLC 通訊 |

## 專案結構

```
├── app/                        # React 前端
│   └── src/
│       ├── components/
│       │   ├── IOTable/        # 表格元件（複製貼上、位址填充）
│       │   ├── MainSystemView/ # 主系統視角元件
│       │   ├── Sidebar/        # 設備清單（含拖曳排序）
│       │   ├── Toolbar.tsx     # 工具列
│       │   └── MainContent.tsx # 主內容區（視角切換）
│       ├── hooks/
│       │   └── useFileActions.ts  # 檔案操作邏輯（Tauri/瀏覽器雙路徑）
│       ├── store/
│       │   └── useProjectStore.ts # Zustand store
│       ├── utils/
│       │   ├── addressUtils.ts    # 位址解析、遞增、重複偵測
│       │   ├── fileUtils.ts       # 檔案讀寫、Excel 匯出
│       │   └── naturalSort.ts     # 自然排序、主系統視角聚合
│       └── types/index.ts
└── src-tauri/                  # Rust 後端
    ├── src/
    │   ├── lib.rs              # 指令（read_file/write_file）、原生選單、自動存檔
    │   └── plc/
    │       ├── mod.rs          # PLC 通訊介面（read_batch dispatch）
    │       ├── address.rs      # 位址解析（Bool/Word/BitInWord）
    │       ├── pool.rs         # TCP 連線池（KEYENCE / 三菱，含模式快取）
    │       ├── batch.rs        # 連續地址合併算法（build_word_groups / extract_value）
    │       ├── keyence.rs      # KEYENCE KV Upper-Link Protocol
    │       └── mitsubishi.rs   # 三菱 SLMP / MC Protocol 3E Frame
    └── tauri.conf.json         # 視窗設定、Bundle 設定
```
