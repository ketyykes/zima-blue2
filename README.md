# 浪 — Zima Blue 風格 60 秒動畫

一段向《愛 x 死 x 機器人》〈Zima Blue〉致敬的 60 秒短片：白色磁磚地面上仰躺的人，胸口亮起 Zima 藍，地面化為海，人沉入水中、化為浪花，最後畫面收束成白底上的一塊藍色方形。

- **畫面**：Three.js + 自訂 GLSL shader（天空、海面、人形消散、浪花粒子、後製）
- **聲音**：Web Audio API 即時生成的配樂，沒有任何音訊素材檔
- **可重現**：所有畫面與聲音參數都是「時間 t」的函式，因此瀏覽器即時播放與逐格算圖的結果一致

## 環境需求

| 項目 | 用途 | 備註 |
| --- | --- | --- |
| Node.js 20.19 以上 | 開發伺服器、算圖腳本 | Vite 8 的需求 |
| pnpm | 套件管理 | |
| Google Chrome | 算圖（Puppeteer 驅動） | 僅 `pnpm render` 需要 |
| ffmpeg | 合成 mp4 | 僅 `pnpm render` 需要，需在 `PATH` 中 |

## 快速開始

```bash
pnpm install
pnpm dev
```

開啟瀏覽器後點擊畫面開始播放（建議開啟聲音）。瀏覽器的自動播放政策要求使用者互動後才能啟動音訊，所以必須點擊。

### 網址參數

| 參數 | 說明 | 範例 |
| --- | --- | --- |
| `t` | 從指定秒數開始播放，方便調整某一段落 | `http://localhost:5173/?t=30` |
| `render` | 算圖模式，供 `scripts/render.mjs` 使用，一般不需手動加 | `?render=1` |

## 輸出影片

```bash
pnpm render                                   # → out/nami.mp4（1920x1080 / 30fps，含配樂）
pnpm render --fps 24 --scale 0.5              # 960x540 / 24fps，快速預覽
pnpm render --stills 10,30,50 --scale 0.5     # 只輸出指定秒數的截圖 → out/still-XX.jpg
pnpm render --chrome "/path/to/chrome"        # 指定 Chrome 執行檔
```

| 選項 | 預設值 | 說明 |
| --- | --- | --- |
| `--fps` | `30` | 影格率 |
| `--scale` | `1` | 解析度倍率（以 1920x1080 為基準） |
| `--stills` | — | 以逗號分隔的秒數；指定時只輸出截圖，不產生影片 |
| `--chrome` | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` | Chrome 執行檔路徑 |

算圖流程：

1. 以 Vite 啟動本機伺服器，Puppeteer 用無頭 Chrome 開啟 `?render=1`
2. 呼叫頁面上的 `window.__renderAudio()`，以 `OfflineAudioContext` 算出配樂並寫入 `out/score.wav`
3. 逐格呼叫 `window.__renderFrame(t)` 並截圖，透過管線直接送入 ffmpeg（H.264 / AAC）
4. 輸出 `out/nami.mp4`

> 啟動參數使用了 `--use-angle=metal`，是針對 macOS 的設定；在其他平台算圖時，請視情況調整 `scripts/render.mjs` 中的 Chrome 參數。

## 分鏡

| 秒數 | 畫面 | 字幕 |
| --- | --- | --- |
| 0–6 | 黑幕「浪」，淡入白色磁磚地面上仰躺的人（Zima 的泳池） | 浪 |
| 6–16 | 黎明暖光，初見的光景 | 終其一生，我都在想著初見的光景。 |
| 16–26 | 天色褪灰，凌晨、衰弱與枯槁 | 我無法忘記就在那天凌晨，／妳逐漸衰弱與枯槁的模樣，在最後遺落了時間。 |
| 26–36 | 胸口亮起 Zima 藍，悲傷沿身體擴散，地面從心臟處開始化為水 | 原來悲傷是實際存在的，／懸浮在那裡，胸口靠近心臟的位置。 |
| 36–46 | 人下沉、由腳至頭化為浪花粒子 | 我會不會在成為浪的時候，／離你比較近。 |
| 46–55 | 茫茫大海，遠方的方舟 | 祈禱哪一天我將漂流到你踐踏的浪花，／或是渡你曾經搭載的方舟。 |
| 55–60 | 鏡頭升起俯瞰，畫面收束成白底上的一塊 Zima 藍方形 | 隨波逐流，是最好的解套。 |

## 專案結構

```
.
├── index.html            # 畫布、字幕層、播放按鈕
├── scripts/
│   └── render.mjs        # Puppeteer 逐格截圖 → ffmpeg 合成
└── src/
    ├── main.js           # 場景建構、時間軸參數、字幕、每格更新、播放／算圖進入點
    ├── timeline.js       # 關鍵影格工具：numTrack、colorTrack、cameraTrack
    ├── shaders.js        # GLSL：天空、海面、人形、浪花粒子、接觸陰影、後製
    ├── audio.js          # 生成式配樂（長音和弦、心跳、海浪、鐘聲）
    └── style.css         # 字幕與播放按鈕樣式
