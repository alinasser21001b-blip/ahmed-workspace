# Deletion audit — what should disappear from the student-facing product

## REMOVE_NOW (before any student sees it)
- `/motion-samples` route from the student preview build. It is developer
  documentation with replay buttons. It is preview-gated, but the *student
  preview is the preview* — students receive it. Gate it behind a separate
  internal flag or delete it from the bundle.
- “Preview Student” as a content author. Rename the fixture persona to a
  neutral human name; nothing a student reads should be signed by scaffolding.
- The `preview@student-os.example` autofill expectation in docs/screenshots —
  the sign-in field placeholder is fine; the developer credential leaking into
  any visible copy is not (currently only in tests — verify none renders).
- Browser default focus ring inside the search pill (replace with the designed
  focus treatment — removal of the UA artefact, not of focus visibility).

## REMOVE_LATER (after the pilot)
- The preview banner itself. For the pilot it must shrink (see order
  01_GLOBAL_SYSTEM): one compact line, absent inside Practice.
- The feedback entry point once the pilot ends.

## KEEP
- Honest empty-state copy; blocked-capability statements (reworked per RC-05);
  the feedback form (pilot instrument); Arabic-Indic interface numerals.

## INTERNAL_ONLY (never in the student bundle)
- e2e drivers, visual-gate, critique docs, design handoff — already outside
  the bundle; keep it that way.

## Searched for and NOT found (clean)
- Debug controls in shipped screens; duplicate CTAs on one surface; dead
  icons; fake states; lorem or placeholder-latin copy.
