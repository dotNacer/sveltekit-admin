---
"sveltekit-admin": minor
---

**An accessibility and responsive baseline for the whole admin.** Seven fixes, each one a thing that was measurably wrong rather than a guideline cited in the abstract.

**The focus indicator on form fields was effectively invisible.** `.ska-input:focus` set `outline: none` and replaced it with a box-shadow at 10% opacity — roughly 1.1:1 against the white background, where 3:1 is the minimum. It is now a 2px outline in the brand colour, which is itself contrasted, with the shadow only accompanying it. The invalid-field variant gets the same treatment in red.

**Nothing else had a focus indicator at all.** Buttons, sidebar links, the logo, back links, checkboxes and the logout button now share one `:focus-visible` rule — visible when tabbing, absent on mouse click.

**The admin was unusable below 900px.** The sidebar was `position: fixed` at 260px with the content offset by the same amount, leaving 115px of usable width on a 375px screen. Below that breakpoint the sidebar returns to the flow, its navigation becomes horizontal, and the form stops being capped at 600px.

**Motion could not be turned off.** Five `transition: all` rules live in the stylesheet; `prefers-reduced-motion: reduce` now neutralises them.

**Reaching the content took the whole sidebar.** A "Skip to content" link is now the first focusable element on the page, positioned off-screen until focused — off-screen rather than `display: none`, which would remove it from the tab order and make it pointless.

**Table headers carry `scope="col"`**, and the sidebar `<nav>` an `aria-label` (there are two navigation landmarks now that the pagination is one).

**Result and refusal banners are announced.** The delete confirmation is `role="status"` (it should not interrupt), a refused filter or sort is `role="alert"`.

Field-level error associations were already in place and are unchanged.
