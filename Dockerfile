# === 建置階段 ===
FROM node:20 AS builder

WORKDIR /app

# 複製 package 檔案並安裝所有依賴（含 dev）
COPY package*.json ./
RUN npm install

# 複製所有原始碼
COPY . .

# 建置 TypeScript 專案
RUN npm run build


# === 執行階段 ===
FROM node:20-slim

WORKDIR /app

# 僅複製 production 依賴所需的檔案
COPY package*.json ./
RUN npm install --omit=dev

# 複製編譯後的 JS 檔案
COPY --from=builder /app/dist ./dist

# 設定環境變數與啟動
EXPOSE 3000
CMD ["node", "dist/index.js"]
