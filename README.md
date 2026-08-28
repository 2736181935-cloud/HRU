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
- Supabase PostgreSQL集中存储
- 四组数量、完成情况及质量标记展示
- 通过Supabase控制台查看和导出原始数据

## 技术结构

```text
浏览器原生HTML/CSS/JavaScript
          ↓ HTTP API
Supabase安全RPC
          ↓
PostgreSQL + RLS
```

GitHub Pages版本使用`public/supabase.js`连接Supabase，不依赖自建服务器。`server.mjs`仅作为早期本地离线原型保留，不参与GitHub Pages部署。

## 当前部署状态

- GitHub仓库：<https://github.com/2736181935-cloud/HRU>
- 仓库可见性：公开
- 默认分支：`main`
- Pages工作流：已提交，尚需在仓库Settings → Pages中启用GitHub Actions
- 预计问卷地址：<https://2736181935-cloud.github.io/HRU/>
- Supabase表结构：需由项目所有者在SQL Editor执行`supabase/schema.sql`

在Pages启用和Supabase SQL执行完成前，预计网址可能返回404，集中上传功能也不会生效。

## GitHub Pages与Supabase部署

1. 在Supabase项目的SQL Editor中完整执行`supabase/schema.sql`。
   - 如果曾经执行过`169bab0`之前的旧脚本，并看到`gen_random_bytes(integer) does not exist`，再执行`supabase/hotfix_pgcrypto.sql`。
2. 确认`public/config.js`中的项目URL和publishable key。
3. 推送到`main`分支后，`.github/workflows/pages.yml`自动发布`public/`目录。
4. 在GitHub仓库Settings → Pages中将Source设置为GitHub Actions。

数据库密码、service role key和GitHub令牌都不得写入仓库。`publishable key`是为浏览器公开使用的密钥，真正的数据权限由RLS和安全RPC控制。

## 目录

```text
├─ public/                 问卷前端
│  ├─ index.html
│  ├─ app.js
│  ├─ config.js           Supabase公开配置
│  ├─ supabase.js         安全RPC客户端
│  └─ styles.css
├─ supabase/
│  └─ schema.sql          数据表、RLS和安全RPC函数
├─ .github/workflows/
│  └─ pages.yml           GitHub Pages自动发布
├─ lib/experiment.mjs      分组、步骤与CSV工具
├─ test/                   自动化测试
├─ server.mjs              本地离线原型，不参与Pages部署
├─ package.json
└─ .env.example
```

## 数据表

### `participants`

保存匿名编号、不可逆会话令牌哈希、实验条件、进度、状态、问卷版本、开始与完成时间及完成码。

### `responses`

以长格式保存原始答案，包括AIP1–AIP3、DF1–DF3、OD1–OD5、理解检查和人口统计信息。系统不覆盖原始答案，也不在数据库中预先计算OD均值。

### `step_events`

保存每一页的进入时间、提交时间、停留毫秒数和页面失焦次数。

### `quality_flags`

保存理解检查失败等数据质量标记。系统只标记，不自动删除样本。

## 本地预览

GitHub Pages版本是静态前端，可在项目目录启动任意静态文件服务器并将根目录指向`public/`。例如：

```bash
npx serve public
```

本地页面仍会把测试数据写入配置的Supabase项目，因此测试完成后应在Supabase控制台清理预测试数据。

## 测试

```bash
npm test
```

测试覆盖均衡分组、步骤推进和CSV转义。正式收集前还应人工完成A、B、C、D四组全流程验收。

## 数据位置与导出

集中数据保存在Supabase PostgreSQL中，不保存在GitHub仓库。试用者浏览器仅保存匿名参与者编号和会话令牌，用于刷新后恢复原分组与进度。

研究者直接登录Supabase控制台，在Table Editor中查看`participants`、`responses`、`step_events`和`quality_flags`，并使用控制台导出功能取得CSV。本项目按照当前要求不设置每日自动备份，也不设置每6小时备份。

Supabase中的`participants`为一名参与者一行，`responses`为一道题一行的长格式。导出后可按`participant_id`连接，并转换为分析所需的宽格式。DF2为反向题，分析时计算：

```text
DF2_R = 8 - DF2
```

组织非人性化感知建议计算：

```text
OD_mean = mean(OD1, OD2, OD3, OD4, OD5)
```

## 安全说明

- 数据表启用RLS，匿名浏览器无直接读写表的权限。
- 问卷只通过受控的`security definer` RPC提交数据。
- 会话令牌只以SHA-256哈希形式存入数据库，原始令牌仅保存在试用者浏览器。
- 四组均衡分配由数据库事务和 advisory lock执行，前端不能指定或修改分组。
- 已完成问卷不能覆盖提交。
- 数据库密码、`service_role`密钥和GitHub令牌不得写入仓库。

## 正式上线检查清单

1. 执行`supabase/schema.sql`并确认无错误。
2. 启用GitHub Pages的GitHub Actions发布源。
3. 确认绩效情景和两组反馈材料最终版本。
4. 用四个全新浏览器会话逐组验收。
5. 验证刷新恢复、重复提交阻止和Supabase数据写入。
6. 清理预测试数据后再开始正式收集。
7. 明确伦理审批、隐私告知、样本排除和数据保存期限。

## 当前限制

- GitHub Pages与Supabase在中国大陆的实际访问速度会受到用户网络环境影响，正式收集前需要多网络实测。
- 当前Pages尚未在仓库设置中启用，公开网址仍可能返回404。
- Supabase SQL执行前，问卷无法创建云端参与者记录。
- 未接入招募平台支付或完成码回传API。
- 未设置项目级自动备份，数据恢复能力取决于Supabase当前套餐。
- 尚未基于预测试数据检验量表信度、操纵强度或材料等价性。
