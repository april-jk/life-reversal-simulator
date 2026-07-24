import { useCallback, useEffect, useMemo, useState } from 'react'
import { Background, Controls, Handle, Position, ReactFlow, type Node, type NodeProps } from '@xyflow/react'
import { Bot, CornerUpLeft, Plus, Send, Sparkles } from 'lucide-react'

type TreeNode = { id: string; parent: string | null; type: string; depth: number; status: string; title: string; time_label?: string; children: string[]; file: string }
type Manifest = { session_id: string; root: { node_id: string; time_anchor: string; age_anchor?: number | null }; nodes: TreeNode[]; reverse_history: unknown[] }
type LifeData = { item: TreeNode; anchor: string; onGenerate: (id: string, one?: boolean) => void; onManual: (id: string, title: string) => void; onRespond: (id: string, text: string) => void; onOutcome: (id: string) => void; onReverse: (id: string) => void }
type LifeNode = Node<LifeData, 'life'>
const templates = ['我现在 20 岁，要不要辍学创业？', '考研还是直接工作？', '要不要去北京发展？', '高考志愿应该怎么选？']

async function request(path: string, method = 'GET', data?: unknown) { const res = await fetch(`/api${path}`, { method, headers: data ? { 'Content-Type': 'application/json' } : undefined, body: data ? JSON.stringify(data) : undefined }); if (!res.ok) throw new Error((await res.json()).error || '请求失败'); return res.json() }
function monthLabel(node: TreeNode, anchor: string) { return node.time_label || (node.type === 'decision' ? anchor : '') }

function SimulatorNode({ data }: NodeProps<LifeNode>) {
  const { item } = data; const [manual, setManual] = useState(false); const [value, setValue] = useState(''); const [absolute, setAbsolute] = useState(false)
  const submit = (action: () => void) => { action(); setValue(''); setManual(false) }
  return <div className={`life-node ${item.type} ${item.status}`}>
    <Handle type="target" position={Position.Left} />
    <div className="node-top"><span className="node-kind">{item.type}</span>{item.time_label && <button className="time" onClick={() => setAbsolute(!absolute)}>{absolute ? item.time_label : '几个月后'}</button>}</div>
    <strong>{item.status === 'pending' ? '正在推演…' : item.status === 'error' ? '推演失败，点击重试' : item.title}</strong>
    {item.type === 'difficulty' && <span className="tagline">概率 / 影响将在推演中标记</span>}
    {item.type === 'difficulty' && item.status === 'active' && <div className="node-input"><input value={value} onChange={(e) => setValue(e.target.value)} placeholder="你会怎么处理？" onKeyDown={(e) => e.key === 'Enter' && value.trim() && submit(() => data.onRespond(item.id, value))} /><button onClick={() => value.trim() && submit(() => data.onRespond(item.id, value))}><Send size={14} /></button></div>}
    {item.type === 'situation' && item.status === 'active' && <button className="inline-action" onClick={() => data.onOutcome(item.id)}>查看阶段结局</button>}
    {item.type === 'branch' && item.status === 'active' && <div className="node-actions"><button title="AI 追加一个困难" onClick={() => data.onGenerate(item.id, true)}><Bot size={14} /> AI 生成</button><button title="手动添加困难" onClick={() => setManual(!manual)}><Plus size={14} /> 手动添加</button></div>}
    {manual && <div className="node-input"><input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="写下一个可能的困难" onKeyDown={(e) => e.key === 'Enter' && value.trim() && submit(() => data.onManual(item.id, value))} /><button onClick={() => value.trim() && submit(() => data.onManual(item.id, value))}><Send size={14} /></button></div>}
    {item.type === 'branch' && item.children.length === 0 && item.status === 'active' && <button className="inline-action" onClick={() => data.onGenerate(item.id)}>生成可能遇到的困难</button>}
    {item.type !== 'decision' && item.status === 'active' && <button className="reverse" title="Reverse" onClick={() => data.onReverse(item.id)}><CornerUpLeft size={14} /> reverse</button>}
    <Handle type="source" position={Position.Right} />
  </div>
}

