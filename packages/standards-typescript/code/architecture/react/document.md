---
channel: react
---

# React Architecture

Architecture decisions for React packages.

**Return types:** React components infer — annotating `JSX.Element` on a component is noise, since the framework's own types are the contract. This is the React form of the explicit-return-type rule's exceptions.
