import { Bot, Code, type LucideIcon } from 'lucide-react';
import { CheckKind } from '#src/common/constants/CheckKind.ts';

/** The icon each kind of check wears wherever it is named — code for the deterministic ones, the agent's own mark for the rest. */
export const checkKindIcons: Record<CheckKind, LucideIcon> = {
	[CheckKind.Deterministic]: Code,
	[CheckKind.Agent]: Bot,
};
