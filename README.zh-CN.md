<h1 align="center">PicNest</h1>

<p align="center">
  自建图床，跑在 Cloudflare Workers + R2 + D1 上。<br>
  图片是你的，域名是你的，存储也是你的 —— 不用注册第三方账号，没有广告，链接不会过期。
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/boltguo/PicNest?color=blue"></a>
  <a href="https://github.com/boltguo/PicNest/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/boltguo/PicNest"></a>
  <a href="https://workers.cloudflare.com"><img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare-Workers%20%C2%B7%20R2%20%C2%B7%20D1-F38020?logo=cloudflare&logoColor=white"></a>
</p>

<p align="center"><a href="README.md">English</a> | 简体中文</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/boltguo/PicNest"><img alt="Deploy to Cloudflare" src="https://deploy.workers.cloudflare.com/button"></a>
</p>

## 功能

- **上传** —— 拖拽、多文件并发、单文件进度
- **整理** —— 文件夹、面包屑导航、跨文件夹移动、六种排序
- **浏览** —— 自适应网格、灯箱预览、查看详情
- **直链** —— `/f/<key>`，缓存一年，随便往哪贴
- **分享链接** —— 可设过期时间与访问密码，可查访问量、可撤销
- **自动去重** —— 内容相同的图片只存一份，上传多少次都一样
- **一个密码** —— JWT 会话 7 天，登录在边缘限流
- **中英双语** —— 包括对外的分享页

## 部署

### 一键部署

点页面顶部那个按钮。Cloudflare 会把这个仓库克隆到你自己的 GitHub 账号下，替你创建
R2 桶和 D1 数据库，在设置页问你要一个管理密码，然后部署。之后往你那份仓库推代码就会
自动重新部署。

**密码要用长的随机串。** 它同时是 JWT 的签名密钥，密码能猜中就等于会话能伪造。

部署完在面板里还有两件事要做：

- 把域名绑到 Worker 上。
- 桶保持私有 —— 不开 `r2.dev` 子域，不给桶绑自定义域名。所有字节都应该经 Worker 出去。

### 在本机部署

```bash
npx wrangler r2 bucket create picnest
npx wrangler d1 create picnest   # 把 database_id 填进 wrangler.jsonc
pnpm secret                      # 设置 ADMIN_PASSWORD
pnpm deploy                      # 构建 + 迁移 + 发布
```

## 本地开发

```bash
pnpm install
cp .dev.vars.example .dev.vars   # 设置 ADMIN_PASSWORD
pnpm dev                         # worker :8787 + vite :5173
```

打开 http://localhost:5173。Vite 把 `/api`、`/f/…`、`/s/…` 代理到 Worker；
本地 D1 与 R2 数据在 `.wrangler/state/`。

```bash
pnpm typecheck                   # worker + web
pnpm db:generate                 # 改完 worker/src/db/schema.ts 之后
pnpm db:migrate:local            # 把新迁移应用到本地
```

## 工作原理

```mermaid
flowchart LR
    subgraph browser["浏览器"]
        SPA["React SPA<br/>HeroUI · TanStack Query"]
    end
    guest["分享链接访问者"]

    subgraph edge["Cloudflare 边缘"]
        W["Worker · Hono"]
        ASSETS["静态资源<br/>web/dist"]
    end

    subgraph storage["存储（私有，仅通过绑定访问）"]
        R2[("R2<br/>图片字节")]
        D1[("D1 · SQLite<br/>元数据索引")]
    end

    SPA -->|"/api/* + JWT"| W
    SPA -->|"/f/&lt;key&gt;"| W
    guest -->|"/s/&lt;token&gt;"| W
    W --> ASSETS
    W -->|BUCKET 绑定| R2
    W -->|DB 绑定| D1
```

一个 Worker 扛下全部：React 应用作为静态资源、JSON API、图片字节，以及服务端渲染的
分享页。图片存在 R2，它是唯一事实来源；D1 存名称、文件夹和分享链接，随时可以用
`POST /api/reconcile` 从 R2 重建。

对象以内容哈希为 key，去重因此是免费的 —— 同一张照片传进三个文件夹，得到的是三条记录
指向同一个对象。单文件上限 32 MB，且只收图片。

### 安全

- 登录限流：每 IP 每分钟 5 次，在边缘拦。
- 会话是用 `ADMIN_PASSWORD` 签名的 HS256 JWT —— 改密码即吊销所有会话。
- 分享密码在浏览器里哈希，明文不会到达 Worker。
- 存储的字节带 `Content-Security-Policy: sandbox` 和 `nosniff` 返回，上传的 SVG
  没法在你的域上执行脚本。

## API

需要鉴权的接口带 `Authorization: Bearer <jwt>`。

| 方法 | 路径 | 说明 | 鉴权 |
| --- | --- | --- | --- |
| POST | `/api/login` | `{password}` → `{token}` | - |
| GET | `/api/list?folder=` | 文件夹内容 + 全局统计 | ✓ |
| PUT | `/api/upload?name=&folder=` | body 为原始字节，按内容去重 | ✓ |
| PATCH | `/api/file` | `{id, folder?, name?}` —— 移动 / 重命名 | ✓ |
| DELETE | `/api/file?id=` | 删除单个文件 | ✓ |
| GET | `/api/folders` | 所有文件夹路径 | ✓ |
| POST | `/api/folder` | `{path}` —— 创建（幂等） | ✓ |
| DELETE | `/api/folder?path=` | 递归删除文件夹 | ✓ |
| POST | `/api/share` | `{id, hours?, password?}` → `{url, exp}` | ✓ |
| GET | `/api/shares` | 分享列表与访问量 | ✓ |
| DELETE | `/api/share?token=` | 撤销分享 | ✓ |
| POST | `/api/reconcile` | 从 R2 重建 D1 索引 | ✓ |
| GET | `/f/<key>` | 公开直链 | - |
| GET | `/s/<token>` | 访问分享 | - |

## 费用

出网流量免费，操作次数不免费。一次未命中缓存的图片浏览 = 1 次 Worker 请求 + 1 次
R2 Class B 操作。

| 项目 | 免费额度 |
| --- | --- |
| 存储 | 10 GB |
| Class A（put / delete / list） | 100 万 / 月 |
| Class B（get / head） | 1000 万 / 月 |
| 出网流量 | 无限 |
| Worker 请求 | 10 万 / 天 |

## 技术栈

| 层 | 选型 |
| --- | --- |
| 运行时 | Cloudflare Workers · R2 · D1 |
| 后端 | [Hono](https://hono.dev) · [Drizzle ORM](https://orm.drizzle.team) · hono/jwt · zod · nanoid |
| 前端 | React 19 · React Router 7 · TypeScript · Vite |
| UI | [HeroUI v3](https://heroui.com) · Tailwind CSS 4 · lucide-react |
| 数据层 | TanStack Query · axios · zustand |
| 国际化 | i18next + react-i18next |

## 许可

[Apache-2.0](LICENSE)
