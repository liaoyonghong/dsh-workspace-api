# dsh-workspace-api（DSH 插件版）

把 workspace 内容 + DSH agent 任务能力暴露为 HTTP API，**与 GUI 同端口（3080）**，无需单独起服务。

## 安装

已通过 `dsh plugin --profile web add link:~/dsh/plugins/dsh-workspace-api` 装入 web profile（link 方式，改源码即生效，重启 dsh web 加载）。

## 安装（其他用户）

```bash
# 方式一：npm（发布后）
dsh plugin --profile web add dsh-workspace-api

# 方式二：GitHub（未发布 npm 前）
dsh plugin --profile web add github:<你的用户名>/dsh-workspace-api

# 方式三：本地 link（开发调试）
dsh plugin --profile web add link:/path/to/dsh-workspace-api
```

装完重启 `dsh web`，端点即在 `http://127.0.0.1:3080/workspace-api/*`。

## 发布贡献（作者用）

1. npm 发布：`npm login` → `npm publish`
2. GitHub：创建仓库、推送、添加 topic `dsh-plugin` + `deepseek-harness`
3. 可选：提交到 dsh-plugin-hub / awesome-dsh-plugin 等市场收录（见各仓库 README）


## 端点（前缀 /workspace-api）

| 端点 | 说明 |
|---|---|
| `GET /workspace-api/` | 服务信息 + 工作区列表 |
| `GET /workspace-api/workspaces` | 已注册工作区（来自 workspaceRegistry，动态） |
| `GET /workspace-api/list?path=&depth=` | 目录列表 |
| `GET /workspace-api/tree?path=.&depth=3` | 目录树 |
| `GET /workspace-api/search?q=` | 文件名搜索 |
| `GET /workspace-api/read?path=&format=text` | 读文件（文本/二进制识别） |
| `GET /workspace-api/raw?path=` | 下载原始文件 |
| `POST /workspace-api/task` | 提交 agent 任务 `{prompt, workspace?, timeoutMs?}`，返回 taskId |
| `POST /workspace-api/task?wait=1` | 同步等待结果 |
| `GET /workspace-api/task/<id>` | 轮询任务状态/结果 |

## 调用示例

```bash
B="http://127.0.0.1:3080/workspace-api"
curl $B/                                          # 信息
curl "$B/list?path=projects&depth=1"              # 列目录
curl -X POST -H "Content-Type: application/json" \
  -d '{"prompt":"在 projects/Ams 里找导入 contract fee 的方法"}' \
  "$B/task?wait=1"                                 # 提交任务并等待
```

## 配置（环境变量，随 dsh web 进程继承）

- `TOKEN`：可选 Bearer 鉴权（`Authorization: Bearer xxx` 或 `?token=xxx`）
- `TASK_TIMEOUT_MS`：任务超时，默认 300000（5 分钟）
- `TASK_MAX_QUEUE`：队列上限，默认 20
- `DSH_BIN`：dsh 可执行路径

## 安全

- 复用 GUI webserver（默认仅 127.0.0.1 loopback）
- 路径经 workspaceRegistry 门禁（只能访问已注册工作区）
- 任务 agent 拥有 DSH 完整能力，对外提供请务必配 TOKEN

## 源码结构

`lib/index.js` 单文件：exports `{apply, inject}`（Cordis bare plugin），inject webServer/workspaceRegistry/systemPrompt。
