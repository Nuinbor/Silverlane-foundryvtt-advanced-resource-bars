# Advanced Resource Bars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship and push a usable resource-tracking module for Foundry v14 and D&D5e.

**Architecture:** Separate pure resource evaluation from Foundry document updates, UI, and combat adapters. Actor flags retain values/history and managed effects carry ownership metadata.

**Tech Stack:** JavaScript ES modules, ApplicationV2, Handlebars, CSS, Node test runner.

**Spec:** docs/superpowers/specs/2026-11-13-resource-bars-design.md

## Global Constraints

- Foundry minimum 14.367; D&D5e minimum 6.1.0; no required third-party modules.
- Russian and English UI; stable module ID `silverlane-resource-bars`.
- No eval, no arbitrary socket writes, no removal of unrelated effects.

## Review Focus

1. Large deltas crossing several thresholds and the terminal reset must not lose history.
2. Repeated hit messages, misses, healing, and multiple connected GMs must not double-apply.
3. Unlinked token Actors must not update the base Actor instead.
4. Malformed definitions and effect changes must fail without destructive partial replacement.
5. Player permissions, hidden tokens, and user text must not leak private values or inject HTML.

### Task 1: Resource domain

**Files:** scripts/domain.mjs, tests/domain.test.mjs, package.json.

**Interfaces:** `validateDefinitions(definitions)`, `transition(definition, state, value)`, `defaultDefinitions()`.

- [ ] Write tests for crossing 20/100, reset-to-zero, sticky history, current thresholds, negative/invalid numbers, duplicate IDs and unsafe data.
- [ ] Run `node --test tests/domain.test.mjs`; verify missing implementation failure.
- [ ] Implement validation and pure transitions; run tests until green.
- [ ] Commit the domain and tests.

### Task 2: Actor state and effects

**Files:** scripts/service.mjs, scripts/effects.mjs, tests/service.test.mjs, tests/helpers.mjs.

**Interfaces:** `ResourceService({definitions, resolve, statusEffect})` with `get`, `set`, `adjust`, `reset`, `setEnabled`, `applyRules`.

- [ ] Write failing tests for permissions, per-Actor serialization, event replay protection, synthetic Actors, sticky/current effect cleanup and status-data preservation.
- [ ] Implement service and status conversion consuming Task 1 transition outputs; verify `npm test`.
- [ ] Commit service and tests.

### Task 3: Combat adapters

**Files:** scripts/combat.mjs, tests/combat.test.mjs.

**Interfaces:** `CombatIntegration` with `onAttackMessage`, `onDamage`, `onMidiComplete`, `applyItem`.

- [ ] Write failing tests for v6.1 associated Item/activity lookup, evaluated targets, misses, healing, GM election, Midi exclusion and activity filters.
- [ ] Implement adapters using `ResourceService.applyRules`; verify `npm test`.
- [ ] Commit combat adapters and tests.

### Task 4: Foundry UI and distribution

**Files:** module.json, scripts/main.mjs, scripts/ui.mjs, scripts/token-bars.mjs, templates/, styles/, lang/, README.md, tools/, .github/workflows/.

**Interfaces:** `game.modules.get("silverlane-resource-bars").api` exposes tracker/configuration/service and manual item application.

- [ ] Write failing rendering, bootstrap, manifest, localization and packaging tests.
- [ ] Implement ApplicationV2 tracker/editor/item rules, owner-only canvas overlays and Foundry hooks.
- [ ] Add macro examples, installation guide, CI and tag-triggered zip release tooling.
- [ ] Run full tests, syntax validation and a package build; commit.

### Finish

- [ ] Request one independent whole-branch code review; fix important findings with regression tests.
- [ ] Re-run all verification, fast-forward main if appropriate, and push requested code.
