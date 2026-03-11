/**
 * Test setup — runs before every test file.
 *
 * WHAT THIS DOES:
 *   Imports @testing-library/jest-dom which adds custom matchers to Vitest's
 *   expect() function. For example:
 *     expect(element).toBeInTheDocument()
 *     expect(element).toHaveTextContent("hello")
 *
 *   Without this import, those matchers don't exist and tests would fail.
 *
 * HOW IT'S CONFIGURED:
 *   Referenced in vite.config.ts under test.setupFiles.
 *   Vitest runs this file before each test suite automatically.
 */

import "@testing-library/jest-dom";