export default function App() {
  const [question, setQuestion] = useState(''); const [manifest, setManifest] = useState<Manifest | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(false)
  const refresh = useCallback(async (id: string) => { try { setManifest(await request(`/sessions/${id}`)) } catch (e) { setError(e instanceof Error ? e.message : '无法读取会话') } }, [])
  useEffect(() => { if (!manifest) return; const pending = manifest.nodes.some((node) => node.status === 'pending'); if (!pending) return; const timer = window.setInterval(() => refresh(manifest.session_id), 1000); return () => window.clearInterval(timer) }, [manifest, refresh])
  const create = async (value = question) => { if (!value.trim()) return; setLoading(true); setError(''); try { const next = await request('/sessions', 'POST', { question: value }); setManifest(next); setQuestion('') } catch (e) { setError(e instanceof Error ? e.message : '创建失败') } finally { setLoading(false) } }
  const mutate = async (path: string, data?: unknown) => { if (!manifest) return; try { await request(path, 'POST', data); await refresh(manifest.session_id) } catch (e) { setError(e instanceof Error ? e.message : '操作失败') } }
  const nodes = useMemo(() => {
    if (!manifest) return []; const byLevel = new Map<number, TreeNode[]>(); const level = (node: TreeNode) => node.type === 'response' ? 2.45 : node.type === 'outcome' ? 4 : node.depth
    for (const item of manifest.nodes) { const key = level(item); byLevel.set(key, [...(byLevel.get(key) || []), item]) }
    return manifest.nodes.map((item) => { const group = byLevel.get(level(item)) || []; const row = group.indexOf(item); return { id: item.id, type: 'life', position: { x: level(item) * 320, y: row * 230 - ((group.length - 1) * 115) }, data: { item, anchor: manifest.root.time_anchor, onGenerate: (nodeId: string, one = false) => mutate(`/sessions/${manifest.session_id}/branches/${nodeId}/generate`, { count: one ? 1 : 3 }), onManual: (nodeId: string, title: string) => mutate(`/sessions/${manifest.session_id}/branches/${nodeId}/manual-difficulty`, { title }), onRespond: (nodeId: string, text: string) => mutate(`/sessions/${manifest.session_id}/difficulties/${nodeId}/response`, { text }), onOutcome: (nodeId: string) => mutate(`/sessions/${manifest.session_id}/situations/${nodeId}/activate`), onReverse: (nodeId: string) => mutate(`/sessions/${manifest.session_id}/nodes/${nodeId}/reverse`) } } })
  }, [manifest])
  const edges = useMemo(() => manifest?.nodes.filter((node) => node.parent).map((node) => ({ id: `${node.parent}-${node.id}`, source: node.parent!, target: node.id, animated: node.status === 'pending', className: node.status === 'reversed' ? 'retired-edge' : '' })) || [], [manifest])
  return <main className="app-shell"><aside><div className="brand"><Sparkles size={20} />人生逆转模拟器</div><p>把此刻的选择，推演成可以回看的多条人生线。</p><div className="question-box"><textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="输入你正在面对的关键抉择" /><button onClick={() => create()} disabled={loading}>{loading ? '正在开始' : '开始推演'} <Send size={16} /></button></div><div className="template-label">从一个典型选择开始</div>{templates.map((item) => <button className="template" key={item} onClick={() => create(item)}>{item}</button>)}<div className="legend"><span className="decision-dot" />抉择 <span className="difficulty-dot" />困难 <span className="situation-dot" />局面</div></aside><section className="canvas"><header><div>{manifest ? <><span className="eyebrow">SESSION</span><b>{manifest.session_id}</b></> : <><span className="eyebrow">WHAT IF</span><b>从一个选择开始</b></>}</div>{manifest && <span className="anchor">时间锚点 {manifest.root.time_anchor}</span>}</header>{error && <div className="error">{error}</div>}{manifest ? <ReactFlow nodes={nodes} edges={edges} nodeTypes={{ life: SimulatorNode }} fitView minZoom={0.2} maxZoom={1.4}><Background gap={24} size={1} /><Controls /></ReactFlow> : <div className="empty"><div><Sparkles size={32} /><h1>你会如何选择？</h1><p>每一次探索都会成为一条可回看的记忆。</p></div></div>}</section></main>
}
