# 人生逆转模拟器

一个围绕“reverse”主题的人生抉择推演工具。输入正在面对的关键选择，应用会把选择、可能遇到的困难、你的应对与后续局面组织成一张可回看的思维导图。你可以从任意节点回溯，保留已放弃的分支，同时继续探索新的路径。

## 功能

- 生成最多三条初始选择分支，并按需推演后续节点
- 将困难标注为发生概率与影响程度，保留明确的因果链
- 在困难节点直接填写应对方式，生成三种后续局面与阶段性结局
- 支持 reverse 回溯：旧子树灰显保留，新路径不使用被放弃分支的内容
- 将每次推演持久化为可恢复的会话和节点 JSON

## 本地运行

需要 Node.js 20 或更高版本，以及智谱 AI 的 API 密钥。

```bash
npm install
cp .env.example .env.local
```

在 `.env.local` 中设置 `ZHIPU_API_KEY`，然后分别启动 API 服务和前端：

```bash
npm run server
npm run dev
```

Vite 会输出本地访问地址。`.env.local` 与会话数据均已被 Git 忽略，避免将密钥或本地推演内容提交到仓库。

## 验证

```bash
npm run check
npm run build
```

## License

[MIT](LICENSE)
