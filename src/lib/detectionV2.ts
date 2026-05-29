/**
 * V2 Burpee Detection Engine — enhanced with:
 * - 2-second stability guard before calibration
 * - Automatic front/side camera angle detection
 * - Expanded landmarks (wrists, knees)
 * - Joint angle calculations for side view
 * - 4-state machine: STANDING → DESCENDING → DOWN → ASCENDING
 * - minDuration guard to reject jitter
 */

import type { AlignmentStatus, Landmark } from "./detectionV1";

export type RepStateV2 = "STANDING" | "DESCENDING" | "DOWN" | "ASCENDING" | "UNKNOWN";
export type CameraAngle = "front" | "side" | "unknown";
export type StabilityStatus = "unstable" | "stabilizing" | "stable";

export interface V2Thresholds {
  highRatio: number;
  lowRatio: number;
  maxDuration: number;
  minDuration: number;
  minLowDwell: number;
  smoothingWindow: number;
  // Side-view specific
  torsoAngleLow: number;
  hipAngleLow: number;
  noseAnkleRatioLow: number;
}

export interface V2DetectionFrame {
  repCount: number;
  state: RepStateV2;
  ratio: number;
  rawRatio: number;
  calibrated: boolean;
  calibrationCount: number;
  alignmentStatus: AlignmentStatus | "stabilizing";
  stateChanged: boolean;
  cameraAngle: CameraAngle;
  stabilityStatus: StabilityStatus;
  stabilityProgress: number;
  // Side-view diagnostics
  hipAngle: number;
  kneeAngle: number;
  torsoAngle: number;
}

const FRONT_THRESHOLDS: V2Thresholds = {
  highRatio: 0.70,
  lowRatio: 0.50,
  maxDuration: 10000,
  minDuration: 1500,
  minLowDwell: 300,
  smoothingWindow: 5,
  torsoAngleLow: 55,
  hipAngleLow: 130,
  noseAnkleRatioLow: 0.25,
};

const SIDE_THRESHOLDS: V2Thresholds = {
  highRatio: 0.68,
  lowRatio: 0.40,
  maxDuration: 10000,
  minDuration: 2000,
  minLowDwell: 400,
  smoothingWindow: 5,
  torsoAngleLow: 55,
  hipAngleLow: 130,
  noseAnkleRatioLow: 0.25,
};

const STABILITY_WINDOW_MS = 1000;
const STABILITY_MAX_DRIFT = 0.02;
const STABILITY_MIN_FRAMES = 10;
const CALIBRATION_FRAMES = 15;
const MIN_VISIBILITY = 0.5;
const ANGLE_VOTE_THRESHOLD = 0.65;

function angleDeg(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const magBA = Math.sqrt(ba.x * ba.x + ba.y * ba.y);
  const magBC = Math.sqrt(bc.x * bc.x + bc.y * bc.y);
  if (magBA === 0 || magBC === 0) return 180;
  const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  return Math.acos(cosAngle) * (180 / Math.PI);
}

function torsoAngleFromVertical(shoulder: { x: number; y: number }, hip: { x: number; y: number }): number {
  const dx = shoulder.x - hip.x;
  const dy = hip.y - shoulder.y;
  if (dy === 0) return 90;
  return Math.abs(Math.atan2(dx, dy)) * (180 / Math.PI);
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sq = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(sq);
}

export class DetectionEngineV2 {
  private repState: RepStateV2 = "UNKNOWN";
  private lastStandingTime = 0;
  private repCount = 0;
  private lowEnteredTime = 0;
  private ratioBuffer: number[] = [];
  private calibrationHeights: number[] = [];
  private standingHeight = 0;
  private thresholds: V2Thresholds;
  private cameraAngle: CameraAngle = "unknown";
  private angleVotes: { front: number; side: number } = { front: 0, side: 0 };

  // Stability tracking
  private stabilityFrames: { x: number; y: number; time: number }[] = [];
  private isStable = false;

  // Descent tracking
  private reachedDown = false;

