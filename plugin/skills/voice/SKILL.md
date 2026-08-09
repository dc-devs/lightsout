---
name: voice
description: Turn the spoken read-out of lightsout interview questions on or off for this project — `/lightsout:voice on` and `/lightsout:voice off`. Use when the user asks to turn on voice mode, have questions read aloud, hear the questions, or stop reading questions out loud. Mac-only, and off until it is turned on.
allowed-tools: Bash
---

# lightsout: voice

**This skill is the ignition, not the engine.** It holds no logic — no
detection of what counts as a question, no speech, no state. All of that lives
in the engine and in the plugin's own hook. This skill only flips the switch.

## Steps

1. Resolve the engine bundle: `${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs`
   (the bundle ships inside the plugin — marketplace installs copy only the
   plugin directory, never the surrounding repo). If the file does not exist,
   stop and tell the user to reinstall the plugin or run `pnpm bundle` in the
   lightsout repo.
2. From the project directory, run the direction the user asked for:

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" voice on
   ```

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" voice off
   ```

3. Relay the engine's confirmation verbatim.

## What to tell the user if they ask

- The switch is **per project** — it lives in this project's `.lightsout`
  folder, so turning it on here leaves every other repo silent.
- The reading itself happens **automatically**, through a hook the plugin
  ships: after a turn that asks a labelled question, and the moment an option
  picker appears. Nothing needs to be run per question.
- It speaks through the Mac's built-in voice, so it makes no sound on other
  platforms.
- Replying by voice is the Mac's own job — macOS Voice Control or dictation.
  Headphones are worth it: on speakers, the question being read aloud can feed
  back into the microphone.
