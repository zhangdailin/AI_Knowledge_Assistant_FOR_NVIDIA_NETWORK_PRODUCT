# 服务器部署说明

## 系统要求

⚠️ **重要：Node.js 版本要求**

- **最低版本**：Node.js 18.0.0
- **推荐版本**：Node.js 20.x LTS 或 Node.js 22.x
- **npm 版本**：8.0.0 或更高

### 检查当前版本

```bash
node -v
npm -v
```

如果版本低于要求，请先升级 Node.js（见下方说明）。

### Linux 系统依赖（PDF 解析）

在 Linux 系统上，PDF 解析功能可能需要以下系统库：

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y build-essential

# CentOS/RHEL
sudo yum groupinstall -y "Development Tools"
sudo yum install -y gcc-c++

# 如果遇到字体相关问题（可选）
sudo apt-get install -y fonts-liberation  # Ubuntu/Debian
sudo yum install -y liberation-fonts      # CentOS/RHEL
```

**注意**：`pdf-parse` 是纯 JavaScript 库，通常不需要系统依赖。但如果遇到解析失败，请检查：
1. Node.js 版本是否符合要求
2. 系统内存是否充足（建议至少 512MB 可用内存）
3. PDF 文件是否为扫描件（需要 OCR）或受保护/加密

## 升级 Node.js（如果版本过低）

### 方法 1: 使用 NVM（推荐）

```bash
# 安装 NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# 重新加载 shell 配置
source ~/.bashrc

# 安装 Node.js 20 LTS
nvm install 20

# 使用 Node.js 20
nvm use 20

# 设置为默认版本
nvm alias default 20

# 验证版本
node -v  # 应该显示 v20.x.x
```

### 方法 2: 使用 NodeSource 仓库（Ubuntu/Debian）

```bash
# 添加 NodeSource 仓库
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# 安装 Node.js 20
sudo apt-get install -y nodejs

# 验证版本
node -v  # 应该显示 v20.x.x
npm -v
```

### 方法 3: 从官网下载安装包

访问 [Node.js 官网](https://nodejs.org/) 下载并安装 LTS 版本。

## 启动服务

### 启动后端 API 服务

#### 方法 1: 使用 npm 脚本（推荐）

```bash
npm run server
```

#### 方法 2: 直接使用 node

```bash
node server/index.mjs
```

### 启动前端 Web 服务

#### 方法 1: 使用 npm 脚本（推荐）

```bash
npm run dev
```

前端服务将在 `http://localhost:5173` 启动。

### 同时启动前端和后端

#### 方法 1: 使用两个终端窗口

```bash
# 终端 1：启动后端
npm run server

# 终端 2：启动前端
npm run dev
```

#### 方法 2: 使用 PM2（推荐，见下方）

### 方法 3: 使用 PM2（生产环境推荐）

PM2 配置包含两个服务：
- **ai-assistant-server**: 后端 API 服务（端口 8787）
- **ai-assistant-web**: 前端 Web 服务（端口 5173）

```bash
# 安装 PM2（如果未安装）
npm install -g pm2

# 创建日志目录（如果不存在）
mkdir -p logs

# 启动所有服务
pm2 start ecosystem.config.cjs

# 查看状态
pm2 status

# 查看所有服务日志
pm2 logs

# 查看特定服务日志
pm2 logs ai-assistant-server  # 后端 API 服务
pm2 logs ai-assistant-web     # 前端 Web 服务

# 停止所有服务
pm2 stop all

# 停止特定服务
pm2 stop ai-assistant-server
pm2 stop ai-assistant-web

# 重启所有服务
pm2 restart all

# 重启特定服务
pm2 restart ai-assistant-server
pm2 restart ai-assistant-web

# 删除服务（停止并移除）
pm2 delete ai-assistant-server
pm2 delete ai-assistant-web

# 保存 PM2 配置（开机自启）
pm2 save
pm2 startup
```

## 重要提示

⚠️ **不要直接运行 `node package.json`**，这会导致错误：
```
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".json"
```

正确的启动命令是：
- ✅ `node server/index.mjs`
- ✅ `npm run server`
- ✅ `pm2 start ecosystem.config.cjs`

## 环境变量

### 后端服务端口

可以通过环境变量配置后端服务端口：

```bash
PORT=8787 node server/index.mjs
```

### 前端 API 服务器地址配置

**重要**：如果前端和后端不在同一台服务器上，或者需要指定特定的后端地址，需要配置环境变量。

#### 方法 1: 使用环境变量文件（推荐）

创建 `.env` 文件（参考 `.env.example`）：

```bash
# 复制示例文件
cp .env.example .env

# 编辑 .env 文件，设置后端 API 地址
VITE_API_SERVER_URL=http://172.17.200.222:8787
```

#### 方法 2: 自动检测（默认行为）

如果未设置 `VITE_API_SERVER_URL`，系统会自动使用当前页面的 hostname + 端口 8787。

例如：
- 如果前端访问 `http://172.17.200.222:5173`
- 后端将自动使用 `http://172.17.200.222:8787`

#### 方法 3: 在 PM2 配置中设置环境变量

编辑 `ecosystem.config.cjs`，在 `ai-assistant-web` 的 `env` 中添加：

```javascript
env: {
  NODE_ENV: 'development',
  PORT: 5173,
  VITE_API_SERVER_URL: 'http://172.17.200.222:8787'  // 添加这一行
}
```

然后重启服务：

```bash
pm2 restart ai-assistant-web
```

## 常见问题

### 问题：ERR_UNKNOWN_FILE_EXTENSION

**原因**：错误地运行了 `node package.json` 而不是 `node server/index.mjs`

**解决方法**：使用正确的启动命令（见上方）

### 问题：端口被占用

**解决方法**：
```bash
# 查看端口占用
lsof -i :8787  # Linux/Mac
netstat -ano | findstr :8787  # Windows

# 修改端口
PORT=8788 node server/index.mjs
```
