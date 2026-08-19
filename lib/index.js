// dsh-workspace-api —— DSH 插件版 workspace 内容 + agent 任务 API
// 与 GUI 同端口（3080），前缀 /workspace-api/*
// 端点：GET /workspace-api/（信息） /workspaces /list /tree /search /read /raw
//      POST /workspace-api/task（提交 agent 任务） GET /workspace-api/task /task/<id>
// 环境变量：TOKEN（可选鉴权） TASK_TIMEOUT_MS（默认300000） DSH_BIN（dsh 路径）
import { readdir, readFile, stat, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

const inject = ["webServer", "workspaceRegistry", "systemPrompt"];

const PREFIX = "/workspace-api";
const SKIP_DIRS = new Set(["node_modules", ".git", ".cache", "dist", "build", "__pycache__"]);
const TOKEN = process.env.TOKEN ?? "";
const TASK_TIMEOUT_MS = Number(process.env.TASK_TIMEOUT_MS ?? 300000);
const TASK_MAX_QUEUE = Number(process.env.TASK_MAX_QUEUE ?? 20);
const MAX_READ_BYTES = Number(process.env.MAX_READ_BYTES ?? 65536);
const DSH_BIN = process.env.DSH_BIN ?? "dsh"; // 默认走 PATH，可用 DSH_BIN 环境变量指定

/* ---------- 工具 ---------- */
function normalizeForPrefix(value) {
	const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function isPathInside(root, child) {
	if (root === "" || child === "") return false;
	const nr = normalizeForPrefix(root);
	const nc = normalizeForPrefix(child);
	if (nc === nr) return true;
	return nc.startsWith(nr + "/");
}
function json(res, code, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(code, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body),
		"access-control-allow-origin": "*",
		"access-control-allow-headers": "authorization, content-type",
		"access-control-allow-methods": "GET, POST, OPTIONS",
		"cache-control": "no-store",
	});
	res.end(body);
}
function fail(res, code, message) {
	json(res, code, { ok: false, error: message });
}
async function entryInfo(abs, name, withSize = true) {
	const st = await stat(abs).catch(() => null);
	if (!st) return null;
	return {
		name,
		type: st.isDirectory() ? "dir" : st.isFile() ? "file" : st.isSymbolicLink() ? "link" : "other",
		...(withSize && st.isFile() ? { size: st.size } : {}),
		mtime: st.mtime.toISOString(),
	};
}
function sniffMimeType(bytes) {
	if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return "image/png";
	if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
	if (bytes.length >= 6 && bytes.subarray(0, 6).toString("ascii") === "GIF87a") return "image/gif";
	if (bytes.length >= 6 && bytes.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
	if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
}

/* ---------- 工作区 ---------- */
async function workspaceList(ctx) {
	const list = ctx.workspaceRegistry.list().map((w) => ({
		path: w.path,
		title: w.title ?? "",
	}));
	return list;
}
async function currentWorkspace(ctx) {
	const list = await workspaceList(ctx);
	return list.length > 0 ? list[0].path : join(homedir(), "Documents");
}
async function gateWorkspace(ctx, root) {
	let canonical;
	try { canonical = await realpath(root); } catch { return null; }
	const list = ctx.workspaceRegistry.list();
	for (const w of list) if (isPathInside(w.path, canonical)) return canonical;
	return null;
}
async function guardPath(root, rel) {
	const candidate = resolve(root, rel ?? ".");
	const real = await realpath(candidate).catch(() => null);
	if (real === null) return { error: "路径不存在" };
	const rootReal = await realpath(root);
	if (real !== rootReal && !real.startsWith(rootReal + sep)) return { error: "路径超出工作区范围" };
	return { real };
}

/* ---------- 任务队列 ---------- */
const taskQueue = [];
const tasks = new Map();
let workerRunning = false;
function runHeadless(prompt, cwd, timeoutMs) {
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(DSH_BIN, ["--profile", "headless", prompt], {
				cwd, env: { ...process.env, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (e) {
			resolve({ code: -1, stdout: "", stderr: String(e?.message ?? e) });
			return;
		}
		let stdout = "", stderr = "";
		child.stdout.on("data", (d) => { stdout += d; });
		child.stderr.on("data", (d) => { stderr += d; });
		const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* noop */ } }, timeoutMs);
		child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
		child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e?.message ?? e) }); });
	});
}
async function runWorker() {
	if (workerRunning) return;
	workerRunning = true;
	while (taskQueue.length > 0) {
		const task = taskQueue.shift();
		task.status = "running";
		task.startedAt = new Date().toISOString();
		const r = await runHeadless(task.prompt, task.workspace, task.timeoutMs);
		task.status = "done";
		task.finishedAt = new Date().toISOString();
		task.exitCode = r.code;
		task.result = r.stdout.trim();
		task.error = r.code === 0 ? "" : (r.stderr.trim() || `进程退出码 ${r.code}`);
		for (const waiter of task.waiters ?? []) waiter(task);
		task.waiters = [];
	}
	workerRunning = false;
}
function enqueueTask(body, wsPath) {
	const prompt = String(body?.prompt ?? "").trim();
	if (!prompt) return { error: "缺少 prompt" };
	if (taskQueue.length >= TASK_MAX_QUEUE) return { error: "任务队列已满" };
	const task = {
		id: randomUUID(),
		prompt,
		workspace: wsPath,
		timeoutMs: Math.min(Math.max(Number(body?.timeoutMs ?? TASK_TIMEOUT_MS), 30000), 1800000),
		status: "queued",
		createdAt: new Date().toISOString(),
		startedAt: null, finishedAt: null, exitCode: null, result: null, error: "",
		waiters: [],
	};
	tasks.set(task.id, task);
	taskQueue.push(task);
	runWorker();
	return { task };
}
async function readJsonBody(req, cap = 1048576) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		total += chunk.length;
		if (total > cap) throw new Error("请求体过大");
		chunks.push(chunk);
	}
	if (total === 0) return {};
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/* ---------- 各端点 ---------- */
async function handleList(ctx, params, root) {
	const rel = params.get("path") ?? ".";
	const depth = Math.min(Number(params.get("depth") ?? 1), 8);
	const g = await guardPath(root, rel);
	if (g.error) return { error: g.error };
	const st = await stat(g.real);
	if (!st.isDirectory()) return { error: "不是目录" };
	const items = await readdir(g.real, { withFileTypes: true });
	const entries = [];
	for (const ent of items) {
		if (SKIP_DIRS.has(ent.name)) continue;
		const info = await entryInfo(join(g.real, ent.name), ent.name);
		if (info) entries.push(info);
	}
	entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
	return { root, path: rel, depth, count: entries.length, entries };
}
async function handleTree(ctx, params, root) {
	const rel = params.get("path") ?? ".";
	const depth = Math.min(Number(params.get("depth") ?? 3), 8);
	const g = await guardPath(root, rel);
	if (g.error) return { error: g.error };
	async function walk(dir, level) {
		const out = [];
		const items = await readdir(dir, { withFileTypes: true });
		for (const ent of items) {
			if (SKIP_DIRS.has(ent.name)) continue;
			const abs = join(dir, ent.name);
			const info = await entryInfo(abs, ent.name, false);
			if (!info) continue;
			if (info.type === "dir" && level < depth) info.children = await walk(abs, level + 1).catch(() => []);
			out.push(info);
		}
		out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
		return out;
	}
	return { root, path: rel, depth, tree: await walk(g.real, 1) };
}
async function handleSearch(ctx, params, root) {
	const q = (params.get("q") ?? "").toLowerCase();
	if (!q) return { error: "缺少 q 参数" };
	const rel = params.get("path") ?? ".";
	const limit = Math.min(Number(params.get("limit") ?? 200), 500);
	const g = await guardPath(root, rel);
	if (g.error) return { error: g.error };
	const hits = [];
	async function walk(dir, level) {
		if (hits.length >= limit || level > 8) return;
		const items = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const ent of items) {
			if (SKIP_DIRS.has(ent.name)) continue;
			const abs = join(dir, ent.name);
			if (ent.name.toLowerCase().includes(q)) {
				const info = await entryInfo(abs, ent.name);
				if (info) hits.push({ ...info, path: abs.slice(g.real.length + 1) });
				if (hits.length >= limit) return;
			}
			if (ent.isDirectory()) await walk(abs, level + 1);
		}
	}
	await walk(g.real, 1);
	return { root, query: q, count: hits.length, results: hits };
}
async function handleRead(ctx, params, root, res) {
	const rel = params.get("path") ?? "";
	if (!rel) return { error: "缺少 path 参数" };
	const maxBytes = Math.min(Number(params.get("maxBytes") ?? MAX_READ_BYTES), 1048576);
	const g = await guardPath(root, rel);
	if (g.error) return { error: g.error };
	const st = await stat(g.real);
	if (st.isDirectory()) return { error: "这是目录，请用 /list" };
	const data = await readFile(g.real);
	const isBinary = data.subarray(0, 8192).includes(0);
	if (params.get("format") === "text" && !isBinary) {
		const text = data.toString("utf8").slice(0, maxBytes);
		res.writeHead(200, {
			"content-type": "text/plain; charset=utf-8",
			"content-length": Buffer.byteLength(text),
			"access-control-allow-origin": "*",
		});
		res.end(text);
		return { __sent: true };
	}
	if (isBinary) {
		return {
			binary: true, size: st.size, name: rel.split("/").pop(),
			sha256: createHash("sha256").update(data).digest("hex"),
			hint: "二进制文件，用 /raw 可下载原始字节",
		};
	}
	const truncated = data.length > maxBytes;
	return { path: rel, size: st.size, bytes: data.length, truncated, content: data.toString("utf8").slice(0, maxBytes) };
}
async function handleRaw(ctx, params, root, res) {
	const rel = params.get("path") ?? "";
	const g = await guardPath(root, rel);
	if (g.error) return fail(res, 400, g.error);
	const st = await stat(g.real);
	if (st.isDirectory()) return fail(res, 400, "这是目录");
	const data = await readFile(g.real);
	const mime = params.get("mime") ?? sniffMimeType(data) ?? "application/octet-stream";
	res.writeHead(200, {
		"content-type": mime,
		"content-length": data.length,
		"content-disposition": `attachment; filename="${rel.split("/").pop()}"`,
		"access-control-allow-origin": "*",
	});
	res.end(data);
}

