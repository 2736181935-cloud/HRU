import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBalancedCondition, csvEscape, nextStep, STEP_ORDER } from '../lib/experiment.mjs';

test('均衡分组只选择当前样本数最少的条件', () => {
  for (let i = 0; i < 20; i += 1) {
    assert.equal(chooseBalancedCondition({ A: 4, B: 2, C: 3, D: 5 }).code, 'B');
  }
});

test('首个步骤和末尾步骤正确', () => {
  assert.equal(nextStep(null), STEP_ORDER[0]);
  assert.equal(nextStep(STEP_ORDER.at(-1)), 'complete');
});

test('CSV内容正确转义', () => {
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('a"b'), '"a""b"');
});
