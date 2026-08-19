# dsh-workspace-api

> Expose your DeepSeek Harness workspace as an HTTP API — browse, search and read files, and let an agent answer natural-language questions about your documents. Works right on the DSH web GUI's own port (3080), no extra process needed.

[![npm version](https://img.shields.io/npm/v/dsh-workspace-api)](https://www.npmjs.com/package/dsh-workspace-api)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)

---

## Features

- **Workspace content API** — list directories, build trees, search filenames, read text files, download raw files — all as JSON over HTTP.
- **Agent task API** — submit a natural-language task (e.g. "find how contract fee is imported in the Ams project"), and a fresh DSH headless agent searches your workspace and returns the answer with sources.
- **Same port as the GUI** — routes mount on the running web server as /workspace-api/*; nothing extra to install or daemonize.
- **Workspace-gated** — every path is realpath-checked against the registered workspace roots; path traversal is rejected.
- **CORS-enabled, token-ready** — call from browser or CLI; optional TOKEN bearer auth for untrusted networks.
- **Zero runtime dependencies** — plain Node built-ins (the dsh CLI does the heavy lifting).

---

## Installation

Install into your DSH profile:

```bash
dsh plugin --profile web add dsh-workspace-api
```

Then restart `dsh web`. The API is live at:

```
http://127.0.0.1:3080/workspace-api/
```

### From GitHub (pre-npm)

```bash
dsh plugin --profile web add github:<owner>/dsh-workspace-api
```

### Local development

```bash
dsh plugin --profile web add link:/path/to/dsh-workspace-api
```

---

## Quick start

```bash
B="http://127.0.0.1:3080/workspace-api"

# Service info & registered workspaces
curl "$B/"

# List a directory
curl "$B/list?path=projects&depth=1"

# Search filenames
curl "$B/search?q=contract&path=projects/Ams"

# Read a text file (JSON)
curl "$B/read?path=README.md"

# Read as plain text
curl "$B/read?path=README.md&format=text"

# Ask the agent a question about your documents (synchronous)
curl -X POST -H "Content-Type: application/json" \
  -d '{"prompt":"Based on the docs in projects/企业文档-demo, what is the annual leave policy?","timeoutMs":180000}' \
  "$B/task?wait=1"
```

---

## API reference

All responses use the envelope `{"ok": true, "data": ...}` / `{"ok": false, "error": "..."}`.
All endpoints accept `GET`; `/task` also accepts `POST`. CORS headers are included on every response.

### GET /  · GET /healthz

Service info, current workspace, registered workspace list, and task-API availability.

### GET /workspaces

The registered workspaces (from DSH's workspaceRegistry — dynamic, not a config file).

### GET /list

List one directory level.

| param | default | notes |
|---|---|---|
| path | . | relative to the workspace root |
| depth | 1 | reserved for future use (max 8) |

Response entries: {name, type: dir|file|link, size?, mtime}.

### GET /tree

Nested directory tree. path (default .), depth (default 3, max 8).

### GET /search

Filename substring search (case-insensitive, skips node_modules/.git/etc).

| param | default | notes |
|---|---|---|
| q | — | required |
| path | . | search root |
| limit | 200 | max 500 |

### GET /read

Read a file's text content (auto-detects binary; capped).

| param | default | notes |
|---|---|---|
| path | — | required, relative |
| maxBytes | 65536 | max 1048576 |
| format=text | — | returns text/plain instead of JSON |

Binary files return {binary: true, size, sha256, hint}.

### GET /raw

Stream the raw bytes of a file. path (required), optional mime.

### POST /task — agent tasks

Ask a DSH headless agent to do work in the workspace (search code, answer questions about documents, etc.).

Request body (JSON):

| field | required | notes |
|---|---|---|
| prompt | yes | the natural-language task |
| workspace | — | must be a registered workspace; defaults to the current one |
| timeoutMs | — | 30s – 30min; default TASK_TIMEOUT_MS (300s) |

**Async** — returns immediately with a task id:

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"prompt":"Find how contract fee is imported in projects/Ams"}' \
  "$B/task"
# {"ok":true,"taskId":"...","status":"queued"}
```

**Poll** the result:

```bash
curl "$B/task/<taskId>"
# {"ok":true,"task":{"status":"done","result":"...","exitCode":0,"error":""}}
```

**Synchronous** — block until the agent finishes (?wait=1):

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"prompt":"1+1=?","timeoutMs":120000}' \
  "$B/task?wait=1"
```

> Tasks run in a FIFO queue (single worker). Simple questions answer in ~3–5s; code-search/document-QA tasks typically take 1–3 minutes.

---

## Configuration

Environment variables (inherited by the dsh web process):

| variable | default | description |
|---|---|---|
| TOKEN | (empty) | when set, require Authorization: Bearer <token> or ?token=<token> |
| TASK_TIMEOUT_MS | 300000 | default per-task timeout |
| TASK_MAX_QUEUE | 20 | max queued tasks |
| MAX_READ_BYTES | 65536 | text-read cap |
| WORKSPACE_API_ROOT | (current workspace) | serve a specific folder instead of the current workspace |
| DSH_BIN | dsh | path to the dsh CLI (defaults to PATH) |

Example:

```bash
TOKEN=my-secret TASK_TIMEOUT_MS=600000 dsh web
```

---

## Root directory selection

By default the API serves the **current workspace** (the first registered workspace). You can pin it to a specific folder instead:

```bash
# Serve ONLY this folder (still keeps registered workspaces usable via ?root=)
WORKSPACE_API_ROOT=/srv/company-docs dsh web
```

Every endpoint also accepts a per-request `?root=<path>` override. Allowed roots are:

- the configured `WORKSPACE_API_ROOT` (when set), and
- any **registered workspace** (from the DSH workspace registry).

Anything else — e.g. `/etc` or arbitrary host paths — is rejected (400). The effective root is reported by `GET /` as `currentWorkspace`, and `GET /workspaces` lists `WORKSPACE_API_ROOT` first when set.

```bash
# Serve a specific folder for one request
curl "$B/list?root=/srv/company-docs&depth=1"

# Task in a specific registered workspace
curl -X POST -H "Content-Type: application/json" \
  -d '{"prompt":"...","workspace":"/srv/company-docs"}' "$B/task?wait=1"
```

## Security

- The web server binds 127.0.0.1 by default; a 0.0.0.0 bind is a deliberate network exposure.
- **Path guard**: every requested path is canonicalized (realpath) and must resolve inside a registered workspace — traversal like ../../etc is rejected.
- **Task agents have full DSH capabilities.** Only expose the API to trusted callers; **always set TOKEN** when serving beyond localhost.
- Text reads are size-capped; binary sniffing avoids leaking huge blobs.

---

## How it works

dsh-workspace-api is a Cordis "bare plugin" (exports {apply, inject}) that:

1. Injects webServer, workspaceRegistry and systemPrompt;
2. Registers the /workspace-api prefix route on the shared web server;
3. Uses the workspace registry for the gate and for the live workspace list;
4. For tasks, spawns "dsh --profile headless <prompt>" (cwd = workspace), captures the final answer, and returns it.

```
Client app --HTTP--> /workspace-api/*   (same port as the GUI)
                        | POST /task (FIFO queue, single worker)
                        v
               dsh --profile headless "<prompt>"   (fresh agent, cwd = workspace)
                        v
               {"status":"done","result":"...","exitCode":0}
```

---

## Development & publishing

```bash
# Syntax check
node --check lib/index.js

# Local install for testing
dsh plugin --profile web add link:$PWD

# Publish to npm
npm login
npm publish

# Bump a patch release
npm version patch && npm publish
```

**Contributing to the ecosystem** — after pushing to GitHub, add the topics:

- dsh-plugin
- deepseek-harness

Community marketplaces (Oh-My-DSH, dsh-plugins-store, awesome-dsh-plugin, ...) auto-discover repos with the dsh-plugin topic.

---

## Limitations

- **Search-based, not embedding-based**: the agent locates answers by searching/reading files. Great for tens to low hundreds of documents; for very large corpora with cryptic filenames, consider adding a RAG/vector layer.
- **One task at a time** (FIFO queue).
- Each task is a **fresh agent session** — no conversation memory across calls.
- Scanned PDFs / image-only documents need OCR before they are searchable.

---

## License

MIT

---

## 中文快速上手

把企业文档放进工作区（如 ~/Documents 下任意子目录），用户即可通过 GUI 或任务 API 提问：

```bash
B="http://127.0.0.1:3080/workspace-api"
# 提交任务并等待结果
curl -X POST -H "Content-Type: application/json" \
  -d '{"prompt":"根据企业文档，酒店住宿报销上限是多少？","timeoutMs":180000}' \
  "$B/task?wait=1"
```

- 端点一览：/  /workspaces  /list  /tree  /search  /read  /raw  /task
- 环境变量：TOKEN（鉴权） TASK_TIMEOUT_MS（任务超时） DSH_BIN（dsh 路径） WORKSPACE_API_ROOT（指定根目录，默认当前工作区；每请求可 ?root= 覆盖）
- 对外提供务必配置 TOKEN；任务 agent 拥有 DSH 完整能力，仅限可信调用方
