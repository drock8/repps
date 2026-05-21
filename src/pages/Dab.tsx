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

const CALIBRATION_FRAMES = 30;
const MIN_VISIBILITY = 0.5;

const DEFAULT_THRESHOLDS = {
  highRatio: 0.85,
  lowRatio: 0.40,
  maxDuration: 8000,
};

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

  const calibrationHeights = useRef<number[]>([]);
  const standingHeightRef = useRef<number>(0);

  const [screen, setScreen] = useState<Screen>("detecting");
  const [reps, setReps] = useState(0);
  const [currentState, setCurrentState] = useState<RepState>("UNKNOWN");
  const [ratio, setRatio] = useState(0);
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

        let lastDetectTime = 0;
        const detect = () => {
          if (cancelled || !videoRef.current || !canvasRef.current || !landmarkerRef.current) return;

          const now = performance.now();
          if (now - lastDetectTime < 80) {
            animationIdRef.current = requestAnimationFrame(detect);
            return;
          }
          lastDetectTime = now;

          const result = landmarkerRef.current.detectForVideo(
            videoRef.current,
            now
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
            const lAnkle = lm[27];
            const rAnkle = lm[28];

            const keyYs = [nose.y, lShoulder.y, rShoulder.y, lHip.y, rHip.y, lAnkle.y, rAnkle.y];
            const currentHeight = Math.max(...keyYs) - Math.min(...keyYs);

            if (!standingHeightRef.current) {
              const keyLandmarks = [nose, lShoulder, rShoulder, lHip, rHip, lAnkle, rAnkle];
              const allVisible = keyLandmarks.every((l) => (l.visibility ?? 0) > MIN_VISIBILITY);
              const shoulderY = (lShoulder.y + rShoulder.y) / 2;
              const hipY = (lHip.y + rHip.y) / 2;
              const torsoVertical = (hipY - shoulderY) > 0.08;

              if (allVisible && torsoVertical && currentHeight > 0.15) {
                calibrationHeights.current.push(currentHeight);
              } else {
                calibrationHeights.current = [];
              }

              if (calibrationHeights.current.length >= CALIBRATION_FRAMES) {
                const sorted = [...calibrationHeights.current].sort((a, b) => a - b);
                standingHeightRef.current = sorted[Math.floor(sorted.length * 0.9)];
                repStateRef.current = "HIGH";
                lastHighTimeRef.current = performance.now();
                setCalibrated(true);
                setCurrentState("HIGH");
              }
            }

            if (standingHeightRef.current) {
              const r = Math.min(currentHeight / standingHeightRef.current, 1.0);
              const now = performance.now();
              const t = thresholdsRef.current;

              if (now - lastSignalUpdateRef.current > 100) {
                lastSignalUpdateRef.current = now;
                setRatio(r);
              }

              let newState: RepState = repStateRef.current;
              if (r > t.highRatio) newState = "HIGH";
              else if (r < t.lowRatio) newState = "LOW";

              if (newState !== repStateRef.current) {
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
                  const entry = `${newState} ratio=${r.toFixed(2)}`;
                  const next = [entry, ...prev];
                  return next.length > 20 ? next.slice(0, 20) : next;
                });
              }
            }
          }

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
          <div className="flex gap-4 px-3 py-1 bg-bg-surface rounded-pill text-micro text-ink-muted tabular-nums">
            <span>{calibrated ? currentState : "Stand still…"}</span>
            <span>{ratio.toFixed(2)}</span>
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
              <span>Tune — {calibrated ? currentState : "Stand still…"} — ratio {ratio.toFixed(2)}</span>
              <span>{tuneOpen ? "▼" : "▲"}</span>
            </button>
            {tuneOpen && (
              <div className="px-3 pb-3 space-y-3">
                <div className="bg-bg-elevated rounded-md p-2 text-micro text-ink-muted">
                  DB writes disabled. Ratio = current height / standing height.
                  {!calibrated && " Stand still with full body visible…"}
                </div>
                <TuneSlider
                  label="HIGH ratio (standing)"
                  value={tuneValues.highRatio}
                  min={0.5} max={0.98} step={0.01}
                  onChange={(v) => {
                    thresholdsRef.current.highRatio = v;
                    setTuneValues((p) => ({ ...p, highRatio: v }));
                  }}
                />
                <TuneSlider
                  label="LOW ratio (down)"
                  value={tuneValues.lowRatio}
                  min={0.1} max={0.7} step={0.01}
                  onChange={(v) => {
                    thresholdsRef.current.lowRatio = v;
                    setTuneValues((p) => ({ ...p, lowRatio: v }));
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
                      standingHeightRef.current = 0;
                      calibrationHeights.current = [];
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