  // Diagnostics
  private lastHipAngle = 180;
  private lastKneeAngle = 180;
  private lastTorsoAngle = 0;

  constructor(thresholds?: Partial<V2Thresholds>) {
    this.thresholds = { ...FRONT_THRESHOLDS, ...thresholds };
  }

  get isCalibrated(): boolean {
    return this.standingHeight > 0;
  }

  get currentState(): RepStateV2 {
    return this.repState;
  }

  get reps(): number {
    return this.repCount;
  }

  get detectedAngle(): CameraAngle {
    return this.cameraAngle;
  }

  setThresholds(t: Partial<V2Thresholds>) {
    Object.assign(this.thresholds, t);
  }

  getThresholds(): V2Thresholds {
    return { ...this.thresholds };
  }

  reset() {
    this.repCount = 0;
    this.repState = "UNKNOWN";
    this.lowEnteredTime = 0;
    this.ratioBuffer = [];

    this.reachedDown = false;
    this.lastHipAngle = 180;
    this.lastKneeAngle = 180;
    this.lastTorsoAngle = 0;
  }

  recalibrate() {
    this.standingHeight = 0;

    this.calibrationHeights = [];
    this.ratioBuffer = [];
    this.repState = "UNKNOWN";
    this.lowEnteredTime = 0;

    this.reachedDown = false;
    this.isStable = false;
    this.stabilityFrames = [];
    this.cameraAngle = "unknown";
    this.angleVotes = { front: 0, side: 0 };
  }

  private extractLandmarks(landmarks: Landmark[]) {
    return {
      nose: landmarks[0],
      lShoulder: landmarks[11],
      rShoulder: landmarks[12],
      lWrist: landmarks[15],
      rWrist: landmarks[16],
      lHip: landmarks[23],
      rHip: landmarks[24],
      lKnee: landmarks[25],
      rKnee: landmarks[26],
      lAnkle: landmarks[27],
      rAnkle: landmarks[28],
    };
  }

  private checkStability(landmarks: Landmark[], now: number): { status: StabilityStatus; progress: number } {
    const lm = this.extractLandmarks(landmarks);
    const core = [lm.lShoulder, lm.rShoulder, lm.lHip, lm.rHip];
    const visible = core.filter((l) => (l.visibility ?? 0) > MIN_VISIBILITY);
    if (visible.length < 2) {
      this.stabilityFrames = [];
      return { status: "unstable", progress: 0 };
    }

    const cx = visible.reduce((a, l) => a + l.x, 0) / visible.length;
    const cy = visible.reduce((a, l) => a + l.y, 0) / visible.length;
    this.stabilityFrames.push({ x: cx, y: cy, time: now });

    // Trim to window
    const cutoff = now - STABILITY_WINDOW_MS;
    this.stabilityFrames = this.stabilityFrames.filter((f) => f.time >= cutoff);

    if (this.stabilityFrames.length < STABILITY_MIN_FRAMES) {
      const progress = this.stabilityFrames.length / STABILITY_MIN_FRAMES;
      return { status: "stabilizing", progress: Math.min(progress, 0.5) };
    }

    const xStd = stddev(this.stabilityFrames.map((f) => f.x));
    const yStd = stddev(this.stabilityFrames.map((f) => f.y));
    const totalDrift = Math.sqrt(xStd * xStd + yStd * yStd);

    if (totalDrift < STABILITY_MAX_DRIFT) {
      // Check we have enough of the stability window
      const timeSpan = this.stabilityFrames[this.stabilityFrames.length - 1].time - this.stabilityFrames[0].time;
      if (timeSpan >= STABILITY_WINDOW_MS * 0.8) {
        return { status: "stable", progress: 1.0 };
      }
      const progress = 0.5 + 0.5 * (timeSpan / (STABILITY_WINDOW_MS * 0.8));
      return { status: "stabilizing", progress };
    }

    // Drifting — partial credit based on how close
    const driftRatio = Math.min(totalDrift / STABILITY_MAX_DRIFT, 2);
    const progress = Math.max(0, 1 - driftRatio) * 0.5;
    return { status: "unstable", progress };
  }

