# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_SERVER_URL
ENV VITE_API_SERVER_URL=${VITE_API_SERVER_URL}
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.52.0-jammy AS backend
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
EXPOSE 8787
CMD ["node", "server/index.mjs"]

FROM nginx:1.25-alpine AS frontend
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
