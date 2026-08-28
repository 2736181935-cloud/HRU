# AI辅助绩效管理实验网站

这是一个用于学术研究的情景实验网站。当前版本聚焦组织非人性化感知，采用 **AI决策权重（高/低）× 发展性反馈（有/无）** 的2×2组间设计。公开试用版由GitHub Pages托管，集中数据由Supabase保存。

## 当前研究模型

```text
AI决策权重 ──→ 组织非人性化感知
                    ↑
              发展性反馈调节
```

网站不展示具体绩效分数、等级、排名或奖惩结果，避免绩效结果效价成为额外混淆变量。

## 已实现功能

- 匿名知情同意
- 后端四组均衡随机分配
- 共同工作情景
- AI决策权重高/低操纵材料
- 无具体分值的评估完成通知
- 发展性反馈有/无操纵材料
- 两道材料理解检查
- AIP1–AIP3与DF1–DF3操纵检验
- OD1–OD5组织非人性化感知量表
- 人口统计及控制变量
- 页面停留时间和失焦次数记录
- 刷新后恢复原分组与当前进度
- SQLite持久化存储
- 密码保护的管理后台
- 四组数量、完成情况及质量标记展示
- CSV原始数据导出

## 技术结构

```text
浏览器原生HTML/CSS/JavaScript
          ↓ HTTP API
Supabase安全RPC
          ↓
PostgreSQL + RLS
```

`server.mjs`与SQLite保留用于本地离线开发；GitHub Pages版本使用`public/supabase.js`连接Supabase，不依赖本机服务器。

## GitHub Pages与Supabase部署

1. 在Supabase项目的SQL Editor中完整执行`supabase/schema.sql`。
2. 确认`public/config.js`中的项目URL、publishable key和管理员邮箱。
3. 在Supabase Authentication的URL Configuration中，将站点URL和重定向URL加入允许列表。
4. 推送到`main`分支后，`.github/workflows/pages.yml`自动发布`public/`目录。
5. 在GitHub仓库Settings → Pages中将Source设置为GitHub Actions。

数据库密码、service role key和GitHub令牌都不得写入仓库。`publishable key`是为浏览器公开使用的密钥，真正的数据权限由RLS和安全RPC控制。

## 目录

```text
├─ public/                 前端与管理后台
│  ├─ index.html
│  ├─ app.js
│  ├─ styles.css
│  ├─ admin.html
│  └─ admin.js
├─ lib/experiment.mjs      分组、步骤与CSV工具
├─ test/                   自动化测试
├─ data/                   运行后生成，不提交版本库
│  └─ study.db             SQLite数据库
├─ server.mjs              后端与数据库初始化
├─ package.json
└─ .env.example
```

## 数据表

### `participants`

保存匿名编号、实验条件、进度、状态、问卷版本、开始与完成时间、完成码和脱敏设备信息。

### `responses`

以长格式保存原始答案，包括AIP1–AIP3、DF1–DF3、OD1–OD5、理解检查和人口统计信息。系统不覆盖原始答案，也不在数据库中预先计算OD均值。

### `step_events`

保存每一页的进入时间、提交时间、停留毫秒数和页面失焦次数。

### `quality_flags`

保存理解检查失败等数据质量标记。系统只标记，不自动删除样本。

## 环境配置

复制`.env.example`为`.env`，至少修改：

```env
PORT=3000
HOST=127.0.0.1
ADMIN_PASSWORD=一个足够长且唯一的后台密码
IP_HASH_SALT=一个随机且足够长的字符串
STUDY_MODE=pilot
```

说明：

- `HOST=127.0.0.1`仅允许本机访问，适合本地测试。
- 局域网访问可以改为`HOST=0.0.0.0`。
- 正式公网部署应由Nginx或Caddy提供HTTPS反向代理。
- 预测试使用`STUDY_MODE=pilot`；正式收集前清理预测试数据库并改为`formal`。
- 不要把`.env`提交到Git。

## 启动

使用系统Node.js：

```bash
node server.mjs
```

或使用npm脚本：

```bash
npm start
```

启动后访问：

- 问卷：<http://127.0.0.1:3000>
- 后台：<http://127.0.0.1:3000/admin>

## 测试

```bash
npm test
```

测试覆盖均衡分组、步骤推进和CSV转义。正式收集前还应人工完成A、B、C、D四组全流程验收。

## 数据位置与导出

运行后数据库位于：

```text
data/study.db
```

SQLite还可能生成：

```text
data/study.db-wal
data/study.db-shm
```

不要在服务运行时仅复制`study.db`作为数据库备份；如需取得分析数据，请登录管理后台并点击“导出CSV”。本项目按照当前要求不设置每日自动备份，也不设置每6小时备份。

CSV为一名参与者一行的宽格式，包含实验条件、状态、时间、完成码及所有原始答案。DF2为反向题，分析时计算：

```text
DF2_R = 8 - DF2
```

组织非人性化感知建议计算：

```text
OD_mean = mean(OD1, OD2, OD3, OD4, OD5)
```

## 安全说明

- 管理员密码来自服务端环境变量，不下发到前端。
- 登录成功后使用HttpOnly、SameSite严格Cookie。
- 数据库文件不对公网提供。
- 原始IP不落库，只保存带盐SHA-256哈希。
- 问卷组别由后端决定，前端不能提交或修改分组。
- 已完成问卷不能覆盖提交。
- 公网部署必须配置HTTPS、防火墙和反向代理限流。
- 当前管理员会话保存在内存中，服务重启后需要重新登录。

## 正式上线检查清单

1. 修改管理员密码和哈希盐。
2. 将研究模式改为`formal`。
3. 确认绩效情景和两组反馈材料最终版本。
4. 用四个全新浏览器会话逐组验收。
5. 验证刷新恢复、重复提交阻止和CSV导出。
6. 配置HTTPS和只开放必要端口。
7. 明确伦理审批、隐私告知、样本排除和数据保存期限。

## 当前限制

- 当前是单机部署，适合预测试和中小规模收集。
- SQLite不适合大量并发写入；高并发正式收集可迁移到PostgreSQL。
- 未接入招募平台支付或完成码回传API。
- 未设置自动备份，服务器或磁盘故障可能造成不可恢复的数据丢失。
- 尚未基于预测试数据检验量表信度、操纵强度或材料等价性。
