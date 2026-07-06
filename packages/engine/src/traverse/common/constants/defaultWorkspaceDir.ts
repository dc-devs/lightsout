import { homedir } from 'node:os';
import { join } from 'node:path';

/** Default shared clone workspace for traversed repos: `~/.lightsout/traverse-repos`. */
export const defaultWorkspaceDir = join(homedir(), '.lightsout', 'traverse-repos');
