/**
 * How often the queue skill posts a board into the conversation: every ten
 * minutes. The engine uses it for a live board's next-update time.
 *
 * `plugin/skills/queue/SKILL.md` states the same ten minutes in prose, because
 * the skill keeps the clock itself — changing one means changing the other.
 */
export const queueUpdateIntervalMs = 600_000;
