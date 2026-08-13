// Minimal assertion harness, same shape as the tracker's suites so the two
// repos read alike. jsc has print(), not always console.log.

const log = typeof print === 'function' ? print : console.log;

let passed = 0;
const failures = [];

export function ok(condition, message) {
  if (condition) passed += 1;
  else failures.push(message);
}

export function eq(actual, expected, message) {
  ok(Object.is(actual, expected), `${message} — expected ${expected}, got ${actual}`);
}

export function close(actual, expected, tolerance, message) {
  ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${message} — expected ${expected} +/- ${tolerance}, got ${actual}`,
  );
}

export function report(suite) {
  if (failures.length) {
    log(`FAIL ${suite}: ${failures.length} of ${passed + failures.length} assertions failed`);
    for (const failure of failures) log(`  - ${failure}`);
    throw new Error(`${suite} failed`);
  }
  log(`ok   ${suite}: ${passed} assertions`);
}

export { log };
