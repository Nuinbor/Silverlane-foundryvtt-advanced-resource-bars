# Resource manager and threshold actions

**Goal:** Convenient GM management inspired by the fog manager, separate threshold Description/Effect fields, and native D&D5e dice/damage actions on Foundry 14 + D&D5e 5.3.3.

**Design:** Preserve the compact tracker and add a GM table opened through scene controls, module settings, or API. Rows are world characters or scene/selected token Actors; columns are resource definitions. Each cell has enable, numeric edit, +/- delta, managed effects and treatment. New/edit resource shortcuts open a list-based resource editor. Thresholds contain human Description and an Effect command, with status and advanced modifiers alongside it. A preset fills `[[/damage 6d10 type=necrotic]]`. Existing definitions migrate with an empty command, preserving all values/effects.

**Execution:** Parse a documented subset of native roll/damage syntax, never arbitrary macros or JS. Prepare native Roll/DamageRoll before writes. Persist prepared actions with the resource transition, then post one chat roll and optionally apply typed damage through Actor.applyDamage. Keep failed actions visible for retry; use stable message IDs and a native preApplyDamage marker saved atomically with HP to avoid reapplying damage after an interrupted cleanup. Ordinary native damage is untouched. Track and remove only managed effects; manual removal preserves threshold history.

**Choices:** User previously delegated implementation choices. Primary workflow is Foundry 14/D&D5e 5.3.3. Auto-apply vs chat-only was asked asynchronously; expose both with an explicit per-threshold checkbox. Keep existing Paralyzed config unchanged; adding damage is explicit in the editor.

## Tasks

- [x] Commands/actions: tests for native syntax, invalid input, prepared rolls, typed damage, message/damage retry and foreign permissions; implement focused commands/actions modules.
- [x] Service: persist prepared actions, retry without reroll, recurring terminal actions even with an existing status, safe effect removal, tests for failed prepare/write/cleanup.
- [x] UI: GM matrix, launchers, actor scopes, manual +/- amount, managed effect chips and retry; resource sidebar, Description/Effect editor and necrotic preset; tests for actual forms and actions.
- [x] Verify: full suite/check/build and static browser preview; independent final review; preserve compatibility and document limitations.
- [ ] Release 0.3.0: push and publish through existing workflow; verify public manifest and archive contents.

## Ledger

- Baseline: clean main at 3c5006a, existing 66 tests passed last release. Feature branch feat/resource-manager-threshold-rolls.
- References: fog manager table and scene control launcher; EasyModules/EasyTraps uses native D&D5e activity/chat workflows. Actual D&D5e 5.3.3 enrichers document `[[/damage 2d6 type=bludgeoning]]`; Actor.applyDamage accepts typed damage objects and preApplyDamage updates.
- Implemented native prepared rolls with persisted pending actions and stable chat IDs. Native preApplyDamage writes an applied-action marker in the same update as HP. Pending markers survive cleanup failures and later damage actions. Repeated terminal cycles roll damage without stacking existing statuses.
- Added actor/resource matrix, scope/search/custom step, quick resource editor, per-effect removal and retry. Existing compact tracker remains. Both API-opened and settings-menu managers refresh; a RED/GREEN regression also covers selection, scene changes, token creation/removal.
- Added separate Description/Effect fields, a necrotic command preset, explicit auto-damage checkbox, native formula validation, and resource sidebar. Old definitions gain empty commands and retain their statuses, values and history.
- Verification before final review: 85/85 tests, npm run check, npm run build, git diff --check passed. Static Chromium preview visually inspected at 1480px. Additional scene/selection regression passed 9/9 targeted main tests. Licensed Foundry runtime testing unavailable; README includes the required world smoke checks and exact threshold setup.
- Independent final review: no outstanding Critical/Important/Minor findings; 54 focused tests passed, native D&D5e 5.3.3 damage interfaces verified against source. Final full verification: 86/86 tests plus check/build/diff whitespace passed. Version 0.3.0; release uses the previously authorized main/tag workflow.
