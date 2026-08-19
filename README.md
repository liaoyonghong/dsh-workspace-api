# dsh-workspace-api · Enterprise Knowledge Q&A Agent / 企业信息查询 Agent

> **Turn your enterprise documents into a conversational chatbot.** Put contracts, handbooks, policies and specs into a folder; employees or applications ask questions in plain language, and an AI agent reads your documents and answers with cited sources.
> **把企业文档变成可以对话的聊天机器人**：把合同、手册、制度、规范等文档放进一个文件夹，员工或应用系统就能用自然语言提问，AI 代理会查阅文档、给出带出处的回答。

[![npm version](https://img.shields.io/npm/v/dsh-workspace-api)](https://www.npmjs.com/package/dsh-workspace-api)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-liaoyonghong%2Fdsh--workspace--api-blue)](https://github.com/liaoyonghong/dsh-workspace-api)

---

## What is this? / 这是什么？

An **out-of-the-box enterprise knowledge Q&A robot**. No index building, no vector database, no coding —
一个**开箱即用的企业知识问答机器人**。不需要建索引、不需要向量库、不需要写代码——

1. **Add documents** / 放文档：put enterprise docs (contracts, employee handbooks, reimbursement policies, IT policies, product specs...) into a folder
2. **Ask** / 提问：employees or internal systems ask in natural language, e.g. "How does annual leave work?" / 「年假怎么算？」
3. **Answer** / 回答：the AI agent reads your documents on the spot and answers **with cited sources** (which file, which line) / 现场查阅你的文档，给出准确回答并注明出处

Use cases: internal knowledge base Q&A, contract clause lookup, policy Q&A, system operation guides, onboarding assistance.
适用于：内部知识库问答、合同条款查询、制度答疑、系统操作说明、入职培训辅助等场景。

---

## How to use (for ordinary users) / 普通用户怎么用

### Option 1: ask directly in the DSH chat / 方式一：直接在 DSH 聊天界面问

Just ask in the DSH Web UI, e.g. / 在 DSH Web 界面直接提问即可，例如：

> "According to the enterprise documents, what is the annual leave policy?" / 「根据企业文档，员工的年假政策是什么？」

### Option 2: via internal apps / chat UIs / web bots / 方式二：通过内部应用 / 聊天界面 / 网页机器人问

Any enterprise system, office software or web chat box can integrate. To the consumer it is just a "one question, one answer" conversation endpoint:
企业系统、办公软件、网页聊天框都可以接入。对使用方来说，就是一个「问一句、答一句」的对话接口：

```bash
# ask a question (wait for the answer) / 问一个问题（等待回答）
curl -X POST -H "Content-Type: application/json" \
  -d '{"prompt":"根据企业文档，酒店住宿报销上限是多少？"}' \
  "http://127.0.0.1:3080/workspace-api/task?wait=1"
```

Sample response / 返回示例：

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

### Real Q&A results (tested) / 典型问答效果（实测）

With 3 sample documents, answers returned within 10 seconds / 放 3 份示例文档，10 秒内返回：

| Question / 提问 | Answer / 回答 |
|---|---|
| 员工的年假政策是什么？ | 入职满一年 12 天，之后每年 +1，上限 20 天（出处：员工手册.txt） |
| 酒店住宿报销上限？ | 标准间每晚上限 HK$1200（出处：报销政策.md 第 3 行） |
| 密码多久更换一次？ | 每 90 天更换，至少 12 位（出处：IT安全规范.txt 第 2 行） |

---

## Deployment (for admins) / 管理员怎么部署

### Install / 安装

```bash
dsh plugin --profile web add dsh-workspace-api
```

Restart `dsh web` to activate / 重启 `dsh web` 后即生效。

### Set the document folder / 指定企业文档目录

Defaults to the current DSH workspace; a dedicated folder is recommended / 默认使用 DSH 当前工作区；推荐专门指定一个文档目录：

```bash
WORKSPACE_API_ROOT=/srv/company-docs dsh web
```

> Put contracts, handbooks etc. into this folder (txt / md / PDF / Word / Excel supported); employees can then ask the bot.
> 把合同、手册等文档放到这个目录（支持 txt / md / PDF / Word / Excel），员工就能向机器人提问了。
> Scanned PDFs must be OCR'd to text first / 扫描版 PDF 需先转成文字（OCR），AI 才能检索。

### Expose it / 对外提供服务

```bash
TOKEN=your-secret-token dsh web
```

Callers must send the token / 调用方需带令牌：

```bash
curl -H "Authorization: Bearer your-secret-token" \
  "http://127.0.0.1:3080/workspace-api/task?wait=1" \
  -d '{"prompt":"..."}'
```

---

## API Reference (for developers) / 面向开发者：API 参考

Served on the DSH GUI's own port (default 127.0.0.1:3080), prefix `/workspace-api`.
服务运行在 DSH 同端口（默认 127.0.0.1:3080），前缀 `/workspace-api`。
Every response uses `{"ok": true, "data": ...}` / `{"ok": false, "error": ...}`; CORS enabled.
所有响应统一为 `{"ok": true, "data": ...}` / `{"ok": false, "error": ...}`；已开启 CORS。

### Endpoints / 常用端点

| Endpoint / 端点 | Purpose / 用途 |
|---|---|
| `GET /` · `/healthz` | service status, current query folder / 服务状态、当前查询目录 |
| `GET /workspaces` | queryable folder list / 可查询的目录列表 |
| `GET /list?path=&depth=` | list directory / 列出目录内容 |
| `GET /tree?path=.&depth=3` | directory tree / 目录树 |
| `GET /search?q=` | filename search / 按文件名搜索 |
| `GET /read?path=&format=text` | read file content / 读取文件内容 |
| `GET /raw?path=` | download raw file / 下载原始文件 |
| `POST /task` | **ask a natural-language question, agent handles it** / **提交自然语言问题，AI 代理处理** |
| `GET /task/<id>` | check task result / 查询任务结果 |

### The question endpoint (core) / 提问接口（核心）

```bash
# async: returns a task id immediately / 异步提交：立即返回任务号
curl -X POST -H "Content-Type: application/json" \
  -d '{"prompt":"在 projects/Ams 里找导入 contract fee 的方法","timeoutMs":600000}' \
  "http://127.0.0.1:3080/workspace-api/task"
# → {"ok":true,"taskId":"...","status":"queued"}

# poll / 轮询结果
curl "http://127.0.0.1:3080/workspace-api/task/<taskId>"

# or synchronous (?wait=1) / 或同步等待
curl -X POST -H "Content-Type: application/json" \
  -d '{"prompt":"1+1=?","timeoutMs":120000}' \
  "http://127.0.0.1:3080/workspace-api/task?wait=1"
```

Request body / 请求体字段：

| field / 字段 | required / 必填 | notes / 说明 |
|---|---|---|
| `prompt` | yes / ✅ | the natural-language question / 自然语言问题/任务 |
| `workspace` | — | target folder (registered workspace or `WORKSPACE_API_ROOT`) / 指定查询目录（须为已注册工作区或 `WORKSPACE_API_ROOT`） |
| `timeoutMs` | — | 30s–30min, default 300s / 超时（30s–30min，默认 300s） |

> Simple Q&A: ~3–5s. Code/document search: usually 1–3 min. Tasks run in a FIFO queue (single worker).
> 简单问答约 3–5 秒；代码检索/文档问答通常 1–3 分钟。任务按队列顺序执行（单并发）。

### Configuration / 配置项

| env var / 环境变量 | default / 默认 | description / 说明 |
|---|---|---|
| `WORKSPACE_API_ROOT` | current workspace / 当前工作区 | document root the bot queries / 机器人查询的文档根目录 |
| `TOKEN` | none / 无 | bearer auth, recommended when exposed / 访问令牌（Bearer 或 `?token=`），建议对外必配 |
| `TASK_TIMEOUT_MS` | 300000 | per-task timeout / 单任务超时 |
| `TASK_MAX_QUEUE` | 20 | queue cap / 队列上限 |
| `MAX_READ_BYTES` | 65536 | text read cap / 文本读取上限 |
| `DSH_BIN` | `dsh` | path to the dsh CLI / dsh 命令路径 |

---

## Security / 安全说明

- Loopback-only by default; always set `TOKEN` when exposing beyond localhost / 默认仅监听 127.0.0.1；对外开放请务必配置 `TOKEN`
- Every path is realpath-checked against `WORKSPACE_API_ROOT` or registered workspaces; `../../etc`-style traversal is rejected / 所有路径经真实路径校验，只能访问 `WORKSPACE_API_ROOT` 或已注册工作区，`../../etc` 之类一律拒绝
- Task agents have full DSH file capabilities; only expose to trusted callers / 任务代理拥有 DSH 完整文件能力，仅限可信调用方使用

---

## How it works / 工作原理（简述）

```
employee / app --natural-language question--> /workspace-api/task
                                              | FIFO queue (single worker)
                                              v
                  dsh --profile headless "question" (fresh agent, cwd = docs folder)
                                              | on-the-spot search + reading
                                              v
                {"status":"done","result":"answer with cited sources"}
```

- Based on **on-the-spot agent search**; no index needed; best for tens to low-hundreds of documents / 基于 AI 代理现场检索，无需预建索引；文档少（几十份内）效果最佳
- Each question is a fresh session; no cross-question memory / 每次提问是全新会话，无跨问题记忆
- For very large corpora consider adding RAG / vector retrieval / 超大语料（上千份、文件名混乱）建议叠加 RAG 向量检索

---

## Development & Publishing / 开发与发布

```bash
node --check lib/index.js                # syntax check / 语法检查
dsh plugin --profile web add link:$PWD   # local debug install / 本地调试安装
npm login && npm publish                 # publish to npm / 发布到 npm
```

After pushing to GitHub, add topics / 推送到 GitHub 后请添加 topic：`dsh-plugin`、`deepseek-harness`（社区市场会自动收录）。

---

## License / 许可

MIT
