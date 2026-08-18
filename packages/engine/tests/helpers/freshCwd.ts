import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** An empty temp dir to run the CLI against: no config, no runs, no plans. */
export const freshCwd = (): Promise<string> => mkdtemp(join(tmpdir(), 'lightsout-cli-'));
