# Plan: add power operation

## Goal

Add a `power` operation to the calculator, mirroring the existing operations.

## Files

1. **Create `src/power.js`** — export a `power` function with the same
   object-parameter shape as the other operations (`{ number1, number2 }`),
   returning `number1 ** number2`.
2. **Modify `src/index.js`** — additionally re-export `power` from
   `./power.js`, same style as the existing re-exports.

## Out of scope

Everything else. Do not modify other source files.
