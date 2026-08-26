---
channel: react
---

# React Architecture

How the base rules apply to React code. React itself mandates no layout — the
framework carve-out table deliberately carries no React row — so nothing in
this document overrides a base rule. Every rule here is a base rule read
against React's nouns (components, hooks, JSX), and this pack's conventions
for React code are stated as conventions, never as framework facts.

**Return types:** React components infer — annotating `JSX.Element` on a component is noise, since the framework's own types are the contract. This is the React form of the explicit-return-type rule's exceptions.
