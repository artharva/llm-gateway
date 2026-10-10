/** Integration tests run only when both services are configured. */
export const hasServices = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
export const describeIntegration = hasServices ? describe : describe.skip;

if (!hasServices) {
  console.warn('Skipping integration tests: set DATABASE_URL and REDIS_URL (see README).');
}
