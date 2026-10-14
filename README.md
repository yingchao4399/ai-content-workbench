# AI 内容工作台

第四节课作业项目：把 EasyInput 八键设备和 AI 创作动作连接到一个本地笔记工作台。支持笔记、AI 产品经理公众号文章、小说、诗歌、散文；创作和材料均保存到本机。

## 启动

- 开发运行：在本目录执行 `npm install`、`npm start`。
- Windows 打包：执行 `npm run package:win`，运行 `release/win-unpacked/AI 内容工作台.exe`。
- 当前新版打包在 `release-v4/win-unpacked/AI 内容工作台.exe`；运行时保留整个 `win-unpacked` 目录。使用中的旧窗口请先保存作品，再切换到新版。
- 数据位置：开发版在本目录 `data/`；打包版在用户文档目录 `AI内容工作台/`。修改 EasyInput 配置前，应用会备份原配置。

## 使用流程

1. 在“设置”选择 Codex 登录态，或填写 DeepSeek、Kimi、智谱、千问官方 API 的接口、模型和密钥。密钥由 Electron `safeStorage` 加密保存在本机。官方模型按钮读取模型列表。DeepSeek 当前返回 `deepseek-flash`（V4.1 Flash）和 `deepseek-v4-pro`（V4 Pro）；选择框也列出仍可调用的 `deepseek-v4-flash` 兼容名，它实际转到 V4.1 Flash。图片、视频、音频理解和转文字各有独立的模型、接口与密钥配置。
2. 新建作品，写想法或导入材料。材料库保存文件原件、可提取的原文、来源、分类和可选 Markdown 副本。公开网页可尝试提取；需要登录或限制访问的飞书、公众号、小红书页面可粘贴原文并保留链接。
3. 使用“搜集”生成选题卡。选中文字或按 `/` 选择续写，会得到三个候选版本；可选择一个插入或重新抽卡。选区续写接在选区末尾；`/` 在光标处续写，设置里可选参考前一段或前文全文。可限制总字数、段落数、每段字数。
4. 使用“整理”梳理选区或全文。检查事实与审稿备注后再归档 Markdown。未核实的信息会随归档保留。当前作品可在顶部点击“删除”，移入左侧“回收站”并随时恢复；归档 Markdown 文件仍保留。
5. “Skills 工作室”可手写或让 AI 起草 Skill，检查结构，保存草稿、安装、停用、打包 ZIP、导入 `SKILL.md`/ZIP，并用于适用文体的当前作品。精选参考 Skill 默认关闭，可逐篇勾选。

## 键入历史与硬件

- 撤销：`Ctrl+Z`；恢复：`Ctrl+Y` / `Ctrl+Shift+Z`；重复最近一次输入、粘贴或 AI 动作：`F4`。界面按钮也可操作。打字按短时间连续输入合并为一条记录；粘贴单独记录。历史保留最近 30 条。
- “设置 → EasyInput AI 键盘”可分别分配八个实体键。应用注册 `Ctrl+Alt+Shift+1…8`，EasyInput 需把实体键映射为相应组合键。写入配置前关闭 EasyInput，随后重启并让原程序同步设备。仅保存电脑侧配置不等于实体键通过。
- 设备同步后，可在同一设置页开启“八键检测”。检测期间按键只计数，不执行创作或修改；逐键短按，检查对应计数每次增加一次，再结束检测。此模式只能观察工作台收到的快捷键，连接方式与设备保存回执仍需另行核对。
- 2026-10-14 设备已通过 USB 枚举，EasyInput 显示同步成功；第二轮实体八键检测中每键各增加一次。KEY3 另在临时笔记上实际完成整理。检测截图和日志见 `artifacts/easyinput-hardware-check.*`；一周使用仍需按真实日期补录。

## 材料格式与能力

- 文档：PDF、DOCX、MD、TXT、HTML、JSON、CSV、ENEX；图片：PNG、JPEG、WebP、GIF、BMP；音视频：MP3、WAV、M4A、AAC、FLAC、OGG、WMA、MP4、MOV、MKV、WebM、AVI。
- 图片理解可配置支持视觉输入的模型；视频理解在千问 Omni 且文件足够小时直接输入视频，其余情况均匀抽取最多八帧并明确标注局限；音频理解使用千问 Omni 或兼容 `input_audio` 接口；转文字使用千问 ASR 或自定义 `/audio/transcriptions`。结果存入材料库，需人工核实。
- 依据官方接口说明：[DeepSeek Vision](https://api-docs.deepseek.com/guides/vision/)、[千问 Omni](https://help.aliyun.com/zh/model-studio/qwen-omni)、[千问 ASR](https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference)。模型能否处理某种输入，以所选服务商与模型实际响应为准。

## 验证

运行 `npm test`。界面联动可在 CDP 端口下运行 `node scripts/smoke-ui.cjs`、`node scripts/verify-editor-history.cjs`、`node scripts/verify-studio.cjs`、`node scripts/verify-v3-ui.cjs`。完整图文作业稿见 [提交报告](HOMEWORK-SUBMISSION.md)；技术验收明细见 [作业报告](HOMEWORK-REPORT.md)。

创作参考 Skills 的筛选依据与原始来源见 [Skills 来源](SKILL-SOURCES.md)。

打包版界面核验：关闭开发版以释放全局快捷键，使用独立测试数据目录和 `--remote-debugging-port=9228` 启动打包程序，再运行 `node scripts/verify-packaged.cjs`。脚本检查首页、八键注册、设置、材料库和 Skills 工作室。