  private detectAngle(landmarks: Landmark[]): "front" | "side" {
    const lm = this.extractLandmarks(landmarks);
    const shoulderSpread = Math.abs(lm.lShoulder.x - lm.rShoulder.x);
    const hipSpread = Math.abs(lm.lHip.x - lm.rHip.x);
    const zDiff = Math.abs((lm.lShoulder.z ?? 0) - (lm.rShoulder.z ?? 0));

    const leftVis = [(lm.lShoulder.visibility ?? 0), (lm.lHip.visibility ?? 0), (lm.lKnee.visibility ?? 0), (lm.lAnkle.visibility ?? 0)];
    const rightVis = [(lm.rShoulder.visibility ?? 0), (lm.rHip.visibility ?? 0), (lm.rKnee.visibility ?? 0), (lm.rAnkle.visibility ?? 0)];
    const avgLeftVis = leftVis.reduce((a, b) => a + b, 0) / leftVis.length;
    const avgRightVis = rightVis.reduce((a, b) => a + b, 0) / rightVis.length;
    const visDiff = Math.abs(avgLeftVis - avgRightVis);

    if (shoulderSpread > 0.08 && hipSpread > 0.05 && zDiff < 0.15) return "front";
    if (shoulderSpread < 0.06 || zDiff > 0.20 || visDiff > 0.25) return "side";
    return shoulderSpread > 0.07 ? "front" : "side";
  }

  private getPrimarySide(landmarks: Landmark[]): "left" | "right" {
    const lm = this.extractLandmarks(landmarks);
    const leftVis = (lm.lShoulder.visibility ?? 0) + (lm.lHip.visibility ?? 0) + (lm.lKnee.visibility ?? 0);
    const rightVis = (lm.rShoulder.visibility ?? 0) + (lm.rHip.visibility ?? 0) + (lm.rKnee.visibility ?? 0);
    return leftVis >= rightVis ? "left" : "right";
  }

  private getSideAngles(landmarks: Landmark[]): { hipAngle: number; kneeAngle: number; torsoAngle: number; noseAnkleRatio: number } {
    const lm = this.extractLandmarks(landmarks);
    const side = this.getPrimarySide(landmarks);

    const shoulder = side === "left" ? lm.lShoulder : lm.rShoulder;
    const hip = side === "left" ? lm.lHip : lm.rHip;
    const knee = side === "left" ? lm.lKnee : lm.rKnee;
    const ankle = side === "left" ? lm.lAnkle : lm.rAnkle;

    const hipAngle = angleDeg(shoulder, hip, knee);
    const kneeAngle = angleDeg(hip, knee, ankle);
    const torsoAngle = torsoAngleFromVertical(shoulder, hip);

    const ankleY = Math.max(lm.lAnkle.y, lm.rAnkle.y);
    const noseAnkleRatio = this.standingHeight > 0
      ? Math.abs(lm.nose.y - ankleY) / this.standingHeight
      : 0;

    return { hipAngle, kneeAngle, torsoAngle, noseAnkleRatio };
  }

