/**
 * V1 Burpee Detection Engine — original working implementation.
 * Uses height-ratio state machine (HIGH/LOW) with front-camera only.
 */

export type RepState = "HIGH" | "LOW" | "UNKNOWN";

export type AlignmentStatus = "no-pose" | "too-close" | "too-far" | "off-center" | "off-left" | "off-right" | "head-cut" | "aligned";

export interface DetectionThresholds {
  highRatio: number;
  lowRatio: number;
  maxDuration: number;
}

export interface DetectionFrame {
  repCount: number;
  state: RepState;
  ratio: number;
  rawRatio: number;
  calibrated: boolean;
  calibrationCount: number;
  alignmentStatus: AlignmentStatus;
  stateChanged: boolean;
}

export const DEFAULT_THRESHOLDS: DetectionThresholds = {
  highRatio: 0.72,
  lowRatio: 0.58,
  maxDuration: 12000,
};

const CALIBRATION_FRAMES = 30;
const CALIBRATION_MIN_DURATION_MS = 2500;
const MIN_STANDING_HEIGHT = 0.35;
const MAX_STANDING_HEIGHT = 0.85;
const MIN_VISIBILITY = 0.5;
const SMOOTHING_WINDOW = 4;
const MIN_LOW_DWELL_MS = 150;

