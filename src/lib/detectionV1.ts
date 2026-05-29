/**
 * V1 Burpee Detection Engine — original working implementation.
 * Uses height-ratio state machine (HIGH/LOW) with front-camera only.
 */

export type RepState = "HIGH" | "LOW" | "UNKNOWN";

export type AlignmentStatus = "no-pose" | "too-close" | "too-far" | "off-center" | "aligned";

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
const MIN_VISIBILITY = 0.5;
const SMOOTHING_WINDOW = 4;
const MIN_LOW_DWELL_MS = 150;

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
  private standingHeight = 0;
  private thresholds: DetectionThresholds;

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
    this.ratioBuffer = [];
    this.repState = "UNKNOWN";
    this.hasBeenLow = false;
    this.lowEnteredTime = 0;
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

    if (!this.standingHeight) {
      const allVisible = keyLandmarks.every((l) => (l.visibility ?? 0) > MIN_VISIBILITY);
      const shoulderY = (lShoulder.y + rShoulder.y) / 2;
      const hipY = (lHip.y + rHip.y) / 2;
      const torsoVertical = hipY - shoulderY > 0.08;

      if (!allVisible) {
        alignmentStatus = "no-pose";
      } else {
        const centerX = (lShoulder.x + rShoulder.x + lHip.x + rHip.x) / 4;
        const offCenter = Math.abs(centerX - 0.5) > 0.15;
        const tooClose = nose.y < 0.02 || Math.max(lAnkle.y, rAnkle.y) > 0.98;
        const tooFar = currentHeight < 0.35;

        if (tooClose) alignmentStatus = "too-close";
        else if (tooFar) alignmentStatus = "too-far";
        else if (offCenter) alignmentStatus = "off-center";
        else alignmentStatus = "aligned";
      }

      if (allVisible && torsoVertical && currentHeight > 0.15) {
        this.calibrationHeights.push(currentHeight);
        calibrationCount = this.calibrationHeights.length;
      } else {
        this.calibrationHeights = [];
        calibrationCount = 0;
      }

      if (this.calibrationHeights.length >= CALIBRATION_FRAMES) {
        const sorted = [...this.calibrationHeights].sort((a, b) => a - b);
        this.standingHeight = sorted[Math.floor(sorted.length * 0.5)];
        this.repState = "HIGH";
        this.lastHighTime = now;
        this.ratioBuffer = [];
      }

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
