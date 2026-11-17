// Brute force guard, shared by the login and by the settings that ask for the password or a code again:
// after 8 wrong answers, they are all refused for 15 minutes.
// Global rather than per address: behind the proxy every client can look the same, and there is one user.
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60_000;
let fails = 0;
let lockedUntil = 0;

export const isLocked = (now = Date.now()) => now < lockedUntil;

/** Counts a wrong answer, then waits a little: each guess costs time. */
export async function recordFailure(delayMs = 600) {
  if (++fails >= MAX_FAILS) {
    fails = 0;
    lockedUntil = Date.now() + LOCK_MS;
  }
  await new Promise((r) => setTimeout(r, delayMs));
}

export function recordSuccess() {
  fails = 0;
}

export const LOCKED_MESSAGE = "Trop d'essais. Réessaie dans quelques minutes.";

/** For tests. */
export function resetThrottle() {
  fails = 0;
  lockedUntil = 0;
}
