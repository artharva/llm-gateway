# LLM Gateway

A backend service that apps call instead of calling AI providers directly. Work in progress.

```bash
docker compose up --build
docker compose exec gateway node dist/cli/create-key.js --name demo
curl -s localhost:8080/v1/chat -H "Authorization: Bearer <key>" -H "Content-Type: application/json" \
  -d '{"model":"fast","messages":[{"role":"user","content":"Hello"}]}'
```
