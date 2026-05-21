import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "@mediapipe/tasks-vision";

type RepState = "HIGH" | "LOW" | "UNKNOWN";
type Screen = "detecting" | "summary";

export default function Dab() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const animationIdRef = useRef(0);

  const repStateRef = useRef<RepState>("UNKNOWN");
  const lastHighTimeRef = useRef(0);
  const hasBeenLowRef = useRef(false);

  const [screen, setScreen] = useState<Screen>("detecting");
  const [reps, setReps] = useState(0);
  const [currentState, setCurrentState] = useState<RepState>("UNKNOWN");
  const [noseY, setNoseY] = useState(0);
  const [torsoGap, setTorsoGap] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [summaryUserTotal, setSummaryUserTotal] = useState(0);
  const [summaryGlobalTotal, setSummaryGlobalTotal] = useState(0);

  // Auth guard
  useEffect(() => {
    if (!profile) navigate("/", { replace: true });
  }, [profile, navigate]);

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
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        if (cancelled) return;

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

        setLoading(false);

        const detect = () => {
          if (cancelled || !videoRef.current || !canvasRef.current || !landmarkerRef.current) return;

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
            const y = nose.y;
            setNoseY(y);

            const leftShoulder = lm[11];
            const leftHip = lm[23];
            const gap = Math.abs(leftShoulder.y - leftHip.y);
            setTorsoGap(gap);

            const now = performance.now();
            const HIGH_THRESHOLD = 0.4;
            const LOW_THRESHOLD = 0.7;
            const TORSO_VERTICAL_THRESHOLD = 0.1;
            const MAX_REP_DURATION_MS = 8000;

            const isHigh = y < HIGH_THRESHOLD && gap > TORSO_VERTICAL_THRESHOLD;
            const isLow = y > LOW_THRESHOLD && gap < TORSO_VERTICAL_THRESHOLD;

            let newState: RepState = repStateRef.current;
            if (isHigh) newState = "HIGH";
            else if (isLow) newState = "LOW";

            if (newState !== repStateRef.current) {
              if (newState === "HIGH") {
                if (
                  hasBeenLowRef.current &&
                  now - lastHighTimeRef.current < MAX_REP_DURATION_MS
                ) {
                  setReps((r) => r + 1);
                  insertRep(profile!.id);
                }
                lastHighTimeRef.current = now;
                hasBeenLowRef.current = false;
              } else if (newState === "LOW") {
                hasBeenLowRef.current = true;
              }
              repStateRef.current = newState;
              setCurrentState(newState);
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
  }, [profile, screen, insertRep]);

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

  if (!profile) return null;

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
        <p className="text-display-xl text-accent tabular-nums">{reps}</p>
      </div>

      {/* Camera + skeleton */}
      <div className="relative w-full" style={{ aspectRatio: "3/4" }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <p className="text-body text-ink-secondary">Loading detector…</p>
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
          STOP
        </button>
      </div>

      {/* Debug strip */}
      <div className="fixed bottom-16 left-0 right-0 z-40 flex justify-center">
        <div className="flex gap-4 px-3 py-1 bg-bg-surface rounded-pill text-micro text-ink-muted tabular-nums">
          <span>{currentState}</span>
          <span>nose {noseY.toFixed(2)}</span>
          <span>gap {torsoGap.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
