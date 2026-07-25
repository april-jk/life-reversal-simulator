import { createServer } from 'node:http'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { z } from 'zod'

const port = Number(process.env.PORT || process.env.SERVER_PORT || 8787)
const sessionsDir = process.env.SESSIONS_DIR || join(process.cwd(), 'life-sessions')
const distDir = join(process.cwd(), 'dist')
const apiKey = process.env.ZHIPU_API_KEY
const model = process.env.ZHIPU_MODEL || 'glm-5'
const json = (response, status = 200) => response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
const assetTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const stamp = () => new Date().toISOString()
const dateStamp = () => stamp().slice(0, 10).replaceAll('-', '')

const branchSchema = z.object({ branches: z.array(z.object({ title: z.string().min(2), summary: z.string().min(8), time_offset: z.string().regex(/^\+\d+个月$/) })).min(1).max(3) })
const difficultySchema = z.object({ difficulties: z.array(z.object({ title: z.string().min(2), description: z.string().min(12), cause: z.string().min(8), frequency: z.enum(['high', 'medium']), impact: z.enum(['low', 'medium']), time_offset: z.string().regex(/^\+\d+个月$/) })).min(1).max(3) })
const situationSchema = z.object({ situations: z.array(z.object({ title: z.string().min(2), description: z.string().min(12), trend: z.enum(['better', 'worse', 'neutral']), time_offset: z.string().regex(/^\+\d+个月$/) })).min(1).max(3) })
const outcomeSchema = z.object({ outcome: z.object({ summary: z.string().min(20) }) })
const responseStrategySchema = z.object({ response: z.object({ text: z.string().min(12) }) })

