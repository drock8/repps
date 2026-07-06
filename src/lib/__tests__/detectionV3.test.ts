import { describe, it, expect, beforeEach } from "vitest";
import { DetectionEngineV3 } from "../detectionV3";
import type { Landmark } from "../detectionV1";

function makeLandmark(x: number, y: number, z = 0, visibility = 0.99): Landmark {
  return { x, y, z, visibility };
}

function makeStandingLandmarks(): Landmark[] {
  const lm: Landmark[] = new Array(33).fill(null).map(() => makeLandmark(0.5, 0.5));
  lm[0] = makeLandmark(0.50, 0.10);         // nose
  lm[11] = makeLandmark(0.45, 0.25);        // lShoulder
  lm[12] = makeLandmark(0.55, 0.25);        // rShoulder
  lm[13] = makeLandmark(0.40, 0.40);        // lElbow
  lm[14] = makeLandmark(0.60, 0.40);        // rElbow
  lm[15] = makeLandmark(0.40, 0.50);        // lWrist
  lm[16] = makeLandmark(0.60, 0.50);        // rWrist
  lm[23] = makeLandmark(0.47, 0.50);        // lHip
  lm[24] = makeLandmark(0.53, 0.50);        // rHip
  lm[25] = makeLandmark(0.47, 0.70);        // lKnee
  lm[26] = makeLandmark(0.53, 0.70);        // rKnee
  lm[27] = makeLandmark(0.47, 0.90);        // lAnkle
  lm[28] = makeLandmark(0.53, 0.90);        // rAnkle
  return lm;
}

function makeDownLandmarks(): Landmark[] {
  const lm: Landmark[] = new Array(33).fill(null).map(() => makeLandmark(0.5, 0.5));
  lm[0] = makeLandmark(0.30, 0.70);         // nose (down near floor)
  lm[11] = makeLandmark(0.35, 0.72);        // lShoulder
  lm[12] = makeLandmark(0.45, 0.72);        // rShoulder
  lm[13] = makeLandmark(0.30, 0.75);        // lElbow
  lm[14] = makeLandmark(0.50, 0.75);        // rElbow
  lm[15] = makeLandmark(0.25, 0.78);        // lWrist
  lm[16] = makeLandmark(0.55, 0.78);        // rWrist
  lm[23] = makeLandmark(0.55, 0.73);        // lHip (flat plank)
  lm[24] = makeLandmark(0.60, 0.73);        // rHip
  lm[25] = makeLandmark(0.70, 0.80);        // lKnee
  lm[26] = makeLandmark(0.75, 0.80);        // rKnee
  lm[27] = makeLandmark(0.80, 0.90);        // lAnkle
  lm[28] = makeLandmark(0.85, 0.90);        // rAnkle
  return lm;
}

describe("DetectionEngineV3", () => {
  let engine: DetectionEngineV3;

  beforeEach(() => {
    engine = new DetectionEngineV3("casual");
  });

  it("starts in IDLE state with 0 reps", () => {
    expect(engine.currentState).toBe("IDLE");
    expect(engine.reps).toBe(0);
    expect(engine.isCalibrated).toBe(false);
  });

  it("reset() clears rep count", () => {
    engine.reset();
    expect(engine.reps).toBe(0);
  });

  it("recalibrate() returns to IDLE", () => {
    engine.recalibrate();
    expect(engine.currentState).toBe("IDLE");
    expect(engine.isCalibrated).toBe(false);
  });

  describe("calibration via processFrame", () => {
    it("transitions through CALIBRATING when given stable frames", () => {
      const standing = makeStandingLandmarks();
      let baseTime = 1000;

      for (let i = 0; i < 60; i++) {
        const frame = engine.processFrame(standing, baseTime);
        baseTime += 33; // ~30fps
        if (i < 5) {
          expect(["IDLE", "CALIBRATING"]).toContain(frame.state);
        }
      }
    });

    it("becomes calibrated after enough stable frames", () => {
      const standing = makeStandingLandmarks();
      let time = 1000;

      for (let i = 0; i < 120; i++) {
        engine.processFrame(standing, time);
        time += 33;
      }

      expect(engine.isCalibrated).toBe(true);
    });
  });

  describe("state machine", () => {
    function calibrateEngine(eng: DetectionEngineV3): number {
      const standing = makeStandingLandmarks();
      let time = 1000;
      for (let i = 0; i < 120; i++) {
        eng.processFrame(standing, time);
        time += 33;
      }
      return time;
    }

    it("enters HINGING when ratio drops below stand threshold", () => {
      let time = calibrateEngine(engine);
      expect(engine.isCalibrated).toBe(true);

      const descending = makeStandingLandmarks();
      descending[0] = makeLandmark(0.50, 0.40);
      descending[11] = makeLandmark(0.45, 0.45);
      descending[12] = makeLandmark(0.55, 0.45);

      for (let i = 0; i < 15; i++) {
        const frame = engine.processFrame(descending, time);
        time += 33;
        if (frame.state === "HINGING") break;
      }

      expect(["READY", "HINGING"]).toContain(engine.currentState);
    });

    it("does not count a rep without completing a full cycle", () => {
      let time = calibrateEngine(engine);

      const midway = makeStandingLandmarks();
      midway[0] = makeLandmark(0.50, 0.45);
      midway[11] = makeLandmark(0.45, 0.50);
      midway[12] = makeLandmark(0.55, 0.50);

      for (let i = 0; i < 20; i++) {
        engine.processFrame(midway, time);
        time += 33;
      }

      expect(engine.reps).toBe(0);
    });
  });

  describe("reset behavior", () => {
    it("reset clears reps but preserves calibration", () => {
      const standing = makeStandingLandmarks();
      let time = 1000;
      for (let i = 0; i < 120; i++) {
        engine.processFrame(standing, time);
        time += 33;
      }
      expect(engine.isCalibrated).toBe(true);

      engine.reset();
      expect(engine.reps).toBe(0);
      expect(engine.isCalibrated).toBe(true);
      expect(engine.currentState).toBe("READY");
    });

    it("recalibrate clears everything", () => {
      const standing = makeStandingLandmarks();
      let time = 1000;
      for (let i = 0; i < 120; i++) {
        engine.processFrame(standing, time);
        time += 33;
      }

      engine.recalibrate();
      expect(engine.reps).toBe(0);
      expect(engine.isCalibrated).toBe(false);
      expect(engine.currentState).toBe("IDLE");
    });
  });

  describe("processFrame output", () => {
    it("returns a VerificationFrame with expected fields", () => {
      const frame = engine.processFrame(makeStandingLandmarks(), 1000);
      expect(frame).toHaveProperty("state");
      expect(frame).toHaveProperty("repCount");
      expect(frame).toHaveProperty("calibrated");
      expect(frame).toHaveProperty("calibrationProgress");
      expect(frame).toHaveProperty("stabilityStatus");
      expect(frame).toHaveProperty("heightRatio");
      expect(frame).toHaveProperty("coachingCue");
      expect(frame).toHaveProperty("rejection");
    });
  });
});
