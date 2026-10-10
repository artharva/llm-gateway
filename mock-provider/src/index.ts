import { createMockServer } from './server';

const port = Number(process.env.PORT ?? 4000);
const { app } = createMockServer({
  delayMs: Number(process.env.MOCK_DELAY_MS ?? 200),
  jitterMs: Number(process.env.MOCK_JITTER_MS ?? 0),
  failureRate: Number(process.env.MOCK_FAILURE_RATE ?? 0),
  failStatus: Number(process.env.MOCK_FAIL_STATUS ?? 503),
});

app.listen(port, () => {
  console.log(`mock provider listening on :${port}`);
});
