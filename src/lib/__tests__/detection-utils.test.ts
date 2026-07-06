import { describe, it, expect } from "vitest";
import { stddev, angleDeg, torsoAngleFromVertical } from "../detection-utils";

describe("stddev", () => {
  it("returns 0 for empty array", () => {
    expect(stddev([])).toBe(0);
  });

  it("returns 0 for single value", () => {
    expect(stddev([42])).toBe(0);
  });

  it("returns 0 for identical values", () => {
    expect(stddev([5, 5, 5, 5])).toBe(0);
  });

  it("returns correct stddev for known dataset", () => {
    const result = stddev([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(result).toBeCloseTo(2.0, 1);
  });
});

describe("angleDeg", () => {
  it("returns 90° for a right angle", () => {
    const a = { x: 1, y: 0 };
    const b = { x: 0, y: 0 };
    const c = { x: 0, y: 1 };
    expect(angleDeg(a, b, c)).toBeCloseTo(90, 1);
  });

  it("returns 180° for a straight line", () => {
    const a = { x: -1, y: 0 };
    const b = { x: 0, y: 0 };
    const c = { x: 1, y: 0 };
    expect(angleDeg(a, b, c)).toBeCloseTo(180, 1);
  });

  it("returns 0° for overlapping rays", () => {
    const a = { x: 1, y: 0 };
    const b = { x: 0, y: 0 };
    const c = { x: 2, y: 0 };
    expect(angleDeg(a, b, c)).toBeCloseTo(0, 1);
  });

  it("returns 180° when a vector has zero magnitude", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    const c = { x: 1, y: 1 };
    expect(angleDeg(a, b, c)).toBe(180);
  });
});

describe("torsoAngleFromVertical", () => {
  it("returns ~0° when standing upright", () => {
    const shoulder = { x: 0.5, y: 0.3 };
    const hip = { x: 0.5, y: 0.6 };
    expect(torsoAngleFromVertical(shoulder, hip)).toBeCloseTo(0, 0);
  });

  it("returns 90° when horizontal", () => {
    const shoulder = { x: 0.8, y: 0.5 };
    const hip = { x: 0.5, y: 0.5 };
    expect(torsoAngleFromVertical(shoulder, hip)).toBe(90);
  });

  it("returns ~45° when leaning at 45 degrees", () => {
    const shoulder = { x: 0.7, y: 0.3 };
    const hip = { x: 0.5, y: 0.5 };
    expect(torsoAngleFromVertical(shoulder, hip)).toBeCloseTo(45, 0);
  });
});
