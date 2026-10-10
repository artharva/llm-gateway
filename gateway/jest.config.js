/** Unit tests need nothing running. Integration tests need REDIS_URL and DATABASE_URL. */
const tsJest = ['ts-jest', { tsconfig: 'tsconfig.json' }];

module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      roots: ['<rootDir>/test/unit'],
      transform: { '^.+\\.ts$': tsJest },
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      roots: ['<rootDir>/test/integration'],
      transform: { '^.+\\.ts$': tsJest },
    },
  ],
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts', '!src/db/migrate.ts'],
};
