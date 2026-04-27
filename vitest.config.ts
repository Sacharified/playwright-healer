import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
          pool: 'threads',
          environment: 'node',
          testTimeout: 15000,
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          pool: 'forks',
          environment: 'node',
          testTimeout: 30000,
          passWithNoTests: true,
        },
      },
    ],
  },
});
