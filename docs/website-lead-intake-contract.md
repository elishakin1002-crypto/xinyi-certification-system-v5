# 官网线索接入契约

## 接口

`POST /api/public/website-leads`

默认关闭，必须设置：

```bash
XINYI_PUBLIC_LEAD_ENABLED=true
```

如果设置了 `XINYI_PUBLIC_LEAD_TOKEN`，请求必须带：

```http
x-xinyi-public-lead-token: <token>
```

建议官网通过服务端或 Serverless 转发提交，不建议把 token 写进浏览器前端代码。

## 请求字段

| 官网字段 | 管理系统字段 | 说明 |
|---|---|---|
| `company` / `companyName` | `lead.company` | 必填，公司名 |
| `contactName` / `name` | `lead.name` | 必填，联系人 |
| `mobile` / `phone` / `tel` | `lead.mobile` | 手机 |
| `wechat` / `wechatId` | `lead.wechat` | 微信 |
| `position` / `title` | `lead.position` | 职位 |
| `industry` | `lead.industry` | 行业 |
| `targetCertifications` / `certification` / `intentCertification` | `lead.targetCertifications` | 意向认证 |
| `message` / `remark` / `note` / `content` | `lead.followUpRecords[].content` | 官网留言 |
| `pageUrl` / `url` / `referrer` | `lead.followUpRecords[].content` | 来源页面 |
| `submittedAt` | `lead.followUpRecords[].content` | 官网提交时间 |

当前不新增线索模型字段；官网留言、来源页面、提交时间统一沉淀为系统跟进记录。

## 写入规则

- 新线索默认：
  - `status=New`
  - `score=60`
  - `probability=20`
  - `potentialValue=0`
  - `source=官网表单`
  - `intent=Medium`
- 如果 `company + mobile` 已存在，则不重复创建线索，只追加一条 `followUpRecords`。
- 如果没有手机号，则用 `company + contactName` 判断重复。
- 蜜罐字段 `website` 或 `homepage` 有值时，接口返回成功但忽略写入。

## 示例

```json
{
  "company": "温州某某食品有限公司",
  "contactName": "张三",
  "mobile": "13800000000",
  "wechat": "wx-zhangsan",
  "position": "负责人",
  "industry": "食品",
  "targetCertifications": "ISO 9001",
  "message": "想咨询认证办理",
  "pageUrl": "https://www.xinyi-iso.com/contact"
}
```

成功创建返回 `201`：

```json
{
  "ok": true,
  "code": 0,
  "message": "success",
  "data": {
    "accepted": true,
    "created": true,
    "leadId": "L-...",
    "written": 1
  }
}
```

重复提交返回 `200`，`created=false`。

## 验证

```bash
npm run test
```

当前测试覆盖：

- 默认关闭时返回 404
- 配置 token 时无 token 返回 403
- 首次提交创建 `leads_v8` 线索
- 重复提交只追加跟进记录，不重复创建线索
