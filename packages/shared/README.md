# @lightsout/shared

Pure, framework-free functions that more than one package needs — today the
duration and token-count formatting the terminal report card and the web app
have to agree on, so a run reads the same either place.

## What belongs here

A function qualifies when all three hold: it is pure, it depends on no
framework, and a second package needs it. Anything one package alone uses stays
in that package's `common/`.

## What does not

Anything that imports React, reaches for Node APIs beyond the `node:` built-ins,
or knows what the engine is. Those are the packages' own concerns, and a shared
package that grew them would make every consumer carry them.
