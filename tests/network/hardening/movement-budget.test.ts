import { expect, test } from 'bun:test';
import { MovementBudget } from '../../../src/network/common/movement-budget.ts';

test('a burst of commands is limited to the time allowance and refills with wall time', () => {
  const budget = new MovementBudget();
  let admitted = 0;
  for (let index = 0; index < 23000; index++) if (budget.admit(255, 0)) admitted++;
  expect(admitted).toBe(7);
  expect(budget.admit(100, 1000)).toBe(true);
  expect(budget.admit(0, 1000)).toBe(true);
});
