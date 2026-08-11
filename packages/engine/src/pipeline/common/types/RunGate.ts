import type { CommandResult } from '@/common/types/CommandResult';

export type RunGate = (params: { kind: string; command: string; group: string }) => Promise<CommandResult>;
