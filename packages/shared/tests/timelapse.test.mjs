import assert from "node:assert/strict";
import test from "node:test";
import { blendFrames, timelapseGroups } from "../src/timelapse.ts";

const group = (track, share, x, y, headline = track) => ({ id: 0, track, key: null, headline, share, centre: [x, y] });
const frame = groups => ({ points: [], groups });

test("tracked groups move between analyses, new ones fade in and gone ones fade out", () => {
  const from = frame([group("a", 0.6, 0.2, 1), group("gone", 0.4, 0.9, 2)]);
  const to = frame([group("a", 0.4, 0.4, 1.5), group("new", 0.6, 0.5, 2.5)]);
  const half = Object.fromEntries(blendFrames(from, to, 0.5).map(g => [g.id, g]));
  assert.deepEqual([half.a.x, half.a.y, half.a.share, half.a.opacity].map(v => Math.round(v * 100) / 100), [0.3, 1.25, 0.5, 1]);
  assert.equal(half.gone.opacity, 0.5);
  assert.equal(half.new.opacity, 0.5);
  assert.deepEqual(blendFrames(from, to, 1).find(g => g.id === "gone").opacity, 0);
});

test("each group keeps one identity across the history, in order of first appearance", () => {
  const frames = [frame([group("a", 1, 0, 0)]), null, frame([group("b", 0.5, 0, 0), group("a", 0.5, 0, 0)])];
  assert.deepEqual(timelapseGroups(frames).map(g => g.id), ["a", "b"]);
});