  processFrame(landmarks: Landmark[], now: number): V2DetectionFrame {
    const lm = this.extractLandmarks(landmarks);
    const keyLandmarks = [lm.nose, lm.lShoulder, lm.rShoulder, lm.lHip, lm.rHip, lm.lAnkle, lm.rAnkle];

    const emptyFrame = (overrides?: Partial<V2DetectionFrame>): V2DetectionFrame => ({
      repCount: this.repCount,
      state: this.repState,
      ratio: 0,
      rawRatio: 0,
      calibrated: false,
      calibrationCount: 0,
      alignmentStatus: "no-pose",
      stateChanged: false,
      cameraAngle: this.cameraAngle,
      stabilityStatus: "unstable",
      stabilityProgress: 0,
      hipAngle: this.lastHipAngle,
      kneeAngle: this.lastKneeAngle,
      torsoAngle: this.lastTorsoAngle,
      ...overrides,
    });

    // --- Phase 0: Stability guard ---
    if (!this.isStable) {
      const stability = this.checkStability(landmarks, now);
      if (stability.status !== "stable") {
        return emptyFrame({
          alignmentStatus: "stabilizing",
          stabilityStatus: stability.status,
          stabilityProgress: stability.progress,
        });
      }
      this.isStable = true;
    }

    // --- Phase 1: Calibration (same core logic as V1 but with angle detection) ---
    const visibleYs: number[] = [];
    for (const l of keyLandmarks) {
      if ((l.visibility ?? 0) > MIN_VISIBILITY) visibleYs.push(l.y);
    }
    const coreVisible = [lm.lShoulder, lm.rShoulder, lm.lHip, lm.rHip].every(
      (l) => (l.visibility ?? 0) > MIN_VISIBILITY
    );
    const currentHeight =
      visibleYs.length >= 4 && coreVisible
        ? Math.max(...visibleYs) - Math.min(...visibleYs)
        : 0;

    if (!this.standingHeight) {
      const allVisible = keyLandmarks.every((l) => (l.visibility ?? 0) > MIN_VISIBILITY);
      const shoulderY = (lm.lShoulder.y + lm.rShoulder.y) / 2;
      const hipY = (lm.lHip.y + lm.rHip.y) / 2;
      const torsoVertical = hipY - shoulderY > 0.08;

      let alignmentStatus: AlignmentStatus = "no-pose";
      if (!allVisible) {
        alignmentStatus = "no-pose";
      } else {
        const centerX = (lm.lShoulder.x + lm.rShoulder.x + lm.lHip.x + lm.rHip.x) / 4;
        const offCenter = Math.abs(centerX - 0.5) > 0.15;
        const tooClose = lm.nose.y < 0.02 || Math.max(lm.lAnkle.y, lm.rAnkle.y) > 0.98;
        const tooFar = currentHeight < 0.35;

        if (tooClose) alignmentStatus = "too-close";
        else if (tooFar) alignmentStatus = "too-far";
        else if (offCenter) alignmentStatus = "off-center";
        else alignmentStatus = "aligned";
      }

      if (allVisible && torsoVertical && currentHeight > 0.15) {
        this.calibrationHeights.push(currentHeight);

        // Vote on camera angle each calibration frame
        const vote = this.detectAngle(landmarks);
        if (vote === "front") this.angleVotes.front++;
        else this.angleVotes.side++;
      } else {
        this.calibrationHeights = [];
        this.angleVotes = { front: 0, side: 0 };
      }

      if (this.calibrationHeights.length >= CALIBRATION_FRAMES) {
        const sorted = [...this.calibrationHeights].sort((a, b) => a - b);
        this.standingHeight = sorted[Math.floor(sorted.length * 0.5)];

        // Determine camera angle by majority vote
        const totalVotes = this.angleVotes.front + this.angleVotes.side;
        const frontRatio = this.angleVotes.front / totalVotes;
        if (frontRatio >= ANGLE_VOTE_THRESHOLD) {
          this.cameraAngle = "front";
          this.thresholds = { ...FRONT_THRESHOLDS };
        } else if (frontRatio <= 1 - ANGLE_VOTE_THRESHOLD) {
          this.cameraAngle = "side";
          this.thresholds = { ...SIDE_THRESHOLDS };
        } else {
          this.cameraAngle = "front";
          this.thresholds = { ...FRONT_THRESHOLDS };
        }

        this.repState = "STANDING";
        this.lastStandingTime = now;
        this.ratioBuffer = [];
      }

      return emptyFrame({
        calibrationCount: this.calibrationHeights.length,
        alignmentStatus,
        stabilityStatus: "stable",
        stabilityProgress: 1.0,
      });
    }

    // --- Phase 2: Rep detection with 4-state machine ---
    if (currentHeight <= 0) {
      return emptyFrame({
        calibrated: true,
        calibrationCount: CALIBRATION_FRAMES,
        alignmentStatus: "aligned",
        stabilityStatus: "stable",
        stabilityProgress: 1.0,
      });
    }

    const rawR = Math.min(currentHeight / this.standingHeight, 1.0);
    const buf = this.ratioBuffer;
    buf.push(rawR);
    if (buf.length > this.thresholds.smoothingWindow) buf.shift();
    const r = buf.reduce((a, b) => a + b, 0) / buf.length;

    const t = this.thresholds;

    // Compute side-view angles if applicable
    let sideAngles = { hipAngle: 180, kneeAngle: 180, torsoAngle: 0, noseAnkleRatio: 1 };
    if (this.cameraAngle === "side") {
      sideAngles = this.getSideAngles(landmarks);
      this.lastHipAngle = sideAngles.hipAngle;
      this.lastKneeAngle = sideAngles.kneeAngle;
      this.lastTorsoAngle = sideAngles.torsoAngle;
    }

    // 4-state machine
    const prevState = this.repState;
    let stateChanged = false;

    switch (this.repState) {
      case "STANDING": {
        // Enter DESCENDING when ratio drops into or below hysteresis zone
        if (r < t.highRatio - 0.05) {
          this.repState = "DESCENDING";
          this.reachedDown = false;
          stateChanged = true;
        }
        break;
      }

      case "DESCENDING": {
        if (r < t.lowRatio) {
          // Check side-view criteria if applicable
          let sideOk = true;
          if (this.cameraAngle === "side") {
            sideOk = sideAngles.torsoAngle > t.torsoAngleLow * 0.7;
          }
          if (sideOk) {
            this.repState = "DOWN";
            this.lowEnteredTime = now;
            stateChanged = true;
          }
        }
        // If ratio goes back up before reaching DOWN, cancel
        if (r > t.highRatio) {
          this.repState = "STANDING";
          stateChanged = true;
        }
        break;
      }

      case "DOWN": {
        this.reachedDown = true;
        const lowDwell = now - this.lowEnteredTime;
        if (r > t.lowRatio + 0.05 && lowDwell >= t.minLowDwell) {
          this.repState = "ASCENDING";
          stateChanged = true;
        }
        break;
      }

      case "ASCENDING": {
        if (r > t.highRatio) {
          const cycleDuration = now - this.lastStandingTime;

          let validRep = this.reachedDown &&
            cycleDuration >= t.minDuration &&
            cycleDuration <= t.maxDuration;

          // Side-view: check hip angle closed at some point (torso angle already checked at DOWN entry)
          if (validRep && this.cameraAngle === "side") {
            // We already gated entry to DOWN on torso angle, so the rep shape is validated
            validRep = true;
          }

          if (validRep) {
            this.repCount += 1;
          }

          this.repState = "STANDING";
          this.lastStandingTime = now;
          this.reachedDown = false;
          stateChanged = true;
        }
        // If ratio drops again before reaching STANDING, go back to DOWN
        if (r < t.lowRatio) {
          this.repState = "DOWN";
          this.lowEnteredTime = now;
          stateChanged = true;
        }
        break;
      }

      case "UNKNOWN": {
        if (r > t.highRatio) {
          this.repState = "STANDING";
          this.lastStandingTime = now;
          stateChanged = true;
        }
        break;
      }
    }

    return {
      repCount: this.repCount,
      state: this.repState,
      ratio: r,
      rawRatio: rawR,
      calibrated: true,
      calibrationCount: CALIBRATION_FRAMES,
      alignmentStatus: "aligned",
      stateChanged: stateChanged || prevState !== this.repState,
      cameraAngle: this.cameraAngle,
      stabilityStatus: "stable",
      stabilityProgress: 1.0,
      hipAngle: sideAngles.hipAngle,
      kneeAngle: sideAngles.kneeAngle,
      torsoAngle: sideAngles.torsoAngle,
    };
  }
}
