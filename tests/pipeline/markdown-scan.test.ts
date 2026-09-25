import { describe, it, expect } from "vitest";
import { isHeading, isLive, scanLines } from "../../src/pipeline/markdown-scan.js";

const scan = (text: string) => scanLines(text.split("\n"));

describe("scanLines", () => {
  it("marks a fenced run, its delimiters included", () => {
    const scanned = scan(["outside", "```js", "inside", "```", "after"].join("\n"));
    expect(scanned.map((line) => line.fenced)).toEqual([false, true, true, true, false]);
  });

  it("tracks ``` and ~~~ independently, so one cannot close the other", () => {
    const scanned = scan(["~~~", "```", "still inside", "~~~", "out"].join("\n"));
    expect(scanned.map((line) => line.fenced)).toEqual([true, true, true, true, false]);
  });

  // The rendered pause block relies on this: the agent's message is wrapped in a `~` run longer
  // than any run inside it, so a fence the agent wrote cannot break out of the one containing it.
  it("closes only on a run at least as long as the one that opened", () => {
    const scanned = scan(["~~~~", "~~~", "still inside", "~~~~", "out"].join("\n"));
    expect(scanned.map((line) => line.fenced)).toEqual([true, true, true, true, false]);
  });

  it("does not close on a delimiter carrying an info string", () => {
    const scanned = scan(["```", "inside", "```js", "still inside", "```", "out"].join("\n"));
    expect(scanned.map((line) => line.fenced)).toEqual([true, true, true, true, true, false]);
  });

  // CommonMark says an unclosed fence runs to the end of the document, and so does this. It is
  // why `advancement.ts` names a stray fence when a ticked marker cannot be found.
  it("lets an unterminated fence swallow the rest of the file", () => {
    const scanned = scan(["````bash", "echo hi", "```", "# Heading", "text"].join("\n"));
    expect(scanned.every((line) => line.fenced)).toBe(true);
  });

  // CommonMark: up to three spaces of indentation is still a fence; four or more (or a tab) is
  // an indented code block whose ``` is literal text. Batch B QA finding B2.
  it("opens a fence on a delimiter indented up to three spaces, never four", () => {
    const three = scan(["   ```", "inside", "   ```", "out"].join("\n"));
    expect(three.map((line) => line.fenced)).toEqual([true, true, true, false]);

    const four = scan(["    ```", "not fenced", "\t```", "still not"].join("\n"));
    expect(four.map((line) => line.fenced)).toEqual([false, false, false, false]);
  });

  it("does not close on a delimiter indented four or more spaces", () => {
    const scanned = scan(["```", "inside", "    ```", "still inside", "```", "out"].join("\n"));
    expect(scanned.map((line) => line.fenced)).toEqual([true, true, true, true, true, false]);
  });

  it("records the opener's index on every fenced line, the closer included", () => {
    const scanned = scan(["a", "```", "b", "```", "c"].join("\n"));
    expect(scanned.map((line) => line.fenceStart)).toEqual([undefined, 1, 1, 1, undefined]);
  });

  it("marks blockquote lines, indented ones included", () => {
    const scanned = scan(["plain", "> quoted", "  > indented", ">also"].join("\n"));
    expect(scanned.map((line) => line.quoted)).toEqual([false, true, true, true]);
  });
});

describe("isHeading / isLive", () => {
  it("counts an ATX heading only outside fences and blockquotes", () => {
    const scanned = scan(["# Real", "```", "## Fenced", "```", "> ### Quoted", "#NoSpace"].join("\n"));
    expect(scanned.filter(isHeading).map((line) => line.raw)).toEqual(["# Real"]);
  });

  it("isLive is the same rule without the heading test", () => {
    const scanned = scan(["text", "```", "fenced", "```", "> quoted"].join("\n"));
    expect(scanned.filter(isLive).map((line) => line.raw)).toEqual(["text"]);
  });
});