const STABILITY_WINDOW_MS = 1500;
const STABILITY_MAX_DRIFT = 0.02;
const STABILITY_MIN_FRAMES = 15;

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sq = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(sq);
}

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export class DetectionEngineV1 {
  private repState: RepState = "UNKNOWN";
  private lastHighTime = 0;
  private hasBeenLow = false;
  private repCount = 0;
  private lowEnteredTime = 0;
  private ratioBuffer: number[] = [];
  private calibrationHeights: number[] = [];
  private calibrationStartTime = 0;
  private standingHeight = 0;
  private thresholds: DetectionThresholds;

  // Stability tracking
  private stabilityFrames: { x: number; y: number; time: number }[] = [];
  private isStable = false;

  constructor(thresholds?: Partial<DetectionThresholds>) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  get isCalibrated(): boolean {
    return this.standingHeight > 0;
  }

  get currentState(): RepState {
    return this.repState;
  }

  get reps(): number {
    return this.repCount;
  }

  setThresholds(t: Partial<DetectionThresholds>) {
    Object.assign(this.thresholds, t);
  }

  getThresholds(): DetectionThresholds {
    return { ...this.thresholds };
  }

  reset() {
    this.repCount = 0;
    this.repState = "UNKNOWN";
    this.hasBeenLow = false;
    this.lowEnteredTime = 0;
    this.ratioBuffer = [];
  }

  recalibrate() {
    this.standingHeight = 0;
    this.calibrationHeights = [];
    this.calibrationStartTime = 0;
    this.ratioBuffer = [];
    this.repState = "UNKNOWN";
    this.hasBeenLow = false;
    this.lowEnteredTime = 0;
    this.isStable = false;
    this.stabilityFrames = [];
  }

  private checkStability(landmarks: Landmark[], now: number): { stable: boolean; progress: number } {
    const nose = landmarks[0];
    const lShoulder = landmarks[11];
    const rShoulder = landmarks[12];
    const lHip = landmarks[23];
    const rHip = landmarks[24];
    const lAnkle = landmarks[27];
    const rAnkle = landmarks[28];

    const keyLandmarks = [nose, lShoulder, rShoulder, lHip, rHip, lAnkle, rAnkle];
    const allVisible = keyLandmarks.every((l) => (l.visibility ?? 0) > MIN_VISIBILITY);
    if (!allVisible) {
      this.stabilityFrames = [];
      return { stable: false, progress: 0 };
    }

    const shoulderY = (lShoulder.y + rShoulder.y) / 2;
    const hipY = (lHip.y + rHip.y) / 2;
    if (hipY - shoulderY < 0.06) {
      this.stabilityFrames = [];
      return { stable: false, progress: 0 };
    }

    const core = [lShoulder, rShoulder, lHip, rHip];
    const cx = core.reduce((a, l) => a + l.x, 0) / core.length;
    const cy = core.reduce((a, l) => a + l.y, 0) / core.length;
    this.stabilityFrames.push({ x: cx, y: cy, time: now });

    const cutoff = now - STABILITY_WINDOW_MS;
    this.stabilityFrames = this.stabilityFrames.filter((f) => f.time >= cutoff);

    if (this.stabilityFrames.length < STABILITY_MIN_FRAMES) {
      return { stable: false, progress: this.stabilityFrames.length / STABILITY_MIN_FRAMES * 0.5 };
    }

    const xStd = stddev(this.stabilityFrames.map((f) => f.x));
    const yStd = stddev(this.stabilityFrames.map((f) => f.y));
    const totalDrift = Math.sqrt(xStd * xStd + yStd * yStd);

    if (totalDrift < STABILITY_MAX_DRIFT) {
      const timeSpan = this.stabilityFrames[this.stabilityFrames.length - 1].time - this.stabilityFrames[0].time;
      if (timeSpan >= STABILITY_WINDOW_MS * 0.8) {
        return { stable: true, progress: 1.0 };
      }
      return { stable: false, progress: 0.5 + 0.5 * (timeSpan / (STABILITY_WINDOW_MS * 0.8)) };
    }

    const driftRatio = Math.min(totalDrift / STABILITY_MAX_DRIFT, 2);
    return { stable: false, progress: Math.max(0, 1 - driftRatio) * 0.5 };
  }

  processFrame(landmarks: Landmark[], now: number): DetectionFrame {
    const nose = landmarks[0];
    const lShoulder = landmarks[11];
    const rShoulder = landmarks[12];
    const lHip = landmarks[23];
    const rHip = landmarks[24];
    const lAnkle = landmarks[27];
    const rAnkle = landmarks[28];

    const keyLandmarks = [nose, lShoulder, rShoulder, lHip, rHip, lAnkle, rAnkle];

    const visibleYs: number[] = [];
    for (const l of keyLandmarks) {
      if ((l.visibility ?? 0) > MIN_VISIBILITY) visibleYs.push(l.y);
    }
    const coreVisible = [lShoulder, rShoulder, lHip, rHip].every(
      (l) => (l.visibility ?? 0) > MIN_VISIBILITY
    );
    const currentHeight =
      visibleYs.length >= 4 && coreVisible
        ? Math.max(...visibleYs) - Math.min(...visibleYs)
        : 0;

    let alignmentStatus: AlignmentStatus = "no-pose";
    let calibrationCount = this.calibrationHeights.length;

    // --- Stability guard (same as V2) ---
    if (!this.isStable && !this.standingHeight) {
      const stability = this.checkStability(landmarks, now);
      if (!stability.stable) {
        return {
          repCount: this.repCount,
          state: this.repState,
          ratio: 0,
          rawRatio: 0,
          calibrated: false,
          calibrationCount: 0,
          alignmentStatus: "no-pose",
          stateChanged: false,
        };
      }
      this.isStable = true;
    }

    if (!this.standingHeight) {
      const allVisible = keyLandmarks.every((l) => (l.visibility ?? 0) > MIN_VISIBILITY);
      const shoulderY = (lShoulder.y + rShoulder.y) / 2;
      const hipY = (lHip.y + rHip.y) / 2;
      const torsoVertical = hipY - shoulderY > 0.08;

      const bodyGood = allVisible && torsoVertical && currentHeight > 0.15;
      if (!bodyGood) {
        if (this.calibrationHeights.length > 0) {
          this.calibrationHeights = [];
          this.calibrationStartTime = 0;
        }
        if (!allVisible) {
          this.isStable = false;
          this.stabilityFrames = [];
          return {
            repCount: this.repCount,
            state: this.repState,
            ratio: 0,
            rawRatio: 0,
            calibrated: false,
            calibrationCount: 0,
            alignmentStatus: "no-pose",
            stateChanged: false,
          };
        }
      }

      if (!allVisible) {
        alignmentStatus = "no-pose";
      } else {
        const centerX = (lShoulder.x + rShoulder.x + lHip.x + rHip.x) / 4;
        const headCut = nose.y < 0.02;
        const tooClose = headCut || Math.max(lAnkle.y, rAnkle.y) > 0.98;
        const tooFar = currentHeight < 0.35;

        if (headCut && !tooFar) alignmentStatus = "head-cut";
        else if (tooClose) alignmentStatus = "too-close";
        else if (tooFar) alignmentStatus = "too-far";
        else if (centerX - 0.5 > 0.15) alignmentStatus = "off-right";
        else if (centerX - 0.5 < -0.15) alignmentStatus = "off-left";
        else alignmentStatus = "aligned";
      }

      if (bodyGood && alignmentStatus === "aligned") {
        if (this.calibrationHeights.length === 0) {
          this.calibrationStartTime = now;
        }
        this.calibrationHeights.push(currentHeight);
        calibrationCount = this.calibrationHeights.length;
      } else if (bodyGood) {
        this.calibrationHeights = [];
        this.calibrationStartTime = 0;
        calibrationCount = 0;
      }

      const calibrationElapsed = this.calibrationStartTime > 0 ? now - this.calibrationStartTime : 0;
      const hasEnoughFrames = this.calibrationHeights.length >= CALIBRATION_FRAMES;
      const hasEnoughTime = calibrationElapsed >= CALIBRATION_MIN_DURATION_MS;

      if (hasEnoughFrames && hasEnoughTime) {
        const sorted = [...this.calibrationHeights].sort((a, b) => a - b);
        const candidateHeight = sorted[Math.floor(sorted.length * 0.5)];

        if (candidateHeight < MIN_STANDING_HEIGHT || candidateHeight > MAX_STANDING_HEIGHT) {
          this.calibrationHeights = [];
          this.calibrationStartTime = 0;
          calibrationCount = 0;
          return {
            repCount: this.repCount,
            state: this.repState,
            ratio: 0,
            rawRatio: 0,
            calibrated: false,
            calibrationCount: 0,
            alignmentStatus: candidateHeight < MIN_STANDING_HEIGHT ? "too-far" : "too-close",
            stateChanged: false,
          };
        }

        const heightStd = stddev(this.calibrationHeights);
        if (heightStd > candidateHeight * 0.08) {
          this.calibrationHeights = [];
          this.calibrationStartTime = 0;
          calibrationCount = 0;
          return {
            repCount: this.repCount,
            state: this.repState,
            ratio: 0,
            rawRatio: 0,
            calibrated: false,
            calibrationCount: 0,
            alignmentStatus: "aligned",
            stateChanged: false,
          };
        }

        this.standingHeight = candidateHeight;
        this.repState = "HIGH";
        this.lastHighTime = now;
        this.ratioBuffer = [];
      }

      const frameProgress = Math.min(this.calibrationHeights.length / CALIBRATION_FRAMES, 1);
      const timeProgress = Math.min(calibrationElapsed / CALIBRATION_MIN_DURATION_MS, 1);
      calibrationCount = Math.floor(Math.min(frameProgress, timeProgress) * CALIBRATION_FRAMES);

      return {
        repCount: this.repCount,
        state: this.repState,
        ratio: 0,
        rawRatio: 0,
        calibrated: this.standingHeight > 0,
        calibrationCount,
        alignmentStatus,
        stateChanged: false,
      };
    }

    // Post-calibration detection
    alignmentStatus = "aligned";
    if (currentHeight <= 0) {
      return {
        repCount: this.repCount,
        state: this.repState,
        ratio: 0,
        rawRatio: 0,
        calibrated: true,
        calibrationCount: CALIBRATION_FRAMES,
        alignmentStatus,
        stateChanged: false,
      };
    }

    const rawR = Math.min(currentHeight / this.standingHeight, 1.0);
    const buf = this.ratioBuffer;
    buf.push(rawR);
    if (buf.length > SMOOTHING_WINDOW) buf.shift();
    const r = buf.reduce((a, b) => a + b, 0) / buf.length;

    const t = this.thresholds;
    let newState: RepState = this.repState;
    if (r > t.highRatio) newState = "HIGH";
    else if (r < t.lowRatio) newState = "LOW";

    let stateChanged = false;
    if (newState !== this.repState) {
      if (newState === "LOW") {
        this.lowEnteredTime = now;
        this.hasBeenLow = false;
      }

      const lowDwell = now - this.lowEnteredTime;
      if (this.repState === "LOW" && lowDwell < MIN_LOW_DWELL_MS) {
        return {
          repCount: this.repCount,
          state: this.repState,
          ratio: r,
          rawRatio: rawR,
          calibrated: true,
          calibrationCount: CALIBRATION_FRAMES,
          alignmentStatus,
          stateChanged: false,
        };
      }

      if (this.repState === "LOW" && newState === "HIGH") {
        this.hasBeenLow = true;
      }

      if (newState === "HIGH") {
        if (this.hasBeenLow && now - this.lastHighTime < t.maxDuration) {
          this.repCount += 1;
        }
        this.lastHighTime = now;
        this.hasBeenLow = false;
      }
      this.repState = newState;
      stateChanged = true;
    }

    return {
      repCount: this.repCount,
      state: this.repState,
      ratio: r,
      rawRatio: rawR,
      calibrated: true,
      calibrationCount: CALIBRATION_FRAMES,
      alignmentStatus,
      stateChanged,
    };
  }
}
