# Cart Totals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the cart total with taxes on the checkout page.

**Architecture:**
- `src/cart/total.ts` computes the total.
- `src/ui/Checkout.tsx` shows it.

**Tech Stack:** TypeScript, vitest

**Spec:** `docs/superpowers/specs/2026-10-01-cart-totals-design.md`

## Global Constraints

- Amounts are integers in cents.
- No new dependencies.

---

### Task 1: Total function

**Files:**
- Create: `src/cart/total.ts`
- Test: `tests/cart/total.test.ts`

- [x] **Step 1: Write the failing test**
- [x] **Step 2: Implement**
- [x] **Step 3: Commit**

---

### Task 2: Taxes

**Files:**
- Modify: `src/cart/total.ts:10-24`
- Test: `tests/cart/total.test.ts`

**Interfaces:**
- Produces: `totalWithTax(items: Item[], rate: number): number`

- [x] **Step 1: Write the failing test**

~~~markdown
### Task 9: not a task
- [ ] not a step
## not a heading
~~~

- [ ] **Step 2: Implement**

~~~ts
export function totalWithTax(items: Item[], rate: number): number {
  return Math.round(total(items) * (1 + rate));
}
~~~

- [ ] **Step 3: Commit**

~~~bash
git add src/cart/total.ts tests/cart/total.test.ts
git commit -m "feat: taxes in the cart total"
~~~

### Task 3: Checkout shows the total

**Files:**
- Modify: `src/ui/Checkout.tsx`

- [ ] **Step 1: Render the total**
- [ ] **Step 2: Commit**

## Self-review notes

- [ ] not part of task 3
