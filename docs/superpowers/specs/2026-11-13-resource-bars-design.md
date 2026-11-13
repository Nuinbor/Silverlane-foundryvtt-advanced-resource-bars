# Silverlane Advanced Resource Bars

Build a Foundry VTT v14 / D&D5e 6.1+ module with no required dependencies.
The user delegated remaining design decisions and requested implementation and a git push.

## Design

- World-wide GM-managed resource definitions; per-Actor values and history in module flags,
  including synthetic Actors on unlinked tokens. No changes to D&D5e system schemas.
- ApplicationV2 tracker opened by macro, actor-sheet action, or keybinding. Editable values,
  +/- buttons, threshold ticks with descriptive tooltips, history, and explicit reset/treat actions.
- GM editor for resources and ordered thresholds. Thresholds support core/D&D5e statuses,
  custom Active Effect changes, optional duration, and sticky or current-value behavior.
- A ready-made nerve damage resource: max 100, descriptive threshold 20, paralyzed at 100,
  reset to zero at max. Sticky history and effects survive numeric resets until treatment.
  Current-value effects follow the resulting value; terminal effects persist through the max reset.
- Multiple thresholds crossed in one update all fire. Overshoot resets to exactly zero once,
  not modulo, and one change cannot trigger more than one cycle.
- Token bars are an additional optional owner/GM-only overlay; existing HP bars stay untouched.
- Per-item rules support a resource delta on confirmed hit, positive applied damage, or manual
  application. Activity-ID filters distinguish attacks within one item. Native D&D5e attack chat
  messages supply hit results. Positive dnd5e.applyDamage events supply the actual damaged Actor.
  Optional Midi-QOL hit integration replaces native hit handling while Midi-QOL is active.
- One active GM handles broadcast hit events; actor owners handle local damage events. No
  unauthenticated socket proxy and no eval. Foreign-Actor manual writes require GM permission.
- Mutations are serialized per Actor on a client; persisted event IDs suppress repeated events.
  Effects created by this module are tagged and cleanup never removes unrelated effects.
- English and Russian localization, documented API/macros, automated tests and release packaging.

## Approaches

The implementation choice is a standalone ES-module package using Foundry's supported v14
ApplicationV2 and Actor flags. Requiring Midi-QOL would reduce native support; modifying the
D&D5e resource schema would couple storage to the game system. Both are intentionally avoided.

## Constraints and verification

Target minimum Foundry 14.367 and D&D5e 6.1.0, based on upstream system.json and source.
Use ActiveEffect.fromStatusEffect for system-aware conditions. Test domain logic, permission
checks, document integration, hit/damage selection, deduplication, UI rendering and packaging.
A licensed running Foundry instance is not assumed available; report that smoke-test limitation.
