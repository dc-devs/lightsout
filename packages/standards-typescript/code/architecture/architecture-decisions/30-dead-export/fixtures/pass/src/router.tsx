import { createRootRoute, createRouter } from '@tanstack/react-router';

const routeTree = createRootRoute();

// The Start plugin resolves this file by convention. Nothing in the app imports
// `getRouter` and no barrel publishes it — which is exactly what makes it read
// as dead to a check that does not know the framework named it.
export const getRouter = () => createRouter({ routeTree });
