import { createRootRoute, createRouter } from '@tanstack/react-router';

const routeTree = createRootRoute();

// A framework's entry file is framework-named: the Start plugin decides both
// that this file is called `router.tsx` and that its export is `getRouter`.
export const getRouter = () => createRouter({ routeTree });
