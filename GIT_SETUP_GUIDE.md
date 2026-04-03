# 信义认证系统 V5.0 - 本地 Git 仓库配置指南

## 当前状态
- ✅ 本地 Git 仓库已存在
- ✅ 代码已准备就绪（有大量修改待提交）
- ❌ 尚未配置远端仓库地址

## 下一步操作

### 1. 在 GitHub 创建新仓库
1. 访问 https://github.com/new
2. 仓库名称建议：`xinyi-certification-system-v5` 或你喜欢的名称
3. 选择公开或私有
4. 不要初始化 README（因为本地已有代码）

### 2. 获取仓库地址
创建完成后，复制仓库地址，格式如下：
- SSH: `git@github.com:你的用户名/仓库名.git`
- HTTPS: `https://github.com/你的用户名/仓库名.git`

### 3. 配置远端地址并推送
在终端执行以下命令（将地址替换为你的实际地址）：

```bash
# 添加远端地址（示例，请替换为你的实际地址）
git remote add origin git@github.com:yourname/xinyi-certification-system-v5.git

# 推送代码
git push -u origin main
```

## 当前修改状态
执行 `git status` 可以看到有大量文件已修改，建议先提交再推送：

```bash
# 查看修改状态
git status

# 添加所有修改
git add .

# 提交修改（建议写清楚本次提交的内容）
git commit -m "feat: 添加示例数据、修复情报雷达、优化转化率显示

- 添加工作台示例数据，支持自动计算转化率
- 修复情报雷达多后端回退机制
- 将Revenue术语统一为中文营收
- 修复AppContext语法错误"

# 推送到远端
git push -u origin main
```

## 验证
推送完成后，访问你的 GitHub 仓库页面即可看到所有代码。