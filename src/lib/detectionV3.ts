// @ts-nocheck — WIP, remove when V3 coaching is wired up
import type { AlignmentStatus, Landmark } from "./detectionV1";

export type VerificationState =
  | "IDLE"
  | "CALIBRATING"
  | "READY"
  | "HINGING"
  | "BOTTOM"
  | "DRIVING"
  | "RISING";

export type CyclePhase = "HINGING" | "BOTTOM" | "DRIVING" | "RISING";

export type RejectionReason =
  | "shallow_descent"
  | "no_plank"
  | "no_floor_contact"
  | "forward_drift"
  | "incomplete_rise"
  | "too_slow"
  | "jitter"
  | "no_jump"
  | "no_tuck"
  | "lost_tracking";

export type CoachingCue =
  | "keep_going_down"
  | "lower_your_chest"
  | "push_up_and_stand"
  | "stay_in_frame";

export type CameraAngle = "front" | "side" | "unknown";
export type StabilityStatus = "unstable" | "stabilizing" | "stable";
export type DifficultyLevel = "casual" | "standard" | "athlete" | "elite";

export interface VerificationFrame {
  state: VerificationState;
  stateChanged: boolean;
  repCount: number;

  calibrated: boolean;
  calibrationProgress: number;
  stabilityStatus: StabilityStatus;
  cameraAngle: CameraAngle;
  alignmentStatus: AlignmentStatus | "stabilizing";

  heightRatio: number;
  rawHeightRatio: number;
  noseAnkleRatio: number;

  hipAngle: number | null;
  kneeAngle: number | null;
  elbowAngle: number | null;
  torsoAngle: number | null;

  rejection: RejectionReason | null;
  coachingCue: CoachingCue | null;

  cyclePhase: CyclePhase | null;
  cycleDuration: number;
  deepestPhase: CyclePhase | null;
  difficultyLevel: DifficultyLevel;
}

interface V3Thresholds {
  floorRatio: number;
  standRatio: number;
  minDuration: number;
  maxDuration: number;
  minFloorDwell: number;
  noseAnkleRatio: number | null;
  requirePlank: boolean;
  requireFloorContact: boolean;
  requireJump: boolean;
  requireTuckJump: boolean;
  requireFullExtension: number;
  hipExtension: number;
  kneeExtension: number;
  plankTorsoAngle: number;
}

interface ThresholdSet {
  front: V3Thresholds;
  side: V3Thresholds;
}

const CASUAL_THRESHOLDS: ThresholdSet = {
  front: {
    floorRatio: 0.55,
    standRatio: 0.80,
    minDuration: 800,
    maxDuration: 15000,
    minFloorDwell: 100,
    noseAnkleRatio: null,
    requirePlank: false,
    requireFloorContact: false,
    requireJump: false,
    requireTuckJump: false,
    requireFullExtension: 0.80,
    hipExtension: 155,
    kneeExtension: 150,
    plankTorsoAngle: 0,
  },
  side: {
    floorRatio: 0.50,
    standRatio: 0.80,
    minDuration: 800,
    maxDuration: 15000,
    minFloorDwell: 100,
    noseAnkleRatio: null,
    requirePlank: false,
    requireFloorContact: false,
    requireJump: false,
    requireTuckJump: false,
    requireFullExtension: 0.80,
    hipExtension: 155,
    kneeExtension: 150,
    plankTorsoAngle: 0,
  },
};

const STANDARD_THRESHOLDS: ThresholdSet = {
  front: {
    floorRatio: 0.50,
    standRatio: 0.78,
    minDuration: 800,
    maxDuration: 12000,
    minFloorDwell: 300,
    noseAnkleRatio: 0.55,
    requirePlank: true,
    requireFloorContact: true,
    requireJump: false,
    requireTuckJump: false,
    requireFullExtension: 0.78,
    hipExtension: 145,
    kneeExtension: 140,
    plankTorsoAngle: 35,
  },
  side: {
    floorRatio: 0.48,
    standRatio: 0.78,
    minDuration: 800,
    maxDuration: 12000,
    minFloorDwell: 300,
    noseAnkleRatio: 0.50,
    requirePlank: true,
    requireFloorContact: true,
    requireJump: false,
    requireTuckJump: false,
    requireFullExtension: 0.78,
    hipExtension: 145,
    kneeExtension: 140,
    plankTorsoAngle: 35,
  },
};

