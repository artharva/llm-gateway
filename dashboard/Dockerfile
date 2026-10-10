# Build context is the repo root (see docker-compose.yml).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY gateway/package.json gateway/
COPY mock-provider/package.json mock-provider/
COPY dashboard/package.json dashboard/
RUN npm ci --workspace dashboard
COPY dashboard dashboard
RUN npm run build --workspace dashboard

FROM nginx:1.27-alpine
COPY dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dashboard/dist /usr/share/nginx/html
EXPOSE 80
