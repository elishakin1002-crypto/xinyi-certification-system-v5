# 测试环境验收记录模板

## 基本信息

| 项 | 内容 |
|---|---|
| 验收日期 |  |
| 验收人 |  |
| 代码版本/提交号 |  |
| 部署平台 |  |
| 测试域名 |  |
| 数据库 | PostgreSQL / 未确认 |
| 管理员测试账号 |  |
| 验收结论 | 可进入业务测试 / 暂缓 |

## 部署参数确认

| 检查项 | 结果 | 证据 |
|---|---|---|
| `DATABASE_URL` 为 PostgreSQL 且非 localhost | 通过 / 不通过 |  |
| `XINYI_REQUIRE_POSTGRES=true` | 通过 / 不通过 |  |
| `XINYI_AUTH_REQUIRE_POSTGRES=true` | 通过 / 不通过 |  |
| `XINYI_API_AUTH_TOKEN` 至少 24 字符 | 通过 / 不通过 |  |
| `XINYI_SESSION_AUTH_REQUIRED=true` | 通过 / 不通过 |  |
| `XINYI_SESSION_ROLE_ENFORCEMENT=true` | 通过 / 不通过 |  |
| `XINYI_SESSION_COOKIE_SECURE=true` | 通过 / 不通过 |  |
| `CORS_ALLOWED_ORIGINS` 只包含 HTTPS 测试域名 | 通过 / 不通过 |  |
| `KIMI_API_KEY` 或 `GEMINI_API_KEY` 已配置 | 通过 / 不通过 |  |
| 未配置 `VITE_*API_KEY` / `VITE_*SECRET` / `VITE_*TOKEN` | 通过 / 不通过 |  |
| 核心模块 API 开关全开 | 通过 / 不通过 |  |

## 自动验收

| 命令 | 结果 | 证据路径/摘要 |
|---|---|---|
| `npm run health:preflight:test` | 通过 / 不通过 |  |
| `npm run health:test-env` | 通过 / 不通过 |  |
| `npm run health:deploy` | 通过 / 不通过 |  |
| `npm run health:auth:api` | 通过 / 不通过 |  |
| `npm run health:state:persistence` | 通过 / 不通过 |  |

聚合验收报告：

```text
acceptance-reports/test-env-YYYYMMDD-HHMMSS.json
```

关键通过标准：

- `health:test-env` 显示 `fail=0`
- `/api/state/health` 显示 `mode=postgres`
- `/api/auth/health` 显示 `mode=postgres`
- `health:auth:api` 显示 `total=5 pass=5 fail=0`
- 线索、客户、合同、项目 smoke 全部通过

## 人工业务验收

| 链路 | 操作步骤 | 结果 | 证据 |
|---|---|---|---|
| 登录 | 管理员登录并进入工作台 | 通过 / 不通过 |  |
| 线索 | 新增线索，刷新后仍存在 | 通过 / 不通过 |  |
| 线索转化 | 线索转客户或生成跟进项目 | 通过 / 不通过 |  |
| 合同 | 新建合同，确认客户、项目、财务链路出现 | 通过 / 不通过 |  |
| 财务 | 回款状态更新后刷新仍保留 | 通过 / 不通过 |  |
| 员工 | 创建普通测试员工，首次登录强制改密 | 通过 / 不通过 |  |
| 审计 | 创建员工、重置密码等动作有审计记录 | 通过 / 不通过 |  |

## 风险与遗留

| 风险 | 影响 | 处理计划 | 负责人 |
|---|---|---|---|
|  |  |  |  |

## 结论

```text
结论：可进入业务测试 / 暂缓进入业务测试
理由：
未关闭风险：
下一步：
```

说明：如果人工验收发现 UI、DOM、demo 结构或字段异常，先记录页面、截图、账号、操作步骤和期望结果，不直接修改。
