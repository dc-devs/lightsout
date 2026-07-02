/**
 * Agent definitions: a role = a markdown prompt (prompts/) + a typed output
 * contract (code). Prompts stay readable and forkable; contracts stay
 * enforced. The engine assembles each invocation deterministically — agents
 * never load their own context via harness machinery, which is what makes the
 * same prompt portable across drivers.
 */
export {};