const ATHLETE_THRESHOLDS: ThresholdSet = {
  front: {
    floorRatio: 0.35,
    standRatio: 0.90,
    minDuration: 800,
    maxDuration: 10000,
    minFloorDwell: 400,
    noseAnkleRatio: 0.35,
    requirePlank: true,
    requireFloorContact: true,
    requireJump: true,
    requireTuckJump: false,
    requireFullExtension: 0.90,
    hipExtension: 160,
    kneeExtension: 160,
    plankTorsoAngle: 60,
  },
  side: {
    floorRatio: 0.32,
    standRatio: 0.90,
    minDuration: 800,
    maxDuration: 10000,
    minFloorDwell: 450,
    noseAnkleRatio: 0.30,
    requirePlank: true,
    requireFloorContact: true,
    requireJump: true,
    requireTuckJump: false,
    requireFullExtension: 0.90,
    hipExtension: 160,
    kneeExtension: 160,
    plankTorsoAngle: 60,
  },
};

const ELITE_THRESHOLDS: ThresholdSet = {
  front: {
    floorRatio: 0.30,
    standRatio: 0.92,
    minDuration: 800,
    maxDuration: 10000,
    minFloorDwell: 400,
    noseAnkleRatio: 0.32,
    requirePlank: true,
    requireFloorContact: true,
    requireJump: true,
    requireTuckJump: true,
    requireFullExtension: 0.92,
    hipExtension: 165,
    kneeExtension: 165,
    plankTorsoAngle: 60,
  },
  side: {
    floorRatio: 0.28,
    standRatio: 0.92,
    minDuration: 800,
    maxDuration: 10000,
    minFloorDwell: 500,
    noseAnkleRatio: 0.28,
    requirePlank: true,
    requireFloorContact: true,
    requireJump: true,
    requireTuckJump: true,
    requireFullExtension: 0.92,
    hipExtension: 165,
    kneeExtension: 165,
    plankTorsoAngle: 60,
  },
};

const DIFFICULTY_THRESHOLDS: Record<DifficultyLevel, ThresholdSet> = {
  casual: CASUAL_THRESHOLDS,
  standard: STANDARD_THRESHOLDS,
  athlete: ATHLETE_THRESHOLDS,
  elite: ELITE_THRESHOLDS,
};

const SMOOTHING_WINDOW = 5;
const CALIBRATION_FRAMES = 15;
const CALIBRATION_MIN_DURATION_MS = 2000;
const STABILITY_WINDOW_MS = 1500;
const STABILITY_MAX_DRIFT = 0.02;
const STABILITY_MIN_FRAMES = 15;
const MIN_STANDING_HEIGHT = 0.35;
const MAX_STANDING_HEIGHT = 0.85;
const MIN_VISIBILITY = 0.5;
const SOFT_VISIBILITY = 0.3;
const ANGLE_VOTE_THRESHOLD = 0.65;
const JITTER_GUARD_MS = 800;
const LOST_TRACKING_MS = 500;

const COACHING_HINGING_TIMEOUT = 3000;
const COACHING_BOTTOM_TIMEOUT = 2000;
const COACHING_DRIVING_TIMEOUT = 3000;

const PHASE_ORDER: CyclePhase[] = ["HINGING", "BOTTOM", "DRIVING", "RISING"];

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

function isPhaseDeeper(a: CyclePhase, b: CyclePhase): boolean {
  return PHASE_ORDER.indexOf(a) > PHASE_ORDER.indexOf(b);
}

export class DetectionEngineV3 {
  private state: VerificationState = "IDLE";
  private repCount = 0;
  private difficulty: DifficultyLevel;
  private thresholds: V3Thresholds;
  private cameraAngle: CameraAngle = "unknown";
  private angleVotes = { front: 0, side: 0 };

  // Stability
  private stabilityFrames: { x: number; y: number; time: number }[] = [];
  private isStable = false;

  // Calibration
  private calibrationHeights: number[] = [];
  private calibrationStartTime = 0;
  private standingHeight = 0;
  private standingAnkleY = 0;
  private standingCenterY = 0;

  // Smoothing
  private ratioBuffer: number[] = [];

  // Cycle tracking
  private cycleStartTime = 0;
  private bottomEnteredTime = 0;
  private deepestPhase: CyclePhase | null = null;
  private hingingEnteredTime = 0;
  private drivingEnteredTime = 0;
  // Jump detection
  private jumpDetected = false;
  private handsOverhead = false;
  private tuckDetected = false;
  private airStartTime = 0;

  // Ratio tracking for rising detection
  private bottomMinRatio = 1;

  // Lost tracking
  private lastGoodTrackingTime = 0;

  // Output per frame
  private lastRejection: RejectionReason | null = null;

