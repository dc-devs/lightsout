import type { CommandResult } from '#src/common/types/CommandResult.ts';

export type RunGate = (params: { kind: string; command: string; group: string }) => Promise<CommandResult>;
