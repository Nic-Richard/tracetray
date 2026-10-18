import { test } from "node:test";
import assert from "node:assert/strict";
import { pathInputError, pathStepStats } from "../src/paths.ts";

test("expected paths require a name and two to six distinct selected pages", () => {
  assert.equal(pathInputError("Buying a pack", ["https://example.com/", "https://example.com/cart"]), null);
  for (const [name, steps] of [[" ", ["one", "two"]], ["name", ["one"]], ["name", ["one", ""]], ["name", ["one", "one"]], ["name", Array.from({ length: 7 }, (_, i) => String(i))]]) assert.ok(pathInputError(name, steps));
});

test("step shares count from the start and previous step, including total drop-off and empty data", () => {
  const steps = [{ all: 100 }, { all: 60 }, { all: 0 }, { all: 0 }];
  assert.deepEqual(pathStepStats(steps, 0), { fromStart: 1, fromPrevious: null, lost: 0 });
  assert.deepEqual(pathStepStats(steps, 1), { fromStart: 0.6, fromPrevious: 0.6, lost: 40 });
  assert.deepEqual(pathStepStats(steps, 2), { fromStart: 0, fromPrevious: 0, lost: 60 });
  assert.deepEqual(pathStepStats(steps, 3), { fromStart: 0, fromPrevious: null, lost: 0 });
  assert.deepEqual(pathStepStats([{ all: 0 }, { all: 0 }], 1), { fromStart: null, fromPrevious: null, lost: 0 });
  assert.equal(pathStepStats([{ all: 10 }, { all: 20 }], 1).fromStart, 1);
});
