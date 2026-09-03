/**
 * The reasoning-effort vocabulary shared by every supported harness. Exactly
 * five levels, because that is the intersection every supported harness
 * understands — so a neutral value means the same thing everywhere. Codex
 * additionally accepts `none` and `minimal`; the pi-family harnesses (`omp`,
 * `pi`) additionally accept `off`, `minimal` and `auto`; all are deliberately
 * not offered, since a value only some harnesses honor would read as portable
 * and silently do nothing on the others.
 */
export const Effort = {
	Low: 'low',
	Medium: 'medium',
	High: 'high',
	XHigh: 'xhigh',
	Max: 'max',
} as const;

export type Effort = (typeof Effort)[keyof typeof Effort];
