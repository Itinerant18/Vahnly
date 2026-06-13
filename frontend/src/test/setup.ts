// Global jest setup. Only jest-dom matchers here — safe to import under the
// node testEnvironment used by the existing network test. React Testing Library
// is imported per-file by the jsdom component tests (it auto-cleans after each
// test), so it never loads in a DOM-less environment.
import '@testing-library/jest-dom';