function offsetMonths(offset) { return Number(offset?.match(/\d+/)?.[0] || 0) }
function labelFor(anchor, offset) {
  const date = new Date(`${anchor}T12:00:00`)
  date.setMonth(date.getMonth() + offsetMonths(offset))
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`
}
function brief(node) { return node.title.slice(0, 30) }
function ageFrom(question) { return Number(question.match(/(?:我现在|今年|目前)?\s*(\d{1,2})\s*岁/)?.[1]) || null }
function sessionPath(id) { return join(sessionsDir, id) }
function manifestPath(id) { return join(sessionPath(id), 'manifest.json') }
function nodePath(id, nodeId) { return join(sessionPath(id), 'nodes', `${nodeId}.json`) }
async function readManifest(id) {
  const manifest = JSON.parse(await readFile(manifestPath(id), 'utf8'))
  await Promise.all(manifest.nodes.filter((node) => node.type === 'response' && !node.detail).map(async (node) => {
    try { node.detail = (await readNode(id, node.id)).content.text } catch { /* Keep the index readable if an old node file is missing. */ }
  }))
  return manifest
}
async function writeManifest(id, manifest) { await writeFile(manifestPath(id), JSON.stringify(manifest, null, 2)) }
async function readNode(id, nodeId) { return JSON.parse(await readFile(nodePath(id, nodeId), 'utf8')) }
async function writeNode(id, node) { await writeFile(nodePath(id, node.id), JSON.stringify(node, null, 2)) }
function nextId(manifest) { return `n${String(manifest.nodes.length + 1).padStart(3, '0')}` }
function find(manifest, id) { const node = manifest.nodes.find((item) => item.id === id); if (!node) throw new Error('Node not found'); return node }

async function createNode(id, manifest, parent, data) {
  const nodeId = nextId(manifest)
  const parentFile = parent ? await readNode(id, parent.id) : null
  const pathSummary = parentFile ? [...parentFile.path_summary, { node: nodeId, type: data.type, brief: data.brief || data.title.slice(0, 30) }] : [{ node: nodeId, type: data.type, brief: data.brief || data.title.slice(0, 30) }]
  const record = { id: nodeId, parent: parent?.id || null, type: data.type, depth: data.depth, status: data.status || 'active', title: data.title, detail: data.detail, time_label: data.time_label, children: [], file: `nodes/${nodeId}.json` }
  const file = { id: nodeId, type: data.type, depth: data.depth, status: record.status, source: data.source, title: data.title, content: data.content || {}, path_summary: pathSummary, children: [], agent_meta: data.agentMeta }
  manifest.nodes.push(record)
  if (parent) { parent.children.push(nodeId); parentFile.children.push(nodeId); await writeNode(id, parentFile) }
  await writeNode(id, file)
  return record
}
async function retireDescendants(id, manifest, node) {
  for (const childId of node.children) {
    const child = find(manifest, childId)
    child.status = 'reversed'
    const file = await readNode(id, childId); file.status = 'reversed'; await writeNode(id, file)
    await retireDescendants(id, manifest, child)
  }
}
async function restoreSubtree(id, manifest, node) {
  node.status = 'active'
  const file = await readNode(id, node.id); file.status = 'active'; await writeNode(id, file)
  for (const childId of node.children) await restoreSubtree(id, manifest, find(manifest, childId))
}
async function preparePending(id, manifest, parent, type, depth, count) {
  for (let index = 0; index < count; index += 1) await createNode(id, manifest, parent, { type, depth, status: 'pending', title: '推演中…' })
}
async function listSessions() {
  await mkdir(sessionsDir, { recursive: true })
  const entries = await readdir(sessionsDir, { withFileTypes: true })
  const sessions = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    try { const manifest = await readManifest(entry.name); const root = find(manifest, manifest.root.node_id); return { session_id: manifest.session_id, created_at: manifest.created_at, title: root.title, node_count: manifest.nodes.length, pending_count: manifest.nodes.filter((node) => node.status === 'pending').length } } catch { return null }
  }))
  return sessions.filter(Boolean).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

function extractJson(content) { const match = content.match(/\{[\s\S]*\}/); if (!match) throw new Error('Model did not return JSON'); return JSON.parse(match[0]) }
async function ask(instruction, schema) {
  if (!apiKey) throw new Error('ZHIPU_API_KEY is not configured on the server')
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, messages: [{ role: 'system', content: '你是审慎的人生决策推演助手。只返回合法 JSON，不要 Markdown。' }, { role: 'user', content: instruction }], thinking: { type: 'enabled' }, temperature: 0.7, max_tokens: 4000 }) })
      if (!response.ok) throw new Error(`GLM request failed: ${response.status}`)
      return schema.parse(extractJson((await response.json()).choices?.[0]?.message?.content || ''))
    } catch (error) { lastError = error }
  }
  throw lastError
}
function prompt(kind, path, extra = '') {
  const context = JSON.stringify(path)
  const common = `合法上下文仅为：${context}。不得提及或推断任何其他分支。所有 time_offset 必须是相对根节点、格式 +N个月，且严格大于当前节点的时间偏移。${extra}`
  if (kind === 'branch') return `基于用户抉择生成 2 到 3 个可执行选择分支。${common}\n返回 {"branches":[{"title":"","summary":"","time_offset":"+N个月"}]}`
  if (kind === 'difficulty') return `为这条路径生成 ${extra || '3'} 个高频且具体、可应对的困难。至少 2 个 frequency=high，最多 1 个 medium；禁止极端事件。cause 必须是明确因果链。${common}\n返回 {"difficulties":[{"title":"","description":"","cause":"","frequency":"high","impact":"medium","time_offset":"+N个月"}]}`
  if (kind === 'situation') return `根据用户应对推演指定数量的后续局面，平衡呈现 better/worse/neutral 走向。${common}\n返回 {"situations":[{"title":"","description":"","trend":"neutral","time_offset":"+N个月"}]}`
  return `为该局面写一段 80 到 140 字的阶段性结语，客观、有行动感、不宿命化。${common}\n返回 {"outcome":{"summary":""}}`
}
async function generate(id, parentId, kind, count = 3, responseText = '') {
  const manifest = await readManifest(id); const parent = find(manifest, parentId); const parentFile = await readNode(id, parentId)
  try {
    let result
    if (kind === 'branch') result = await ask(prompt('branch', parentFile.path_summary), branchSchema)
    if (kind === 'difficulty') result = await ask(prompt('difficulty', parentFile.path_summary, count === 1 ? '1' : '3'), difficultySchema)
    if (kind === 'situation') result = await ask(prompt('situation', parentFile.path_summary, `用户的应对是：${responseText}。只生成 ${count} 个局面。`), situationSchema)
    if (kind === 'outcome') result = await ask(prompt('outcome', parentFile.path_summary), outcomeSchema)
    const items = kind === 'branch' ? result.branches : kind === 'difficulty' ? result.difficulties : kind === 'situation' ? result.situations : [result.outcome]
    // Other generation calls may have completed while this model request was in flight.
    // Re-read the manifest so this call cannot restore an older snapshot over them.
    const latestManifest = await readManifest(id); const latestParent = find(latestManifest, parentId)
    const pending = latestParent.children.map((childId) => find(latestManifest, childId)).filter((child) => child.status === 'pending' && child.type === (kind === 'branch' ? 'branch' : kind === 'difficulty' ? 'difficulty' : kind === 'situation' ? 'situation' : 'outcome'))
    for (const [index, item] of items.entries()) {
      const record = pending[index] || await createNode(id, latestManifest, latestParent, { type: kind === 'branch' ? 'branch' : kind === 'difficulty' ? 'difficulty' : kind === 'situation' ? 'situation' : 'outcome', depth: kind === 'branch' ? 1 : kind === 'difficulty' ? 2 : kind === 'situation' ? 3 : 4, status: 'pending', title: '推演中…' })
      const file = await readNode(id, record.id); const offset = item.time_offset || `+${offsetMonths(parentFile.content.time_offset) + 6}个月`; const content = kind === 'outcome' ? { summary: item.summary, time_label: labelFor(manifest.root.time_anchor, offset) } : { ...item, time_label: labelFor(manifest.root.time_anchor, offset) }
      Object.assign(record, { status: 'active', title: item.title || '阶段性结局', time_label: content.time_label }); Object.assign(file, { status: 'active', title: record.title, content, source: 'agent', agent_meta: { call: `${kind}_gen`, generated_at: stamp() } }); await writeNode(id, file)
    }
    await writeManifest(id, latestManifest)
  } catch (error) {
    const latest = await readManifest(id); for (const child of latest.nodes.filter((node) => node.parent === parentId && node.status === 'pending')) { child.status = 'error'; const file = await readNode(id, child.id); file.status = 'error'; file.content = { error: error.message }; await writeNode(id, file) } await writeManifest(id, latest)
  }
}
async function generateResponseStrategy(id, difficultyId) {
  const manifest = await readManifest(id); const difficulty = find(manifest, difficultyId); const difficultyFile = await readNode(id, difficultyId)
  const response = await createNode(id, manifest, difficulty, { type: 'response', depth: 2, status: 'pending', title: '正在生成应对策略…', source: 'agent' }); await writeManifest(id, manifest)
  try {
    const result = await ask(`基于这个困难和路径，提出一个具体、可执行、不过度承诺的应对策略。合法上下文仅为：${JSON.stringify(difficultyFile.path_summary)}。只返回 {"response":{"text":""}}`, responseStrategySchema)
    const latest = await readManifest(id); const latestResponse = find(latest, response.id); const responseFile = await readNode(id, response.id); Object.assign(latestResponse, { status: 'active', title: 'AI 建议的应对', detail: result.response.text }); Object.assign(responseFile, { status: 'active', title: 'AI 建议的应对', source: 'agent', content: { text: result.response.text }, agent_meta: { call: 'response_strategy_gen', generated_at: stamp() } }); await writeNode(id, responseFile); await preparePending(id, latest, latestResponse, 'situation', 3, 3); await writeManifest(id, latest); void generate(id, latestResponse.id, 'situation', 3, result.response.text)
  } catch (error) { const latest = await readManifest(id); const failed = find(latest, response.id); failed.status = 'error'; const file = await readNode(id, response.id); file.status = 'error'; file.content = { error: error.message }; await writeNode(id, file); await writeManifest(id, latest) }
}
async function createSession(question) {
  const id = `life-session-${dateStamp()}-${Math.random().toString(36).slice(2, 6)}`; const anchor = stamp().slice(0, 10); const manifest = { session_id: id, created_at: stamp(), root: { node_id: 'n001', time_anchor: anchor, age_anchor: ageFrom(question) }, nodes: [], reverse_history: [] }
  await mkdir(join(sessionPath(id), 'nodes'), { recursive: true }); const root = await createNode(id, manifest, null, { type: 'decision', depth: 0, title: question, content: { question, user_age: manifest.root.age_anchor }, brief: question.slice(0, 30) }); manifest.root.node_id = root.id
  await preparePending(id, manifest, root, 'branch', 1, 3)
  await writeManifest(id, manifest); void generate(id, root.id, 'branch'); return manifest
}
async function body(req) { let raw = ''; for await (const chunk of req) raw += chunk; return raw ? JSON.parse(raw) : {} }
async function serveApp(req, res, pathname) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const assetPath = join(distDir, relativePath)
  if (!assetPath.startsWith(`${distDir}/`)) throw new Error('Invalid asset path')
  try {
    const asset = await readFile(assetPath)
    res.writeHead(200, { 'Content-Type': assetTypes[extname(assetPath)] || 'application/octet-stream' })
    return res.end(asset)
  } catch {
    if (extname(relativePath)) throw new Error('Not found')
    const app = await readFile(join(distDir, 'index.html'))
    res.writeHead(200, { 'Content-Type': assetTypes['.html'] })
    return res.end(app)
  }
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`); const path = url.pathname.split('/').filter(Boolean)
    if (req.method === 'GET' && path.join('/') === 'api/sessions') { json(res); return res.end(JSON.stringify(await listSessions())) }
    if (req.method === 'GET' && path[0] === 'api' && path[1] === 'sessions' && path[2] && path.length === 3) { json(res); return res.end(JSON.stringify(await readManifest(path[2]))) }
    if (req.method === 'GET' && path[0] === 'api' && path[1] === 'sessions' && path[2] && path[3] === 'nodes' && path[4]) { json(res); return res.end(JSON.stringify(await readNode(path[2], path[4]))) }
    if (req.method === 'POST' && path.join('/') === 'api/sessions') { const data = await body(req); json(res, 201); return res.end(JSON.stringify(await createSession(data.question))) }
    const id = path[2]; const data = req.method === 'POST' ? await body(req) : {}
    if (req.method === 'POST' && path[3] === 'branches' && path[5] === 'generate') { const manifest = await readManifest(id); const parent = find(manifest, path[4]); await preparePending(id, manifest, parent, 'difficulty', 2, data.count === 1 ? 1 : 3); await writeManifest(id, manifest); void generate(id, path[4], 'difficulty', data.count === 1 ? 1 : 3); json(res, 202); return res.end('{}') }
    if (req.method === 'POST' && path[3] === 'decisions' && path[5] === 'manual-branch') { const manifest = await readManifest(id); const parent = find(manifest, path[4]); const offset = '+1个月'; await createNode(id, manifest, parent, { type: 'branch', depth: 1, title: data.title, source: 'user', content: { summary: data.title, time_offset: offset, time_label: labelFor(manifest.root.time_anchor, offset) } }); await writeManifest(id, manifest); json(res, 201); return res.end('{}') }
    if (req.method === 'POST' && path[3] === 'branches' && path[5] === 'manual-difficulty') { const manifest = await readManifest(id); const parent = find(manifest, path[4]); const offset = `+${offsetMonths((await readNode(id, parent.id)).content.time_offset) + 3}个月`; await createNode(id, manifest, parent, { type: 'difficulty', depth: 2, title: data.title, source: 'user', content: { description: data.description || data.title, cause: '用户主动识别的风险', frequency: 'medium', impact: 'medium', time_offset: offset, time_label: labelFor(manifest.root.time_anchor, offset) } }); await writeManifest(id, manifest); json(res, 201); return res.end('{}') }
    if (req.method === 'POST' && path[3] === 'difficulties' && path[5] === 'response') { const manifest = await readManifest(id); const difficulty = find(manifest, path[4]); const response = await createNode(id, manifest, difficulty, { type: 'response', depth: 2, title: '我的应对', detail: data.text, source: 'user', content: { text: data.text } }); await preparePending(id, manifest, response, 'situation', 3, 3); await writeManifest(id, manifest); void generate(id, response.id, 'situation', 3, data.text); json(res, 202); return res.end('{}') }
    if (req.method === 'POST' && path[3] === 'difficulties' && path[5] === 'generate-response') { void generateResponseStrategy(id, path[4]); json(res, 202); return res.end('{}') }
    if (req.method === 'POST' && path[3] === 'responses' && path[5] === 'generate-situation') { const manifest = await readManifest(id); const response = find(manifest, path[4]); const responseFile = await readNode(id, response.id); await preparePending(id, manifest, response, 'situation', 3, 1); await writeManifest(id, manifest); void generate(id, response.id, 'situation', 1, responseFile.content.text); json(res, 202); return res.end('{}') }
    if (req.method === 'POST' && path[3] === 'responses' && path[5] === 'manual-situation') { const manifest = await readManifest(id); const response = find(manifest, path[4]); const responseFile = await readNode(id, response.id); const offset = `+${offsetMonths(responseFile.content.time_offset) + 3}个月`; await createNode(id, manifest, response, { type: 'situation', depth: 3, title: data.title, source: 'user', content: { description: data.description || data.title, trend: 'neutral', time_offset: offset, time_label: labelFor(manifest.root.time_anchor, offset) } }); await writeManifest(id, manifest); json(res, 201); return res.end('{}') }
    if (req.method === 'POST' && path[3] === 'situations' && path[5] === 'activate') { const manifest = await readManifest(id); const situation = find(manifest, path[4]); await preparePending(id, manifest, situation, 'outcome', 4, 1); await writeManifest(id, manifest); void generate(id, path[4], 'outcome'); json(res, 202); return res.end('{}') }
    if (req.method === 'POST' && path[3] === 'nodes' && path[5] === 'reverse') { const manifest = await readManifest(id); const node = find(manifest, path[4]); await retireDescendants(id, manifest, node); manifest.reverse_history.push({ at_node: node.id, reversed_at: stamp(), retired_subtree_root: node.children[0] || null, new_chain_from: node.id }); await writeManifest(id, manifest); json(res); return res.end('{}') }
    if (req.method === 'POST' && path[3] === 'nodes' && path[5] === 'restore') { const manifest = await readManifest(id); const node = find(manifest, path[4]); await restoreSubtree(id, manifest, node); manifest.reverse_history.push({ at_node: node.id, restored_at: stamp(), restored_subtree_root: node.id }); await writeManifest(id, manifest); json(res); return res.end('{}') }
    if (req.method === 'GET' && path[0] !== 'api') return serveApp(req, res, url.pathname)
    json(res, 404); res.end(JSON.stringify({ error: 'Not found' }))
  } catch (error) { json(res, 500); res.end(JSON.stringify({ error: error.message })) }
})
server.listen(port, () => console.log(`Life simulator API listening on http://localhost:${port}`))
