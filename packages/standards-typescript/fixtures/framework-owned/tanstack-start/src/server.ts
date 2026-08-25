import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server';
import { createServerEntry } from '@tanstack/react-start/server-entry';

// Nothing imports this file either: src/server.ts is resolved by convention,
// exactly as src/router.tsx is.
export default createServerEntry({ fetch: createStartHandler(defaultStreamHandler) });
