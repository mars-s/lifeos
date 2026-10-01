# Week-plan UI surface brief

The week planner is a local extension of the established LifeOS day-plan component. It inherits
the visual system in `DESIGN.md`; it does not introduce a new visual direction.

- **Purpose:** review and adjust a schedule spanning two to fourteen usable day windows.
- **Structure:** a compact horizontally scrollable day strip selects one dominant daily timeline.
- **Signature interaction:** `Adjust week` reveals direct block movement and bottom-edge duration
  resizing in 15-minute steps, with equivalent keyboard controls.
- **Mobile behaviour:** the day strip scrolls horizontally, the selected timeline keeps its usable
  width, and the two proposal actions remain an equal row.
- **Safety:** all edits stay in widget state. The primary action sends the exact reviewed plan to
  the immutable proposal flow; it never writes to Things or Calendar.
- **Visual contract:** use LifeOS neutral surfaces, hairline separators, restrained task colours,
  system typography, and one blue primary action. The selected-day timeline remains the visual
  centre of gravity.

## As-built contract

`src/lifeos/ui/week-plan-v1.html` remains inside the day-plan visual world:

- The week strip is navigation, not a second planning canvas. It gives each day a date, block
  count, and planned duration, then opens one full-width timeline below it.
- The selected day uses the existing raised neutral and a narrow blue underline. Blue is otherwise
  reserved for focus and `Prepare proposal`.
- Timeline blocks reuse the established blue, green, and plum families. Their colour groups work;
  it does not claim priority, completion, or risk.
- `Adjust week` is a draft-only mode. Pointer movement and lower-edge resizing snap to 15-minute
  steps; Up and Down move a focused block, Option plus Up or Down changes its duration, and Shift
  changes the step to 60 minutes.
- `Cancel` restores the edit-session baseline. `Done editing` stores the reviewed draft in widget
  state, keyed to a source fingerprint, without mutating Things or Calendar.
- `Prepare proposal` sends the exact visible multi-day JSON into the immutable proposal flow. Its
  prompt explicitly says not to apply the plan.
- At compact widths, the header wraps, the day strip remains horizontally scrollable, the
  selected timeline keeps its reading order, and the two actions share one equal-width row.

## Finish review

**Disposition: ship.** This is an ordinary extension of the incumbent LifeOS planning instrument;
it does not justify a change to `DESIGN.md` or `.impeccable/design.json`.

Evidence checked on 23 September 2026:

- The finished source was compared with `PRODUCT.md`, `DESIGN.md`, this direction contract, and the
  existing ChatGPT day-plan surface brief.
- `.impeccable/review/week-desktop.png` is a 1440 x 1200 capture made after the finished source. It
  shows one lifted shell, a compact three-day strip, one dominant timeline, restrained task hues,
  a neutral secondary action, and one blue primary action.
- `.impeccable/review/week-mobile.png` is a 390 x 844 capture made after the finished source. It
  shows the wrapped header, usable day strip, unclipped timeline, visible unscheduled disclosure,
  week total, and equal-width 44px proposal actions.
- Static inspection confirmed paired light/dark tokens, visible three-pixel focus treatment,
  reduced-motion handling, a 520px compact breakpoint, keyboard edit instructions, bounded
  15-minute movement and resizing, draft restoration, source-fingerprinted widget state, and an
  exact reviewed-plan proposal handoff.
- `uv run pytest tests/test_server.py -q` passed all 18 tests. The renderer test confirms the
  versioned MCP Apps resource, editable controls, and two-day structured output; the CSP test
  confirms that the week-plan resource declares no external resource domains.

The rendered review was limited to the saved desktop and mobile captures. Light appearance and a
live assistive-technology pass remain useful broader regression checks, but no ship-blocking visual
or contract defect was found in the requested surface.
