# Build from the repository root: docker build -f mock-provider/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY gateway/package.json gateway/
COPY mock-provider/package.json mock-provider/
COPY dashboard/package.json dashboard/
RUN npm ci --workspace mock-provider
COPY mock-provider mock-provider
RUN npm run build --workspace mock-provider

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY gateway/package.json gateway/
COPY mock-provider/package.json mock-provider/
COPY dashboard/package.json dashboard/
RUN npm ci --workspace mock-provider --omit=dev && npm cache clean --force
COPY --from=build /app/mock-provider/dist mock-provider/dist
WORKDIR /app/mock-provider
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "dist/index.js"]
