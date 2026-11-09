export const MINIMUM_SAMPLE_COVERAGE_PERCENT = 25;
export const MAX_REVIEW_TARGET = 10_000_000;

export function targetProgress(reviewed: number, target: number) {
  if (target <= 0) return 0;
  return Math.min(reviewed / target, 1);
}
