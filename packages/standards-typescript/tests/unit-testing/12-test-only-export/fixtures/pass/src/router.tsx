import { createRootRoute, createRouter } from '@tanstack/react-router';

const routeTree = createRootRoute();

// The Start plugin resolves this file by convention: only its own test
// mentions `getRouter`, which before the carve-out reads as "production-dead".
export const getRouter = () => createRouter({ routeTree });
