module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      // config.ts uses Vite's import.meta.env; ts-jest compiles to CommonJS where
      // import.meta is invalid (TS1343). Suppress the diagnostic and rewrite the
      // token to a mock via the before-transformer.
      diagnostics: { ignoreCodes: [1343] },
      astTransformers: { before: ['<rootDir>/jest/import-meta.cjs'] },
    }],
  },
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  // Existing node tests live in __tests__/*.test.ts; component tests are *.test.tsx
  // and opt into jsdom via a per-file `@jest-environment jsdom` docblock.
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.tsx'],
};
