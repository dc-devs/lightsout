import type { AnyRouter } from '@tanstack/react-router';
import { createRootRoute, createRouter } from '@tanstack/react-router';

// Nothing imports this file: the Start plugin resolves src/router.tsx by
// convention. A real entry hands createRouter the route tree the plugin
// generates from src/routes/, and a generated file is not part of what this
// tree proves.
export const getRouter = (): AnyRouter => createRouter({ routeTree: createRootRoute() });
