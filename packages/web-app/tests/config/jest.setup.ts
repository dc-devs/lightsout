import { TextDecoder, TextEncoder } from 'node:util';
import '@testing-library/jest-dom/jest-globals';

// jsdom implements the DOM, not the platform around it: TextEncoder and
// TextDecoder are absent from its global scope. The router's core builds an
// encoder the moment it is imported, so a test that reaches any module
// importing @tanstack/react-router dies before its first line runs. Assigned
// through Object.assign because Node's classes and the DOM's declared ones are
// separate types to the compiler, structurally identical though they are.
Object.assign(globalThis, { TextDecoder, TextEncoder });
