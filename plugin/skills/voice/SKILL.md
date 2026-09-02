---
name: voice
description: Turn the spoken read-out of lightsout interview questions on or off for this project. Use when the user asks to turn on voice mode, have questions read aloud, hear the questions, or stop reading questions out loud. Mac-only, and off until it is turned on.
allowed-tools: Bash
---

# lightsout: voice

**This skill is the ignition, not the engine.** It holds no logic — no
detection of what counts as a question, no speech, no state. All of that lives
in the engine and in the plugin's own hook. This skill only flips the switch.

## Steps

1. Resolve the plugin root from this loaded skill's absolute path: it is two
   directories above this `SKILL.md`. In Claude Code,
   `${CLAUDE_PLUGIN_ROOT}` may provide the same path; do not assume that
   variable exists in Codex skill shell calls. Use the resolved absolute path
   wherever `<plugin-root>` appears below. Confirm
   `<plugin-root>/dist/cli.mjs` exists; otherwise stop and tell the user to
   reinstall the plugin or run `pnpm bundle` in the lightsout repo.
2. From the project directory, run the direction the user asked for:

   ```sh
   node "<plugin-root>/dist/cli.mjs" voice on
   ```

   ```sh
   node "<plugin-root>/dist/cli.mjs" voice off
   ```

3. Relay the engine's confirmation verbatim.

## What to tell the user if they ask

- The switch is **per project** — it lives in this project's `.lightsout`
  folder, so turning it on here leaves every other repo silent.
- In Claude Code, the reading happens **automatically** through a hook the
  plugin ships: after a turn that asks a labelled question, and the moment an
  option picker appears. Nothing needs to be run per question.
- Codex can load the same bundled hook, but its transcript format is not a
  stable hook interface, so automatic labelled-question reading is not
  guaranteed there. The immediate option-picker event is Claude Code-only.
- It speaks through the Mac's built-in voice, so it makes no sound on other
  platforms.
- Replying by voice is the Mac's own job — macOS Voice Control or dictation.
  Headphones are worth it: on speakers, the question being read aloud can feed
  back into the microphone.