  // Angle diagnostics
  private lastHipAngle: number | null = null;
  private lastKneeAngle: number | null = null;
  private lastElbowAngle: number | null = null;
  private lastTorsoAngle: number | null = null;
  private lastNoseAnkleRatio = 0;

  constructor(difficulty: DifficultyLevel = "standard") {
    this.difficulty = difficulty;
    const set = DIFFICULTY_THRESHOLDS[difficulty];
    this.thresholds = { ...set.front };
  }

  get isCalibrated(): boolean { return this.standingHeight > 0; }
  get currentState(): VerificationState { return this.state; }
  get reps(): number { return this.repCount; }
  get detectedAngle(): CameraAngle { return this.cameraAngle; }

  setDifficulty(level: DifficultyLevel) {
    this.difficulty = level;
    const angleKey = this.cameraAngle === "side" ? "side" : "front";
    this.thresholds = { ...DIFFICULTY_THRESHOLDS[level][angleKey] };
  }

  reset() {
    this.repCount = 0;
    this.state = this.standingHeight > 0 ? "READY" : "IDLE";
    this.ratioBuffer = [];
    this.resetCycle();
  }

  recalibrate() {
    this.standingHeight = 0;
    this.standingAnkleY = 0;
    this.standingCenterY = 0;
    this.calibrationHeights = [];
    this.calibrationStartTime = 0;
    this.ratioBuffer = [];
    this.state = "IDLE";
    this.isStable = false;
    this.stabilityFrames = [];
    this.cameraAngle = "unknown";
    this.angleVotes = { front: 0, side: 0 };
    this.resetCycle();
  }

  private resetCycle() {
    this.cycleStartTime = 0;
    this.bottomEnteredTime = 0;
    this.deepestPhase = null;
    this.hingingEnteredTime = 0;
    this.drivingEnteredTime = 0;
    this.jumpDetected = false;
    this.handsOverhead = false;
    this.tuckDetected = false;
    this.airStartTime = 0;
    this.bottomMinRatio = 1;
    this.lastRejection = null;
  }