```

## 運作方式

### 時間軸

`src/timeline.js` 提供三種關鍵影格軌道，皆以 easeInOutSine 內插：

- `numTrack([[秒數, 數值], ...])`：數值，例如太陽仰角、海浪振幅、消散程度
- `colorTrack([[秒數, '#hex'], ...])`：顏色，例如天頂與地平線色
- `cameraTrack([{ t, pos, target }, ...])`：攝影機路徑，以 Catmull-Rom 曲線串接，並疊加微幅手持晃動

`src/main.js` 的 `update(t)` 會依時間 t 設定所有 uniform、物件位置與字幕透明度。因為不依賴上一格的狀態，任何時間點都能單獨重現，這也是 `?t=` 與逐格算圖得以成立的原因。

### 主要效果

- **地面化為海**：海面 shader 以 `uSpread` 控制從心臟位置向外擴散的水域半徑，`uWaveAmp` / `uRippleAmp` 控制浪與漣漪
- **悲傷擴散**：人形 shader 以 `uHeart` / `uHeartSpread` 讓 Zima 藍從胸口沿身體蔓延
- **化為浪花**：從人形網格取樣 9000 個粒子，依位置安排由腳至頭依序飛散
- **後製**：Bloom、底片顆粒、暗角、黑幕淡入淡出，以及結尾的方框收束

### 配樂

`src/audio.js` 的 `scheduleScore()` 依同一條 60 秒時間軸排程所有聲音，同一份編排同時供兩種情境使用：

- 即時播放：`AudioContext`，並以音訊時鐘驅動畫面，確保音畫同步
- 離線算圖：`OfflineAudioContext` 輸出 WAV

和弦進行為 Am → F → Dm → Asus2 → C → Am(add9)，段落間交叉淡入淡出。

> 注意：海浪雜訊與殘響使用 `Math.random()` 產生，浪花粒子的分布也是隨機的，因此每次算圖在細節上會有些微差異。

## 調整建議

- 修改段落時間或節奏：調整 `src/main.js` 中「時間軸」區塊的各條 track
- 修改字幕：編輯 `src/main.js` 的 `CUES` 陣列（`tone` 為 `light` / `dark`，對應淺色或深色背景）
- 修改主色：`src/main.js` 開頭的 `ZIMA`、`ZIMA_LIGHT`、`DEEP`、`PAPER`
- 修改海浪形狀：需同時修改 `src/shaders.js` 的 `waves()` 與 `src/main.js` 的 `waveHeight()`，兩者必須一致，方舟才會正確漂浮在浪上
- 調整時可搭配 `?t=秒數` 直接跳到該段落，或用 `pnpm render --stills` 快速輸出截圖檢查
