module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  // Existing node tests live in __tests__/*.test.ts; component tests are *.test.tsx
  // and opt into jsdom via a per-file `@jest-environment jsdom` docblock.
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.tsx'],
};