  private extractLandmarks(landmarks: Landmark[]) {
    return {
      nose: landmarks[0],
      lShoulder: landmarks[11],
      rShoulder: landmarks[12],
      lElbow: landmarks[13],
      rElbow: landmarks[14],
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
    const keyLandmarks = [lm.nose, lm.lShoulder, lm.rShoulder, lm.lHip, lm.rHip, lm.lAnkle, lm.rAnkle];
    const allVisible = keyLandmarks.every((l) => (l.visibility ?? 0) > MIN_VISIBILITY);
    if (!allVisible) {
      this.stabilityFrames = [];
      return { status: "unstable", progress: 0 };
    }

    const shoulderY = (lm.lShoulder.y + lm.rShoulder.y) / 2;
    const hipY = (lm.lHip.y + lm.rHip.y) / 2;
    if (hipY - shoulderY < 0.06) {
      this.stabilityFrames = [];
      return { status: "unstable", progress: 0 };
    }

    const core = [lm.lShoulder, lm.rShoulder, lm.lHip, lm.rHip];
    const cx = core.reduce((a, l) => a + l.x, 0) / core.length;
    const cy = core.reduce((a, l) => a + l.y, 0) / core.length;
    this.stabilityFrames.push({ x: cx, y: cy, time: now });

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
      const timeSpan = this.stabilityFrames[this.stabilityFrames.length - 1].time - this.stabilityFrames[0].time;
      if (timeSpan >= STABILITY_WINDOW_MS * 0.8) {
        return { status: "stable", progress: 1.0 };
      }
      const progress = 0.5 + 0.5 * (timeSpan / (STABILITY_WINDOW_MS * 0.8));
      return { status: "stabilizing", progress };
    }

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

  private computeAngles(landmarks: Landmark[]): {
    hipAngle: number | null;
    kneeAngle: number | null;
    elbowAngle: number | null;
    torsoAngle: number | null;
    noseAnkleRatio: number;
  } {
    const lm = this.extractLandmarks(landmarks);
    const ankleY = Math.max(lm.lAnkle.y, lm.rAnkle.y);
    const noseAnkleRatio = this.standingHeight > 0
      ? Math.abs(lm.nose.y - ankleY) / this.standingHeight
      : 1;

    if (this.cameraAngle === "side") {
      const side = this.getPrimarySide(landmarks);
      const shoulder = side === "left" ? lm.lShoulder : lm.rShoulder;
      const elbow = side === "left" ? lm.lElbow : lm.rElbow;
      const wrist = side === "left" ? lm.lWrist : lm.rWrist;
      const hip = side === "left" ? lm.lHip : lm.rHip;
      const knee = side === "left" ? lm.lKnee : lm.rKnee;
      const ankle = side === "left" ? lm.lAnkle : lm.rAnkle;

      const hipVis = Math.min((shoulder.visibility ?? 0), (hip.visibility ?? 0), (knee.visibility ?? 0));
      const kneeVis = Math.min((hip.visibility ?? 0), (knee.visibility ?? 0), (ankle.visibility ?? 0));
      const elbowVis = Math.min((shoulder.visibility ?? 0), (elbow.visibility ?? 0), (wrist.visibility ?? 0));
      const torsoVis = Math.min((shoulder.visibility ?? 0), (hip.visibility ?? 0));

      return {
        hipAngle: hipVis > SOFT_VISIBILITY ? angleDeg(shoulder, hip, knee) : null,
        kneeAngle: kneeVis > SOFT_VISIBILITY ? angleDeg(hip, knee, ankle) : null,
        elbowAngle: elbowVis > SOFT_VISIBILITY ? angleDeg(shoulder, elbow, wrist) : null,
        torsoAngle: torsoVis > SOFT_VISIBILITY ? torsoAngleFromVertical(shoulder, hip) : null,
        noseAnkleRatio,
      };
    }

    // Front view: use bilateral averages where possible
    const shoulderY = (lm.lShoulder.y + lm.rShoulder.y) / 2;
    const hipY = (lm.lHip.y + lm.rHip.y) / 2;
    const shoulderVis = Math.min((lm.lShoulder.visibility ?? 0), (lm.rShoulder.visibility ?? 0));
    const hipVis = Math.min((lm.lHip.visibility ?? 0), (lm.rHip.visibility ?? 0));

    const torsoAngle = (shoulderVis > SOFT_VISIBILITY && hipVis > SOFT_VISIBILITY)
      ? torsoAngleFromVertical(
          { x: (lm.lShoulder.x + lm.rShoulder.x) / 2, y: shoulderY },
          { x: (lm.lHip.x + lm.rHip.x) / 2, y: hipY }
        )
      : null;

    // Front-view hip/knee angles are less reliable but we compute them when visible
    let hipAngle: number | null = null;
    let kneeAngle: number | null = null;
    const bestSide = this.getPrimarySide(landmarks);
    const shoulder = bestSide === "left" ? lm.lShoulder : lm.rShoulder;
    const hip = bestSide === "left" ? lm.lHip : lm.rHip;
    const knee = bestSide === "left" ? lm.lKnee : lm.rKnee;
    const ankle = bestSide === "left" ? lm.lAnkle : lm.rAnkle;

    const hVis = Math.min((shoulder.visibility ?? 0), (hip.visibility ?? 0), (knee.visibility ?? 0));
    const kVis = Math.min((hip.visibility ?? 0), (knee.visibility ?? 0), (ankle.visibility ?? 0));
    if (hVis > SOFT_VISIBILITY) hipAngle = angleDeg(shoulder, hip, knee);
    if (kVis > SOFT_VISIBILITY) kneeAngle = angleDeg(hip, knee, ankle);

    // Front-view elbow angle: use the best-visibility side
    let elbowAngle: number | null = null;
    const lElbow = lm.lElbow;
    const rElbow = lm.rElbow;
    const lEVis = Math.min((lm.lShoulder.visibility ?? 0), (lElbow.visibility ?? 0), (lm.lWrist.visibility ?? 0));
    const rEVis = Math.min((lm.rShoulder.visibility ?? 0), (rElbow.visibility ?? 0), (lm.rWrist.visibility ?? 0));
    if (lEVis > SOFT_VISIBILITY || rEVis > SOFT_VISIBILITY) {
      if (lEVis >= rEVis) {
        elbowAngle = angleDeg(lm.lShoulder, lElbow, lm.lWrist);
      } else {
        elbowAngle = angleDeg(lm.rShoulder, rElbow, lm.rWrist);
      }
    }

    return { hipAngle, kneeAngle, elbowAngle, torsoAngle, noseAnkleRatio };
  }

  // Returns null if bottom entry is valid, or a rejection reason if not
  private checkBottomEntry(ratio: number, noseAnkleRatio: number, torsoAngle: number | null, elbowAngle: number | null, landmarks: Landmark[]): RejectionReason | null {
    const t = this.thresholds;

    if (ratio >= t.floorRatio) return "shallow_descent";

    if (this.cameraAngle === "side") {
      const sideCheck = torsoAngle !== null && torsoAngle > t.plankTorsoAngle;
      if (t.requirePlank && !sideCheck) return "no_plank";

      // Side view: check shoulder-Y drop toward hip-Y
      const lm = this.extractLandmarks(landmarks);
      const side = this.getPrimarySide(landmarks);
      const shoulder = side === "left" ? lm.lShoulder : lm.rShoulder;
      const hip = side === "left" ? lm.lHip : lm.rHip;
      if ((shoulder.visibility ?? 0) > MIN_VISIBILITY && (hip.visibility ?? 0) > MIN_VISIBILITY) {
        const shoulderHipGap = Math.abs(shoulder.y - hip.y);
        if (t.requireFloorContact && shoulderHipGap > this.standingHeight * 0.15) {
          // Shoulders haven't dropped close enough to hips — not fully down yet
        }
      }
      return null;
    }

    // Front view: multi-signal fusion
    if (!t.requirePlank && !t.requireFloorContact) return null;

    // Forward-drift guard: user moved toward camera instead of dropping down
    const lm = this.extractLandmarks(landmarks);
    const currentCenterY = (lm.lHip.y + lm.rHip.y + lm.lShoulder.y + lm.rShoulder.y) / 4;
    const centerDrift = Math.abs(currentCenterY - this.standingCenterY) / this.standingHeight;
    if (centerDrift > 0.50) {
      return "forward_drift";
    }

    const noseCheck = t.noseAnkleRatio === null || noseAnkleRatio < t.noseAnkleRatio;
    if (!noseCheck) return "shallow_descent";

    // Torso flattening check (shoulder-hip Y gap shrinks)
    if (t.requirePlank && torsoAngle !== null && torsoAngle < 30) {
      return "no_plank";
    }

    // Elbow bend check: arms must be bent (chest lowered), not extended (plank hold)
    // Straight arms ~160-180°, chest-on-ground ~60-120°
    if (t.requireFloorContact && elbowAngle !== null && elbowAngle > 135) {
      return "no_floor_contact";
    }

    return null;
  }

  private checkJump(landmarks: Landmark[]): void {
    const lm = this.extractLandmarks(landmarks);
    const ankleY = Math.max(lm.lAnkle.y, lm.rAnkle.y);

    // Jump: ankle Y drops below standing baseline (in image coords, lower Y = higher position)
    if (ankleY < this.standingAnkleY - 0.01) {
      if (this.airStartTime === 0) this.airStartTime = performance.now();
      this.jumpDetected = true;
    } else {
      this.airStartTime = 0;
    }

    // Hands overhead
    const noseY = lm.nose.y;
    if (this.cameraAngle === "side") {
      const side = this.getPrimarySide(landmarks);
      const shoulder = side === "left" ? lm.lShoulder : lm.rShoulder;
      const wrist = side === "left" ? lm.lWrist : lm.rWrist;
      if ((wrist.visibility ?? 0) > SOFT_VISIBILITY && wrist.y < shoulder.y) {
        this.handsOverhead = true;
      }
    } else {
      const wristY = Math.min(lm.lWrist.y, lm.rWrist.y);
      if (wristY < noseY) {
        this.handsOverhead = true;
      }
    }

    // Tuck jump: knee Y rises to hip level
    if (this.thresholds.requireTuckJump && this.jumpDetected) {
      const hipY = Math.min(lm.lHip.y, lm.rHip.y);
      const kneeY = Math.min(lm.lKnee.y, lm.rKnee.y);
      if (kneeY <= hipY) {
        const airTime = this.airStartTime > 0 ? performance.now() - this.airStartTime : 0;
        if (airTime >= 150) {
          this.tuckDetected = true;
        }
      }
    }
  }

  private getTimeoutRejection(): RejectionReason {
    if (!this.deepestPhase || this.deepestPhase === "HINGING") return "shallow_descent";
    return "incomplete_rise";
  }

  private makeFrame(now: number, overrides?: Partial<VerificationFrame>): VerificationFrame {
    return {
      state: this.state,
      stateChanged: false,
      repCount: this.repCount,
      calibrated: this.standingHeight > 0,
      calibrationProgress: 0,
      stabilityStatus: this.isStable ? "stable" : "unstable",
      cameraAngle: this.cameraAngle,
      alignmentStatus: "no-pose",
      heightRatio: 0,
      rawHeightRatio: 0,
      noseAnkleRatio: this.lastNoseAnkleRatio,
      hipAngle: this.lastHipAngle,
      kneeAngle: this.lastKneeAngle,
      elbowAngle: this.lastElbowAngle,
      torsoAngle: this.lastTorsoAngle,
      rejection: null,
      coachingCue: null,
      cyclePhase: null,
      cycleDuration: this.cycleStartTime > 0 ? now - this.cycleStartTime : 0,
      deepestPhase: this.deepestPhase,
      difficultyLevel: this.difficulty,
      ...overrides,
    };
  }

  processFrame(landmarks: Landmark[], now: number): VerificationFrame {
    const lm = this.extractLandmarks(landmarks);
    const keyLandmarks = [lm.nose, lm.lShoulder, lm.rShoulder, lm.lHip, lm.rHip, lm.lAnkle, lm.rAnkle];

    // Check tracking quality
    const keyVisible = keyLandmarks.filter((l) => (l.visibility ?? 0) > SOFT_VISIBILITY).length;
    if (keyVisible >= 5) {
      this.lastGoodTrackingTime = now;
    } else if (this.state !== "IDLE" && this.state !== "CALIBRATING" && this.lastGoodTrackingTime > 0 && (now - this.lastGoodTrackingTime) > LOST_TRACKING_MS) {
      if (this.cycleStartTime > 0) {
        this.lastRejection = "lost_tracking";
        const rejection = this.lastRejection;
        this.state = "READY";
        this.resetCycle();
        return this.makeFrame(now, {
          stateChanged: true,
          rejection,
          alignmentStatus: "no-pose",
          stabilityStatus: "stable",
        });
      }
    }

    // Stability guard
    if (!this.isStable) {
      const stability = this.checkStability(landmarks, now);
      if (stability.status !== "stable") {
        return this.makeFrame(now, {
          alignmentStatus: "stabilizing",
          stabilityStatus: stability.status,
          calibrationProgress: stability.progress * 0.3,
        });
      }
      this.isStable = true;
      this.state = "CALIBRATING";
    }

    // Compute current height
    const visibleYs: number[] = [];
    for (const l of keyLandmarks) {
      if ((l.visibility ?? 0) > MIN_VISIBILITY) visibleYs.push(l.y);
    }
    const coreVisible = [lm.lShoulder, lm.rShoulder, lm.lHip, lm.rHip].every(
      (l) => (l.visibility ?? 0) > MIN_VISIBILITY
    );
    const currentHeight = visibleYs.length >= 4 && coreVisible
      ? Math.max(...visibleYs) - Math.min(...visibleYs)
      : 0;

    // Calibration
    if (!this.standingHeight) {
      const allVisible = keyLandmarks.every((l) => (l.visibility ?? 0) > MIN_VISIBILITY);
      const shoulderY = (lm.lShoulder.y + lm.rShoulder.y) / 2;
      const hipY = (lm.lHip.y + lm.rHip.y) / 2;
      const torsoVertical = hipY - shoulderY > 0.08;
      const bodyGood = allVisible && torsoVertical && currentHeight > 0.15;

      if (!bodyGood) {
        if (this.calibrationHeights.length > 0) {
          this.calibrationHeights = [];
          this.calibrationStartTime = 0;
          this.angleVotes = { front: 0, side: 0 };
        }
        if (!allVisible) {
          this.isStable = false;
          this.stabilityFrames = [];
          return this.makeFrame(now, {
            alignmentStatus: "no-pose",
            stabilityStatus: "unstable",
            calibrationProgress: 0,
          });
        }
      }

      let alignmentStatus: AlignmentStatus = "no-pose";
      if (allVisible) {
        const centerX = (lm.lShoulder.x + lm.rShoulder.x + lm.lHip.x + lm.rHip.x) / 4;
        const headCut = lm.nose.y < 0.02;
        const tooClose = headCut || Math.max(lm.lAnkle.y, lm.rAnkle.y) > 0.98;
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
        const vote = this.detectAngle(landmarks);
        if (vote === "front") this.angleVotes.front++;
        else this.angleVotes.side++;
      } else if (bodyGood) {
        this.calibrationHeights = [];
        this.calibrationStartTime = 0;
        this.angleVotes = { front: 0, side: 0 };
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
          this.angleVotes = { front: 0, side: 0 };
          return this.makeFrame(now, {
            calibrationProgress: 0,
            alignmentStatus: candidateHeight < MIN_STANDING_HEIGHT ? "too-far" : "too-close",
            stabilityStatus: "stable",
          });
        }

        const heightStd = stddev(this.calibrationHeights);
        if (heightStd > candidateHeight * 0.08) {
          this.calibrationHeights = [];
          this.calibrationStartTime = 0;
          this.angleVotes = { front: 0, side: 0 };
          return this.makeFrame(now, {
            calibrationProgress: 0,
            alignmentStatus: "aligned",
            stabilityStatus: "stable",
          });
        }

        this.standingHeight = candidateHeight;
        this.standingAnkleY = Math.max(lm.lAnkle.y, lm.rAnkle.y);
        this.standingCenterY = (lm.lHip.y + lm.rHip.y + lm.lShoulder.y + lm.rShoulder.y) / 4;

        const totalVotes = this.angleVotes.front + this.angleVotes.side;
        const frontRatio = this.angleVotes.front / totalVotes;
        if (frontRatio >= ANGLE_VOTE_THRESHOLD) {
          this.cameraAngle = "front";
        } else if (frontRatio <= 1 - ANGLE_VOTE_THRESHOLD) {
          this.cameraAngle = "side";
        } else {
          this.cameraAngle = "front";
        }

        const angleKey = this.cameraAngle === "side" ? "side" : "front";
        this.thresholds = { ...DIFFICULTY_THRESHOLDS[this.difficulty][angleKey] };

        this.state = "READY";
        this.lastGoodTrackingTime = now;
        this.ratioBuffer = [];
      }

      const frameProgress = Math.min(this.calibrationHeights.length / CALIBRATION_FRAMES, 1);
      const timeProgress = Math.min(calibrationElapsed / CALIBRATION_MIN_DURATION_MS, 1);
      const combinedProgress = Math.min(frameProgress, timeProgress);

      return this.makeFrame(now, {
        calibrationProgress: combinedProgress,
        alignmentStatus,
        stabilityStatus: "stable",
      });
    }

    // Post-calibration: compute metrics
    if (currentHeight <= 0) {
      return this.makeFrame(now, {
        calibrated: true,
        alignmentStatus: "aligned",
        stabilityStatus: "stable",
      });
    }

    const rawR = Math.min(currentHeight / this.standingHeight, 1.0);
    this.ratioBuffer.push(rawR);
    if (this.ratioBuffer.length > SMOOTHING_WINDOW) this.ratioBuffer.shift();
    const r = this.ratioBuffer.reduce((a, b) => a + b, 0) / this.ratioBuffer.length;

    const angles = this.computeAngles(landmarks);
    this.lastHipAngle = angles.hipAngle;
    this.lastKneeAngle = angles.kneeAngle;
    this.lastElbowAngle = angles.elbowAngle;
    this.lastTorsoAngle = angles.torsoAngle;
    this.lastNoseAnkleRatio = angles.noseAnkleRatio;

    const t = this.thresholds;
    const prevState = this.state;
    let stateChanged = false;
    let rejection: RejectionReason | null = null;
    let coachingCue: CoachingCue | null = null;
    const cycleDuration = this.cycleStartTime > 0 ? now - this.cycleStartTime : 0;

    switch (this.state) {
      case "READY": {
        if (r < 0.75) {
          this.state = "HINGING";
          this.cycleStartTime = now;
          this.hingingEnteredTime = now;
          this.deepestPhase = "HINGING";
          this.jumpDetected = false;
          this.handsOverhead = false;
          this.tuckDetected = false;
          this.airStartTime = 0;
          this.bottomMinRatio = 1;
          this.lastRejection = null;
          stateChanged = true;
        }
        break;
      }

      case "HINGING": {
        const bottomReject = this.checkBottomEntry(r, angles.noseAnkleRatio, angles.torsoAngle, angles.elbowAngle, landmarks);
        if (bottomReject === null) {
          this.state = "BOTTOM";
          this.bottomEnteredTime = now;
          this.bottomMinRatio = r;
          this.deepestPhase = "BOTTOM";
          stateChanged = true;
        } else if (r > t.standRatio) {
          rejection = bottomReject;
          this.state = "READY";
          this.resetCycle();
          stateChanged = true;
        } else if (this.cycleStartTime > 0 && cycleDuration > t.maxDuration) {
          rejection = this.getTimeoutRejection();
          this.state = "READY";
          this.resetCycle();
          stateChanged = true;
        } else if ((now - this.hingingEnteredTime) > COACHING_HINGING_TIMEOUT) {
          coachingCue = "keep_going_down";
        }
        break;
      }

      case "BOTTOM": {
        if (r < this.bottomMinRatio) this.bottomMinRatio = r;
        const dwellTime = now - this.bottomEnteredTime;

        if (r > t.floorRatio + 0.05 && dwellTime >= t.minFloorDwell) {
          this.state = "DRIVING";
          this.drivingEnteredTime = now;
          if (!this.deepestPhase || isPhaseDeeper("DRIVING", this.deepestPhase)) {
            this.deepestPhase = "DRIVING";
          }
          stateChanged = true;
        } else if (this.cycleStartTime > 0 && cycleDuration > t.maxDuration) {
          rejection = this.getTimeoutRejection();
          this.state = "READY";
          this.resetCycle();
          stateChanged = true;
        } else if (dwellTime > COACHING_BOTTOM_TIMEOUT && dwellTime < t.minFloorDwell + COACHING_BOTTOM_TIMEOUT) {
          coachingCue = "lower_your_chest";
        }
        break;
      }

      case "DRIVING": {
        if (r > 0.60 && (angles.torsoAngle === null || angles.torsoAngle < 40)) {
          this.state = "RISING";
          if (!this.deepestPhase || isPhaseDeeper("RISING", this.deepestPhase)) {
            this.deepestPhase = "RISING";
          }
          stateChanged = true;
        } else if (r < t.floorRatio) {
          // Dropped back down
          this.state = "BOTTOM";
          this.bottomEnteredTime = now;
          stateChanged = true;
        } else if (this.cycleStartTime > 0 && cycleDuration > t.maxDuration) {
          rejection = this.getTimeoutRejection();
          this.state = "READY";
          this.resetCycle();
          stateChanged = true;
        } else if ((now - this.drivingEnteredTime) > COACHING_DRIVING_TIMEOUT) {
          coachingCue = "push_up_and_stand";
        }
        break;
      }

      case "RISING": {
        // Check for jump during the rising phase
        if (t.requireJump || t.requireTuckJump) {
          this.checkJump(landmarks);
        }

        if (r >= t.standRatio) {
          // Check full extension
          const extensionOk = r >= t.requireFullExtension;
          const hipOk = angles.hipAngle === null || angles.hipAngle > t.hipExtension;
          const kneeOk = angles.kneeAngle === null || angles.kneeAngle > t.kneeExtension;

          if (!extensionOk || !hipOk || !kneeOk) {
            rejection = "incomplete_rise";
            this.state = "READY";
            this.resetCycle();
            stateChanged = true;
            break;
          }

          // Check jump requirement
          if (t.requireJump && !(this.jumpDetected && this.handsOverhead)) {
            rejection = "no_jump";
            this.state = "READY";
            this.resetCycle();
            stateChanged = true;
            break;
          }

          // Check tuck jump requirement
          if (t.requireTuckJump && !this.tuckDetected) {
            rejection = "no_tuck";
            this.state = "READY";
            this.resetCycle();
            stateChanged = true;
            break;
          }

          // Jitter guard
          if (cycleDuration < JITTER_GUARD_MS) {
            rejection = "jitter";
            this.state = "READY";
            this.resetCycle();
            stateChanged = true;
            break;
          }

          // Duration check
          if (cycleDuration > t.maxDuration) {
            rejection = "too_slow";
            this.state = "READY";
            this.resetCycle();
            stateChanged = true;
            break;
          }

          // Rep counted!
          this.repCount++;
          this.state = "READY";
          this.resetCycle();
          stateChanged = true;
        } else if (r < 0.50) {
          // Dropped back down mid-rise
          this.state = "DRIVING";
          this.drivingEnteredTime = now;
          stateChanged = true;
        } else if (this.cycleStartTime > 0 && cycleDuration > t.maxDuration) {
          rejection = this.getTimeoutRejection();
          this.state = "READY";
          this.resetCycle();
          stateChanged = true;
        }
        break;
      }

      default:
        break;
    }

    const currentCyclePhase: CyclePhase | null =
      (this.state === "HINGING" || this.state === "BOTTOM" || this.state === "DRIVING" || this.state === "RISING")
        ? this.state as CyclePhase
        : null;

    return this.makeFrame(now, {
      state: this.state,
      stateChanged: stateChanged || prevState !== this.state,
      repCount: this.repCount,
      calibrated: true,
      calibrationProgress: 1,
      stabilityStatus: "stable",
      cameraAngle: this.cameraAngle,
      alignmentStatus: "aligned",
      heightRatio: r,
      rawHeightRatio: rawR,
      noseAnkleRatio: angles.noseAnkleRatio,
      hipAngle: angles.hipAngle,
      kneeAngle: angles.kneeAngle,
      elbowAngle: angles.elbowAngle,
      torsoAngle: angles.torsoAngle,
      rejection,
      coachingCue,
      cyclePhase: currentCyclePhase,
      cycleDuration: this.cycleStartTime > 0 ? now - this.cycleStartTime : 0,
      deepestPhase: this.deepestPhase,
      difficultyLevel: this.difficulty,
    });
  }
}
