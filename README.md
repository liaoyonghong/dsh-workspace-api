# dsh-workspace-api · 企业信息查询 Agent

> **把企业文档变成可以对话的聊天机器人**：把合同、手册、制度、规范等文档放进一个文件夹，员工或应用系统就能用自然语言提问，AI 代理会查阅文档、给出带出处的回答。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)

---

## 这是什么？

一个**开箱即用的企业知识问答机器人**。不需要建索引、不需要向量库、不需要写代码——

1. **放文档**：把企业文档（合同、员工手册、报销制度、IT 规范、产品资料……）放进指定文件夹
2. **提问**：员工或内部系统用自然语言提问，例如「年假怎么算？」「酒店报销上限多少？」
3. **回答**：AI 代理现场查阅你的文档，给出准确回答，并**注明出处**（哪个文件、哪一行）

适用于：内部知识库问答、合同条款查询、制度答疑、系统操作说明、入职培训辅助等场景。

---

## 普通用户怎么用

### 方式一：直接在 DSH 聊天界面问

在 DSH Web 界面直接提问即可，例如：

> 「根据企业文档，员工的年假政策是什么？」

### 方式二：通过内部应用 / 聊天界面 / 网页机器人问

企业系统、办公软件、网页聊天框都可以接入。对使用方来说，就是一个「问一句、答一句」的对话接口：

```bash
# 问一个问题（等待回答）
curl -X POST -H "Content-Type: application/json" \
  -d '{"prompt":"根据企业文档，酒店住宿报销上限是多少？"}' \
  "http://127.0.0.1:3080/workspace-api/task?wait=1"
```

返回示例：

```json
{
  "ok": true,
  "task": {
    "status": "done",
    "result": "酒店报销上限：标准间每晚上限 HK$1200（出处：报销政策.md 第 3 行）",
    "exitCode": 0
  }
}
```

### 典型问答效果（实测）

放 3 份示例文档，10 秒内返回：

| 提问 | 回答 |
|---|---|
| 员工的年假政策是什么？ | 入职满一年 12 天，之后每年 +1，上限 20 天（出处：员工手册.txt） |
| 酒店住宿报销上限？ | 标准间每晚上限 HK$1200（出处：报销政策.md 第 3 行） |
| 密码多久更换一次？ | 每 90 天更换，至少 12 位（出处：IT安全规范.txt 第 2 行） |

---

## 管理员怎么部署

### 安装

```bash
dsh plugin --profile web add dsh-workspace-api
```

重启 `dsh web` 后即生效。

### 指定企业文档目录

默认使用 DSH 当前工作区；推荐专门指定一个文档目录：

```bash
# 把企业文档目录设为机器人查询范围
WORKSPACE_API_ROOT=/srv/company-docs dsh web
```

> 把合同、手册等文档放到这个目录（支持 txt / md / PDF / Word / Excel），员工就能向机器人提问了。
> 扫描版 PDF 需先转成文字（OCR），AI 才能检索。

### 对外提供服务

```bash
# 加上访问令牌，防止未授权使用（推荐）
TOKEN=your-secret-token dsh web
```

调用方需带令牌：

```bash
curl -H "Authorization: Bearer your-secret-token" \
  "http://127.0.0.1:3080/workspace-api/task?wait=1" \
  -d '{"prompt":"..."}'
```

---

## 面向开发者：API 参考

服务运行在 DSH 同端口（默认 127.0.0.1:3080），前缀 `/workspace-api`。
所有响应统一为 `{"ok": true, "data": ...}` / `{"ok": false, "error": ...}`；已开启 CORS。

### 常用端点

| 端点 | 用途 |
|---|---|
| `GET /` · `/healthz` | 服务状态、当前查询目录 |
| `GET /workspaces` | 可查询的目录列表 |
| `GET /list?path=&depth=` | 列出目录内容 |
| `GET /tree?path=.&depth=3` | 目录树 |
| `GET /search?q=` | 按文件名搜索 |
| `GET /read?path=&format=text` | 读取文件内容 |
| `GET /raw?path=` | 下载原始文件 |
| `POST /task` | **提交自然语言问题，AI 代理处理** |
| `GET /task/<id>` | 查询任务结果 |

### 提问接口（核心）

```bash
# 异步提交：立即返回任务号
curl -X POST -H "Content-Type: application/json" \
  -d '{"prompt":"在 projects/Ams 里找导入 contract fee 的方法","timeoutMs":600000}' \
  "http://127.0.0.1:3080/workspace-api/task"
# → {"ok":true,"taskId":"...","status":"queued"}

# 轮询结果
curl "http://127.0.0.1:3080/workspace-api/task/<taskId>"

# 或同步等待（?wait=1）
curl -X POST -H "Content-Type: application/json" \
  -d '{"prompt":"1+1=?","timeoutMs":120000}' \
  "http://127.0.0.1:3080/workspace-api/task?wait=1"
```

请求体字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `prompt` | ✅ | 自然语言问题/任务 |
| `workspace` | — | 指定查询目录（须为已注册工作区或 `WORKSPACE_API_ROOT`） |
| `timeoutMs` | — | 超时（30s–30min，默认 300s） |

> 简单问答约 3–5 秒；代码检索/文档问答通常 1–3 分钟。任务按队列顺序执行（单并发）。

### 配置项

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `WORKSPACE_API_ROOT` | 当前工作区 | 机器人查询的文档根目录 |
| `TOKEN` | 无 | 访问令牌（Bearer 或 `?token=`），建议对外必配 |
| `TASK_TIMEOUT_MS` | 300000 | 单任务超时 |
| `TASK_MAX_QUEUE` | 20 | 队列上限 |
| `MAX_READ_BYTES` | 65536 | 文本读取上限 |
| `DSH_BIN` | `dsh` | dsh 命令路径 |

---

## 安全说明

- 默认仅监听 127.0.0.1；对外开放请务必配置 `TOKEN`
- 所有路径经真实路径校验，只能访问 `WORKSPACE_API_ROOT` 或已注册工作区，`../../etc` 之类一律拒绝
- 任务代理拥有 DSH 完整文件能力，仅限可信调用方使用

---

## 工作原理（简述）

```
员工 / 应用系统 ──自然语言问题──▶ /workspace-api/task
                                    │ 队列（单并发）
                                    ▼
                      dsh --profile headless "问题"（全新 AI 代理，工作区=文档目录）
                                    │ 现场搜索 + 阅读文档
                                    ▼
                    {"status":"done","result":"带出处的回答"}
```

- 基于 **AI 代理现场检索**，无需预建索引；文档少（几十份内）效果最佳
- 每次提问是全新会话，无跨问题记忆
- 超大语料（上千份、文件名混乱）建议叠加 RAG 向量检索

---

## 开发与发布

```bash
node --check lib/index.js                # 语法检查
dsh plugin --profile web add link:$PWD   # 本地调试安装
npm login && npm publish                 # 发布到 npm
```

推送到 GitHub 后请添加 topic：`dsh-plugin`、`deepseek-harness`（社区市场会自动收录）。

---

## License

MIT
