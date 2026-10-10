# Build from the repository root: docker build -f gateway/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY gateway/package.json gateway/
COPY mock-provider/package.json mock-provider/
COPY dashboard/package.json dashboard/
RUN npm ci --workspace gateway
COPY gateway gateway
RUN npm run build --workspace gateway

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY gateway/package.json gateway/
COPY mock-provider/package.json mock-provider/
COPY dashboard/package.json dashboard/
RUN npm ci --workspace gateway --omit=dev && npm cache clean --force
COPY --from=build /app/gateway/dist gateway/dist
COPY gateway/migrations gateway/migrations
WORKDIR /app/gateway
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "dist/index.js"]
