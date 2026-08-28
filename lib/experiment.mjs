import { randomInt } from 'node:crypto';

export const CONDITIONS = [
  { code: 'A', aiWeight: 'high', feedback: 'developmental' },
  { code: 'B', aiWeight: 'high', feedback: 'non_developmental' },
  { code: 'C', aiWeight: 'low', feedback: 'developmental' },
  { code: 'D', aiWeight: 'low', feedback: 'non_developmental' },
];

export const STEP_ORDER = [
  'scenario', 'ai_authority_material', 'evaluation_complete',
  'feedback_material', 'comprehension_check', 'manipulation_check',
  'organizational_dehumanization', 'demographics',
];

export function chooseBalancedCondition(counts = {}) {
  const minimum = Math.min(...CONDITIONS.map(({ code }) => Number(counts[code] || 0)));
  const candidates = CONDITIONS.filter(({ code }) => Number(counts[code] || 0) === minimum);
  return candidates[randomInt(candidates.length)];
}

export function nextStep(currentStep) {
  if (!currentStep) return STEP_ORDER[0];
  const index = STEP_ORDER.indexOf(currentStep);
  return index >= 0 && index < STEP_ORDER.length - 1 ? STEP_ORDER[index + 1] : 'complete';
}

export function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
