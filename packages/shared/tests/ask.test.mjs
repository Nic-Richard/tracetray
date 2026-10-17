import test from "node:test";
import assert from "node:assert/strict";
import { answerBlocks, answerSpans, askHistory } from "../src/ask.ts";

test("answers keep paragraphs, headings and consecutive bullets in reading order", () => {
  assert.deepEqual(answerBlocks("## Visitors\n\n- First\n* Second\n• Third\n\nA conclusion."), ["Visitors", ["First", "Second", "Third"], "A conclusion."]);
});

test("answer formatting keeps HTML, links and unmatched markers as plain text", () => {
  const hostile = '<script>alert(1)</script> [Open](javascript:alert(1)) **unfinished';
  assert.deepEqual(answerSpans(hostile), [{ text: hostile, bold: false }]);
  assert.deepEqual(answerSpans("Look at **goals** first."), [{ text: "Look at ", bold: false }, { text: "goals", bold: true }, { text: " first.", bold: false }]);
});

test("follow-ups include only the last three answered questions, with matching roles", () => {
  const entries = [
    { question: "Old", answer: "Old answer" },
    { question: "A", answer: "Answer A" },
    { question: "Failed", error: "Unavailable" },
    { question: "B", answer: "Answer B" },
    { question: "C", answer: "Answer C" },
    { question: "Pending" }
  ];
  assert.deepEqual(askHistory(entries), [
    { role: "user", text: "A" }, { role: "assistant", text: "Answer A" },
    { role: "user", text: "B" }, { role: "assistant", text: "Answer B" },
    { role: "user", text: "C" }, { role: "assistant", text: "Answer C" }
  ]);
  assert.deepEqual(askHistory([]), []);
});
