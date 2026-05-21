import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "@mediapipe/tasks-vision";

type RepState = "HIGH" | "LOW" | "UNKNOWN";
type Screen = "detecting" | "summary";

const CALIBRATION_FRAMES = 15;
const CALIBRATION_STABILITY = 0.08;

const DEFAULT_THRESHOLDS = {
  noseDropLow: 0.25,
  noseDropHigh: 0.10,
  debounceMs: 400,
  maxDuration: 8000,
};

interface Baseline {
  noseY: number;
  shoulderHipGap: number;
}

interface SignalValues {
  noseDrop: number;
  torsoRatio: number;
  zShift: number;
}

export default function Dab() {
  const { profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tuneMode = searchParams.get("tune") === "1";

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const animationIdRef = useRef(0);

  const repStateRef = useRef<RepState>("UNKNOWN");
  const lastHighTimeRef = useRef(0);
  const hasBeenLowRef = useRef(false);
  const repCountRef = useRef(0);

  const thresholdsRef = useRef({ ...DEFAULT_THRESHOLDS });

  const calibrationSamples = useRef<Baseline[]>([]);
  const baselineRef = useRef<Baseline | null>(null);

  const [screen, setScreen] = useState<Screen>("detecting");
  const [reps, setReps] = useState(0);
  const [currentState, setCurrentState] = useState<RepState>("UNKNOWN");
  const [signals, setSignals] = useState<SignalValues>({ noseDrop: 0, torsoRatio: 0, zShift: 0 });
  const [calibrated, setCalibrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStage, setLoadStage] = useState("Powering up…");
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [summaryUserTotal, setSummaryUserTotal] = useState(0);
  const [summaryGlobalTotal, setSummaryGlobalTotal] = useState(0);

  const [tuneValues, setTuneValues] = useState({ ...DEFAULT_THRESHOLDS });
  const [tuneOpen, setTuneOpen] = useState(true);
  const [stateLog, setStateLog] = useState<string[]>([]);
  const lastSignalUpdateRef = useRef(0);
  const lastTransitionTimeRef = useRef(0);

  // Auth guard — wait for auth to finish loading before redirecting
  useEffect(() => {
    if (!authLoading && !profile) navigate("/", { replace: true });
  }, [authLoading, profile, navigate]);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(animationIdRef.current);
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const insertRep = useCallback(
    (userId: string) => {
      supabase
        .from("reps")
        .insert({ user_id: userId, exercise_type: "burpee" })
        .then(({ error }) => {
          if (error) console.error("Rep insert error:", error);
        });
    },
    []
  );

  useEffect(() => {
    if (!profile || screen !== "detecting") return;

    let cancelled = false;

    const init = async () => {
      try {
        setLoadStage("Powering up Burpee Detector…");
        setLoadProgress(10);
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
        );
        if (cancelled) return;

        setLoadStage("Starting camera…");
        setLoadProgress(40);
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;

        setLoadStage("Get ready to rumble…");
        setLoadProgress(75);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setLoadStage("Let's go!");
        setLoadProgress(100);
        setLoading(false);

        let detecting = false;
        const detect = () => {
          if (cancelled || !videoRef.current || !canvasRef.current || !landmarkerRef.current) return;

          if (detecting) {
            animationIdRef.current = requestAnimationFrame(detect);
            return;
          }
          detecting = true;

          const result = landmarkerRef.current.detectForVideo(
            videoRef.current,
            performance.now()
          );
          const ctx = canvasRef.current.getContext("2d");
          if (!ctx) return;

          canvasRef.current.width = videoRef.current.videoWidth;
          canvasRef.current.height = videoRef.current.videoHeight;
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

          const drawer = new DrawingUtils(ctx);
          for (const landmarks of result.landmarks) {
            drawer.drawLandmarks(landmarks, {
              radius: 3,
              color: "#FF9B2F",
              fillColor: "#FFC857",
            });
            drawer.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
              color: "#FF9B2F80",
              lineWidth: 2,
            });
          }

          if (result.landmarks.length > 0) {
            const lm = result.landmarks[0];
            const nose = lm[0];
            const lShoulder = lm[11];
            const rShoulder = lm[12];
            const lHip = lm[23];
            const rHip = lm[24];

            const shoulderY = (lShoulder.y + rShoulder.y) / 2;
            const hipY = (lHip.y + rHip.y) / 2;
            const shoulderHipGap = hipY - shoulderY;

            if (!baselineRef.current) {
              calibrationSamples.current.push({
                noseY: nose.y,
                shoulderHipGap,
              });
              if (calibrationSamples.current.length >= CALIBRATION_FRAMES) {
                const samples = calibrationSamples.current;
                const noseYs = samples.map((s) => s.noseY);
                const noseMin = Math.min(...noseYs);
                const noseMax = Math.max(...noseYs);
                const noseRange = noseMax - noseMin;
                const avgGap = samples.reduce((s, v) => s + v.shoulderHipGap, 0) / samples.length;
                if (avgGap > 0.05 && noseRange < CALIBRATION_STABILITY) {
                  const avgNoseY = noseYs.reduce((s, v) => s + v, 0) / noseYs.length;
                  baselineRef.current = { noseY: avgNoseY, shoulderHipGap: avgGap };
                  repStateRef.current = "HIGH";
                  lastHighTimeRef.current = performance.now();
                  lastTransitionTimeRef.current = performance.now();
                  setCalibrated(true);
                  setCurrentState("HIGH");
                } else {
                  calibrationSamples.current = calibrationSamples.current.slice(-10);
                }
              }
            }

            if (baselineRef.current) {
              const bl = baselineRef.current;
              const noseDrop = (nose.y - bl.noseY) / bl.shoulderHipGap;
              const torsoRatio = shoulderHipGap / bl.shoulderHipGap;
              const zShift = nose.z;

              const now = performance.now();
              const t = thresholdsRef.current;

              const isLow = noseDrop > t.noseDropLow;
              const isHigh = noseDrop < t.noseDropHigh;

              if (now - lastSignalUpdateRef.current > 100) {
                lastSignalUpdateRef.current = now;
                setSignals({ noseDrop, torsoRatio, zShift });
              }

              let newState: RepState = repStateRef.current;
              if (isHigh) newState = "HIGH";
              else if (isLow) newState = "LOW";

              const sinceLast = now - lastTransitionTimeRef.current;
              if (newState !== repStateRef.current && sinceLast > t.debounceMs) {
                lastTransitionTimeRef.current = now;
                if (newState === "HIGH") {
                  if (
                    hasBeenLowRef.current &&
                    now - lastHighTimeRef.current < t.maxDuration
                  ) {
                    repCountRef.current += 1;
                    const count = repCountRef.current;
                    setReps(count);
                    navigator.vibrate?.(100);
                    if (!tuneMode) insertRep(profile!.id);
                  }
                  lastHighTimeRef.current = now;
                  hasBeenLowRef.current = false;
                } else if (newState === "LOW") {
                  hasBeenLowRef.current = true;
                }
                repStateRef.current = newState;
                setCurrentState(newState);
                setStateLog((prev) => {
                  const entry = `${newState} nose=${noseDrop.toFixed(2)} torso=${torsoRatio.toFixed(2)} z=${zShift.toFixed(3)}`;
                  const next = [entry, ...prev];
                  return next.length > 20 ? next.slice(0, 20) : next;
                });
              }
            }
          }

          detecting = false;
          animationIdRef.current = requestAnimationFrame(detect);
        };
        detect();
      } catch (err) {
        if (cancelled) return;
        const msg = (err as Error).message || "Unknown error";
        if (msg.includes("Permission") || msg.includes("NotAllowed") || msg.includes("denied")) {
          setCameraError(
            "REPPs needs camera access to detect your burpees. Tap the camera icon in your browser address bar to allow."
          );
        } else {
          setCameraError(`Camera error: ${msg}`);
        }
        setLoading(false);
      }
    };

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationIdRef.current);
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [profile, screen, insertRep, tuneMode]);

  const handleStop = async () => {
    stopCamera();

    const [userResult, globalResult] = await Promise.all([
      supabase
        .from("reps")
        .select("*", { count: "exact", head: true })
        .eq("user_id", profile!.id),
      supabase.from("reps").select("*", { count: "exact", head: true }),
    ]);

    setSummaryUserTotal(userResult.count ?? 0);
    setSummaryGlobalTotal(globalResult.count ?? 0);
    setScreen("summary");
  };

  if (authLoading || !profile) return null;

  if (screen === "summary") {
    return (
      <div className="flex flex-col items-center justify-center text-center pt-16 px-4">
        <p className="text-headline text-ink-primary">
          {reps > 0 ? "Nice work" : "No reps this time"}
        </p>
        <p className="text-display-lg text-accent mt-4 tabular-nums">
          +{reps}
        </p>
        <p className="text-caption text-ink-secondary mt-1">
          {reps === 1 ? "rep" : "reps"} added to the global movement
        </p>

        <div className="mt-12 space-y-3 text-body text-ink-secondary">
          <p>
            Your total reps:{" "}
            <span className="text-ink-primary font-bold tabular-nums">
              {summaryUserTotal.toLocaleString()}
            </span>
          </p>
          <p>
            Global total:{" "}
            <span className="text-ink-primary font-bold tabular-nums">
              {summaryGlobalTotal.toLocaleString()}
            </span>
          </p>
        </div>

        <button
          onClick={() => navigate("/")}
          className="mt-12 w-full max-w-sm bg-accent text-ink-inverse font-bold text-body-lg rounded-pill py-4 px-8 transition-all duration-200 ease-apple active:scale-95"
        >
          BACK TO HOME
        </button>
      </div>
    );
  }

  if (cameraError) {
    return (
      <div className="flex flex-col items-center justify-center text-center pt-24 px-4">
        <p className="text-display-md">📷</p>
        <p className="text-body text-ink-primary mt-4">{cameraError}</p>
        <button
          onClick={() => navigate("/")}
          className="mt-8 bg-bg-elevated text-ink-primary font-bold text-body-lg rounded-pill py-4 px-8 transition-all duration-200 ease-apple active:scale-95"
        >
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center -mx-4 -mt-6">
      {/* Rep counter overlay */}
      <div className="w-full text-center py-4 relative z-10">
        {tuneMode && (
          <p className="text-micro text-accent uppercase mb-1">Tune Mode</p>
        )}
        <p className="text-micro text-ink-muted uppercase tracking-wide">Drop A Burpee</p>
        <p className="text-display-xl text-accent tabular-nums">{reps}</p>
      </div>

      {/* Camera + skeleton */}
      <div className="relative w-full" style={{ aspectRatio: "3/4" }}>
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-bg-base/80">
            <p className="text-body text-ink-secondary mb-4">{loadStage}</p>
            <div className="w-48 h-1 bg-bg-input rounded-pill overflow-hidden">
              <div
                className="h-full bg-accent rounded-pill transition-all duration-300 ease-apple"
                style={{ width: `${loadProgress}%` }}
              />
            </div>
          </div>
        )}
        <video
          ref={videoRef}
          playsInline
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: "scaleX(-1)",
          }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            transform: "scaleX(-1)",
          }}
        />
      </div>

      {/* STOP button */}
      <div className="w-full px-4 mt-4 mb-24">
        <button
          onClick={handleStop}
          className="w-full max-w-sm mx-auto block bg-bg-elevated text-ink-primary font-bold text-body-lg rounded-pill py-4 px-8 transition-all duration-200 ease-apple active:scale-95"
        >
          DONE
        </button>
      </div>

      {/* Debug strip */}
      {!tuneMode && (
        <div className="fixed bottom-16 left-0 right-0 z-40 flex justify-center">
          <div className="flex gap-3 px-3 py-1 bg-bg-surface rounded-pill text-micro text-ink-muted tabular-nums">
            <span>{calibrated ? currentState : "CAL"}</span>
            <span>n{signals.noseDrop.toFixed(2)}</span>
            <span>t{signals.torsoRatio.toFixed(2)}</span>
            <span>z{signals.zShift.toFixed(3)}</span>
          </div>
        </div>
      )}

      {/* Tune mode panel */}
      {tuneMode && (
        <div className="fixed bottom-[76px] left-0 right-0 z-[60] px-2">
          <div className="mx-auto max-w-md bg-bg-surface border border-divider rounded-lg overflow-hidden">
            <button
              onClick={() => setTuneOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-2 text-micro text-accent uppercase"
            >
              <span>Tune — {calibrated ? currentState : "CAL"} — n{signals.noseDrop.toFixed(2)} t{signals.torsoRatio.toFixed(2)} z{signals.zShift.toFixed(3)}</span>
              <span>{tuneOpen ? "▼" : "▲"}</span>
            </button>
            {tuneOpen && (
              <div className="px-3 pb-3 space-y-3">
                <div className="bg-bg-elevated rounded-md p-2 text-micro text-ink-muted">
                  DB writes disabled. Nose drop is primary signal. Stand still to calibrate.
                  {!calibrated && " Hold steady…"}
                </div>
                <TuneSlider
                  label="Nose drop → LOW (down)"
                  value={tuneValues.noseDropLow}
                  min={0.1} max={0.8} step={0.01}
                  onChange={(v) => {
                    thresholdsRef.current.noseDropLow = v;
                    setTuneValues((p) => ({ ...p, noseDropLow: v }));
                  }}
                />
                <TuneSlider
                  label="Nose recover → HIGH (standing)"
                  value={tuneValues.noseDropHigh}
                  min={0.02} max={0.4} step={0.01}
                  onChange={(v) => {
                    thresholdsRef.current.noseDropHigh = v;
                    setTuneValues((p) => ({ ...p, noseDropHigh: v }));
                  }}
                />
                <TuneSlider
                  label="Debounce (ms)"
                  value={tuneValues.debounceMs}
                  min={100} max={1500} step={50}
                  onChange={(v) => {
                    thresholdsRef.current.debounceMs = v;
                    setTuneValues((p) => ({ ...p, debounceMs: v }));
                  }}
                />
                <TuneSlider
                  label="Max rep duration (ms)"
                  value={tuneValues.maxDuration}
                  min={3000} max={15000} step={500}
                  onChange={(v) => {
                    thresholdsRef.current.maxDuration = v;
                    setTuneValues((p) => ({ ...p, maxDuration: v }));
                  }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setReps(0);
                      repCountRef.current = 0;
                      repStateRef.current = "UNKNOWN";
                      hasBeenLowRef.current = false;
                      setStateLog([]);
                    }}
                    className="flex-1 bg-bg-input text-ink-secondary text-micro rounded-md py-2"
                  >
                    RESET COUNT
                  </button>
                  <button
                    onClick={() => {
                      thresholdsRef.current = { ...DEFAULT_THRESHOLDS };
                      setTuneValues({ ...DEFAULT_THRESHOLDS });
                    }}
                    className="flex-1 bg-bg-input text-ink-secondary text-micro rounded-md py-2"
                  >
                    RESET DEFAULTS
                  </button>
                  <button
                    onClick={() => {
                      baselineRef.current = null;
                      calibrationSamples.current = [];
                      setCalibrated(false);
                      repStateRef.current = "UNKNOWN";
                      hasBeenLowRef.current = false;
                      setStateLog([]);
                    }}
                    className="flex-1 bg-bg-input text-ink-secondary text-micro rounded-md py-2"
                  >
                    RECALIBRATE
                  </button>
                </div>
                {stateLog.length > 0 && (
                  <div className="max-h-24 overflow-y-auto bg-bg-elevated rounded-md p-2 text-micro text-ink-muted tabular-nums space-y-0.5">
                    {stateLog.map((entry, i) => (
                      <div key={i}>{entry}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TuneSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between text-micro text-ink-secondary mb-1">
        <span>{label}</span>
        <span className="text-ink-primary tabular-nums">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 appearance-none bg-bg-input rounded-pill outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
      />
    </div>
  );
}
