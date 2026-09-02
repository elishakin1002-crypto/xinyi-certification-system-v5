# 数据库迁移手册（P0-8）

> 改数据库结构只走这一条路：写迁移文件 → `npm run migrate`。
> **不要手连生产库敲 SQL**，敲了别人不知道、别的环境不同步，出错只能靠备份救。

---

## 三条命令

```bash
npm run migrate:status              # 看哪些执行过、哪些待执行（不动数据库）
npm run migrate                     # 执行待执行的迁移（自动先备份）
npm run migrate:new 加销售提成字段     # 生成新迁移文件骨架
npm run test:db:setup               # 建/更新测试库（见下）
```

---

## 零、测试库必须和生产库分开

新环境第一件事：

```bash
npm run test:db:setup
```

它会建 `xinyi_test` 并跑完所有迁移。想要干净基线加 `-- --reset`（先删库重建）。

**为什么单列一条**：2026-08-21 之前测试没有独立库。两个测试助手
（`tests/helpers/httpServer.js` 和 `serverProcess.js`）都直接用 `.env.local` 的
`XINYI_DB_URL`——也就是装着 455 条真实线索、12 份真实合同的生产库。
事务测试的 fixture 就这么留在了真实数据里（见迁移 014）。

写脏数据只是表症，真正的风险是**测试里但凡有删除或清理逻辑，删的就是真实业务数据**。

现在的防线在 `tests/helpers/testDb.js`：库名必须以 `_test` 结尾，
否则测试直接抛错拒绝启动。宁可测试跑不起来，也不能让它连上生产库。

```bash
# 验证防线还在（应当报「拒绝在非测试库上跑测试」）
XINYI_TEST_DB_URL="$XINYI_DB_URL" npm test
```

> 顺带记一笔：`app_state_latest` / `app_state_history` 两张表不是迁移建的，
> 是 stateStore 在服务启动时懒建的。所以新库在**跑过一次服务之前**没有这两张表，
> 迁移里碰它们必须先 `to_regclass` 判存在（014 初版就栽在这里）。

---

## 一、加一个字段要怎么做

```bash
npm run migrate:new 客户表加行业字段
```

会生成 `db/migrations/006_客户表加行业字段.sql`，把 SQL 写进去：

```sql
ALTER TABLE customers ADD COLUMN IF NOT EXISTS industry text;
CREATE INDEX IF NOT EXISTS idx_customers_industry ON customers(industry);
```

先看一眼要执行什么，再真执行：

```bash
npm run migrate -- --dry-run
npm run migrate
```

### 写迁移的三条规矩

1. **尽量可重复执行** —— 用 `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`。虽然机制保证只执行一次，但幂等的迁移在排错时能随便重跑。
2. **执行过的文件不能改** —— 校验和会拦住（见下）。要调整就新建一个迁移。
3. **涉及金额的列注意单位** —— 顶层金额列存**分**，JSONB 内部存**元**。写数据的迁移必须走对应换算，别直接塞数字。这里踩过坑：曾用裸 SQL 往 `customers.total_amount`（分）写了个元的数值，98000 元变成了 980 元。

### 需要 CREATE INDEX CONCURRENTLY

它不能在事务里跑，文件第一行加标记：

```sql
-- migrate:no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_xxx ON yyy(zzz);
```

---

## 二、四道保护（都实测验证过）

| 保护 | 触发条件 | 行为 |
|---|---|---|
| **只执行一次** | 迁移已记录在 `schema_migrations` | 跳过 |
| **防改历史** | 已执行的文件内容变了（校验和不符） | **拒绝执行并报错**，提示新建迁移 |
| **事务回滚** | 迁移中途报错 | 该迁移整个回滚，不留半截结构，也不记录为已执行 |
| **并发锁** | 两个部署同时迁移 | 后来的拿不到咨询锁，直接退出 |

再加一道：**库里有业务数据时，自动先跑一次备份**。备份失败就中止迁移（想跳过要显式加 `--skip-backup`）。

> 「防改历史」这条最容易被当成麻烦。它防的是这种情况：某人改了一个已上线的迁移文件，本地重建库时得到新结构，生产库还是旧结构——**两边悄悄分叉，而且没人知道**。真出问题时极难查。

---

## 三、部署到新服务器

```bash
# 1. 建一个空库（腾讯云控制台或 create database）
# 2. 配好 XINYI_DB_URL
# 3. 建表
npm run migrate
# 4. 核对
npm run migrate:status
```

**已验证**：空库跑一遍 `migrate`，得到的列结构指纹和索引指纹与现有生产库**完全一致**（2026-08-17）。

### 本地用 docker 时

```bash
docker compose -f db/docker-compose.dev-db.yml up -d
npm run migrate
```

> 原来容器会在首次启动时自动执行 `db/init/*.sql` 建表。已去掉这个机制，
> 因为它只在数据目录为空时生效（加字段完全没有承载），而且腾讯云托管 PG 没有
> docker entrypoint——本地能自动、线上不能，两条路必然分叉。现在只保留 `npm run migrate` 一条路。

---

## 四、迁移历史

| 版本 | 内容 |
|---|---|
| 001 | leads / customers 建表 |
| 002 | projects / reminders / task_templates / project_work_logs 建表 |
| 003 | contracts / settlements 建表 |
| 004 | market_signals / audit_issues / strategic_tasks / knowledge_docs 建表 |
| 005 | 补齐 customers / projects / contracts / market_signals 的 `owner_user_id` 索引 |

001-004 是从原 `db/init/` 平移过来的基线，内容未改动。在已有数据的库上执行它们是纯粹的空操作（全部 `IF NOT EXISTS`），**已验证执行前后列数 254 → 254、业务数据零变化**。

---

## 五、常见问题

**Q：迁移执行失败了，数据库现在是什么状态？**
失败的那个迁移整个回滚了，之前成功的保持已执行。修好文件重跑 `npm run migrate` 就从失败那个继续。

**Q：想撤回一个迁移怎么办？**
没有自动回退（`down`）。这是刻意的——自动回退在有数据的库上经常是灾难（删列就是删数据）。要撤销就**新写一个反向迁移**，或者从备份恢复。

**Q：`schema_migrations` 表能手工改吗？**
不要。唯一的例外是清理测试遗留，且必须清楚自己在做什么。

**Q：改了后端代码要重启进程吗？**
要。Node 不热重载。这一条在 [备份与恢复手册](backup-restore-runbook.md) 里也写了，踩过。
