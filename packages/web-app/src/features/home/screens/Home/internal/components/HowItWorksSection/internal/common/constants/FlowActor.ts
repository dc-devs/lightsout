/** Who does a step of the flow: you, before the handoff, or an agent, after it. */
export const FlowActor = { You: 'you', Agent: 'agent' } as const;

export type FlowActor = (typeof FlowActor)[keyof typeof FlowActor];
