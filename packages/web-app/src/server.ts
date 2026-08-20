import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server';
import { createServerEntry } from '@tanstack/react-start/server-entry';

// The handler builds the app's router by calling `getRouter` from
// src/router.tsx, which the Start plugin resolves by convention — no file
// imports it, which is why nothing here names it.
const fetch = createStartHandler(defaultStreamHandler);

export default createServerEntry({ fetch });
