/**
 * One vocabulary for every process-boundary crossing, shared by connection
 * docs (`type:`), hop-report exits, and (later) scan inventories — defined
 * once so parallel agents can't drift apart (prototype decision T12).
 */
export const TraverseEdgeKind = {
	Http: 'http',
	MessageBus: 'message-bus',
	PostMessage: 'postMessage',
	Response: 'response',
	ScriptInject: 'script-inject',
	S3Drop: 's3-drop',
	Db: 'db',
	Other: 'other',
} as const;

export type TraverseEdgeKind = (typeof TraverseEdgeKind)[keyof typeof TraverseEdgeKind];
