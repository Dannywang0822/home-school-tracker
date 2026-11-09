export interface Clock {
  now(): number;
}

export function systemClock(): Clock {
  return { now: () => Date.now() };
}

export function frozenClock(epochMs: number): Clock {
  return { now: () => epochMs };
}
