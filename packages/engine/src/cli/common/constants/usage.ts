import { renderUsage } from '#src/commands/index.ts';

/** The `--help` text. Rendered from the command catalog so a flag cannot be documented in one place and accepted in another. */
export const usage = renderUsage();