/* ---------- 路由 ---------- */
function makeHandler(ctx) {
	return async (req, res) => {
		try {
			if (TOKEN) {
				const ok =
					req.headers.authorization === `Bearer ${TOKEN}` ||
					new URL(req.url ?? "/", "http://x").searchParams.get("token") === TOKEN;
				if (!ok) return fail(res, 401, "未授权：需要 Bearer token");
			}
			if (req.method === "OPTIONS") {
				res.writeHead(204, {
					"access-control-allow-origin": "*",
					"access-control-allow-headers": "authorization, content-type",
					"access-control-allow-methods": "GET, POST, OPTIONS",
				});
				return res.end();
			}
			const url = new URL(req.url ?? "/", "http://x");
			const path = url.pathname.replace(/\/+$/, "");
			const params = url.searchParams;
			if (!(path === PREFIX || path.startsWith(PREFIX + "/"))) return fail(res, 404, "未知端点");
			const root = await currentWorkspace(ctx);

			if (path === PREFIX || path === PREFIX + "/healthz") {
				return json(res, 200, {
					ok: true, service: "dsh-workspace-api", version: "1.0.0",
					time: new Date().toISOString(),
					currentWorkspace: root,
					workspaces: await workspaceList(ctx),
					taskApi: ["POST /workspace-api/task", "GET /workspace-api/task", "GET /workspace-api/task/<id>"],
				});
			}
			if (path === PREFIX + "/workspaces") {
				return json(res, 200, { ok: true, workspaces: await workspaceList(ctx) });
			}
			if (path === PREFIX + "/list") {
				const data = await handleList(ctx, params, root);
				return data.error ? fail(res, 400, data.error) : json(res, 200, { ok: true, data });
			}
			if (path === PREFIX + "/tree") {
				const data = await handleTree(ctx, params, root);
				return data.error ? fail(res, 400, data.error) : json(res, 200, { ok: true, data });
			}
			if (path === PREFIX + "/search") {
				const data = await handleSearch(ctx, params, root);
				return data.error ? fail(res, 400, data.error) : json(res, 200, { ok: true, data });
			}
			if (path === PREFIX + "/read") {
				const data = await handleRead(ctx, params, root, res);
				if (data.__sent) return;
				return data.error ? fail(res, 400, data.error) : json(res, 200, { ok: true, data });
			}
			if (path === PREFIX + "/raw") {
				return handleRaw(ctx, params, root, res);
			}
			if (path === PREFIX + "/task") {
				if (req.method === "POST") {
					let body;
					try { body = await readJsonBody(req); } catch (e) { return fail(res, 400, "请求体无效: " + e.message); }
					const ws = body?.workspace ? await gateWorkspace(ctx, body.workspace) : root;
					if (!ws) return fail(res, 400, "workspace 不在已注册工作区列表中");
					const made = enqueueTask(body, ws);
					if (made.error) return fail(res, 400, made.error);
					const t = made.task;
					if (params.get("wait") === "1" || params.get("wait") === "true") {
						if (t.status === "done") return json(res, 200, { ok: true, task: t });
						await new Promise((resolveWait) => t.waiters.push(resolveWait));
						return json(res, 200, { ok: true, task: tasks.get(t.id) });
					}
					return json(res, 202, { ok: true, taskId: t.id, status: t.status });
				}
				return json(res, 200, {
					ok: true,
					tasks: [...tasks.values()].map((t) => ({ id: t.id, status: t.status, prompt: t.prompt.slice(0, 80), createdAt: t.createdAt, finishedAt: t.finishedAt })),
				});
			}
			const taskMatch = /^\/workspace-api\/task\/([^/]+)$/.exec(path);
			if (taskMatch) {
				const t = tasks.get(decodeURIComponent(taskMatch[1]));
				if (!t) return fail(res, 404, "任务不存在");
				return json(res, 200, { ok: true, task: t });
			}
			return fail(res, 404, `未知端点 ${path}`);
		} catch (e) {
			return fail(res, 500, `服务器错误: ${e?.message ?? String(e)}`);
		}
	};
}

/* ---------- 插件定义 ---------- */
const GUIDANCE = "本机已安装 dsh-workspace-api 插件：把 workspace 内容与 DSH agent 任务能力暴露为 HTTP API（前缀 /workspace-api，与 GUI 同端口）。端点：GET /workspace-api/（信息） /workspaces /list /tree /search /read /raw；POST /workspace-api/task 提交自然语言任务（body: {prompt, workspace?, timeoutMs?}，?wait=1 同步等待），GET /workspace-api/task/<id> 轮询。用户提到「workspace API / 任务 API / 让其他程序调用 dsh」时即指本插件。";

function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: PREFIX,
		handler: makeHandler(ctx),
	}), "dsh-workspace-api: /workspace-api routes");
	ctx.effect(() => ctx.systemPrompt.section({
		name: "plugin:dsh-workspace-api",
		order: 215,
		text: GUIDANCE,
	}), "dsh-workspace-api: prompt section");
}

export { GUIDANCE, apply, inject };
