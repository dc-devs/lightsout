import type { JiraQueueSettings } from '#src/queue/common/types/JiraQueueSettings.ts';
import type { LinearQueueSettings } from '#src/queue/common/types/LinearQueueSettings.ts';

export type QueueSettings = LinearQueueSettings | JiraQueueSettings;
