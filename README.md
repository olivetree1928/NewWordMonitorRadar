# X 模型新词监控

每天扫描 Twitter/X 上的**模型厂商、SaaS 出海大 V、AI 资讯博主**，提取最新**视频模型 / 图片模型 / 世界模型**词，并与基线对比后列出新词。

## 本轮最新模型词（截至 2026-11-25）

### 视频模型
| 模型词 | 厂商 | 首见/发布 |
| --- | --- | --- |
| **Gemini Omni 1.2 Flash** | Google DeepMind | 2026-11-05 |
| **Kling 4.0** / Kling 4.0 Flash | 快手 | 2026-10-15 |
| **FLUX 3 Max** | fal × Black Forest Labs | 2026-10-19 |
| **Pika H3 Flex** | Pika | 2026-10-29 |
| MiniMax H3 MAX | MiniMax | 既有 |
| Wan 3.0 Prime | 阿里 | 既有 |
| Runway Gen-4.5 | Runway | 既有 |
| Grok Imagine | xAI | 既有 |

### 图片模型
| 模型词 | 厂商 | 首见/发布 |
| --- | --- | --- |
| **GPT Image 2.6**（Flare / Sunburst） | OpenAI | 2026-11-04 |
| **Seedream 5.5** | 字节 Seed | 2026-11-09 |
| **MiniMax H3-Image** | MiniMax（开源权重） | 2026-11-11 |
| Nano Banana 2.1 | Google | 既有 |
| FLUX 3 / FLUX 3 Klein | Black Forest Labs | 既有 |

### 世界模型
| 模型词 | 厂商 | 首见/发布 |
| --- | --- | --- |
| **Genie 4** (`genie-4`) | Google DeepMind | 宣布 10-27；Project Genie 11-18；API GA 11-19 |

> 说明：当前 Cursor 账号的 XSearch 不可用，首轮列表来自官方博客 / 发布汇总；配置 X API 后可每日从监控账号时间线自动抽新词。

## 快速开始

```powershell
cd e:\web_saas\tools\x_model_new_word_monitor
python -m pip install -r requirements.txt
copy .env.example .env
# 编辑 .env，填入 X_BEARER_TOKEN（Twitter Developer Portal → App → Bearer Token）

python main.py              # 扫 X + 出日报
python main.py --seed-only  # 仅出基线日报（无需 Token）
python serve.py             # 打开网页 http://127.0.0.1:8765
python -m src.tiktok_scanner  # 单独扫 TikTok 热词
```

- 模型新词页：http://127.0.0.1:8765/
- TikTok 热词页：http://127.0.0.1:8765/tiktok
- 谷歌趋势页：http://127.0.0.1:8765/trends
- Reddit 页：http://127.0.0.1:8765/reddit

```powershell
python -m src.google_trends_scanner   # 扫 Google Trends RSS
python -m src.reddit_scanner          # 扫 Reddit（需 OAuth）
```

Reddit 需在 `.env` 配置 `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`（[创建应用](https://www.reddit.com/prefs/apps)）。
Cloudflare：
```powershell
npx wrangler secret put REDDIT_CLIENT_ID
npx wrangler secret put REDDIT_CLIENT_SECRET
```

## Cloudflare Workers 部署

```powershell
npm install
npm run deploy
```

Worker 名：`new-word-monitor-radar`  
- https://new-word-monitor-radar.olivetree1928.workers.dev/
- https://new-word-monitor-radar.olivetree1928.workers.dev/tiktok
- https://new-word-monitor-radar.olivetree1928.workers.dev/trends
- https://new-word-monitor-radar.olivetree1928.workers.dev/reddit

报告输出：`data/reports/YYYY-MM-DD.md` 与 `data/reports/latest.md`  
网页读取：`data/reports/latest.json` · TikTok：`data/tiktok/latest.json`

### TikTok 能扫到什么？
| 类型 | 能否扫到 | 说明 |
| --- | --- | --- |
| AI 视频热点 | ✅ | 公开周榜（如 365 Elevator、Waiting On My Fries…） |
| 最热梗 | ✅ | 按日新增视频数的热梗榜 |
| 热门标签 | ⚠️ 部分 | 由热点派生 + AI 常青标签池；官方 Creative Center 完整榜需登录 |

## 每日自动跑

```powershell
# 管理员 PowerShell
.\scripts\register_daily_task.ps1
```

会注册 Windows 计划任务 `XModelNewWordMonitorDaily`，每天 09:00 执行。

## 配置

- `config/accounts.yaml` — 厂商 / SaaS 大 V / AI 博主 handle + 搜索词
- `config/known_models.yaml` — 已知模型基线（新词 = 推文提取 − 基线）
- 发现稳定新词后，把它补进 `known_models.yaml`，避免重复报警

## 监控账号（摘要）

- 厂商：OpenAI、GoogleDeepMind、xAI、Runway、Kling、Luma、Pika、BFL、MiniMax、Firefly、fal…
- SaaS 出海：levelsio、tibo_maker、MarcLou、dannypostma…
- 资讯大 V：rowancheung、mattshumer_、minchoi、kimmonismus、_akhaliq、simonw…