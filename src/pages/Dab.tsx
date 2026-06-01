import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "@mediapipe/tasks-vision";
import { DetectionEngineV1, DEFAULT_THRESHOLDS as V1_DEFAULTS } from "../lib/detectionV1";
import { DetectionEngineV2 } from "../lib/detectionV2";
import type { Landmark } from "../lib/detectionV1";
import type { CameraAngle, StabilityStatus } from "../lib/detectionV2";
import { preloadRepAudio, playRepAudio, playGoAudio } from "../lib/repAudio";
import {
  generateQRDataUrl,
  loadImage,
  drawBrandOverlay,
  createVideoRecorder,
  downloadBlob,
} from "../lib/videoRecorder";
import { runConfetti, createParticles, drawConfettiFrame, DURATION_MS as CONFETTI_DURATION, GRAVITY } from "../lib/confetti";
import type { BrandOverlayConfig, RecorderHandle } from "../lib/videoRecorder";
import { addGuestRep, setGuestGender } from "../lib/guestSession";
import type { Gender } from "../contexts/AuthContext";

type Screen = "detecting" | "summary" | "gender-picker";
type EngineVersion = "v1" | "v2";

const CALIBRATION_FRAMES = 30;

export default function Dab() {
  const { profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tuneMode = searchParams.get("tune") === "1";
  // Admin-only: ?v=1 forces V1 engine, default is V2
  const engineVersion: EngineVersion = searchParams.get("v") === "1" ? "v1" : "v2";

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recordCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const animationIdRef = useRef(0);

  const engineV1Ref = useRef<DetectionEngineV1 | null>(null);
  const engineV2Ref = useRef<DetectionEngineV2 | null>(null);

  const repCountRef = useRef(0);
  const calibratedRef = useRef(false);

  // Recording state
  const recorderRef = useRef<RecorderHandle | null>(null);
  const brandConfigRef = useRef<BrandOverlayConfig | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, [recordedUrl]);

  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);

  const [screen, setScreen] = useState<Screen>("detecting");
  const [celebrating, setCelebrating] = useState(false);
  const [reps, setReps] = useState(0);
  const [currentState, setCurrentState] = useState<string>("UNKNOWN");
  const [ratio, setRatio] = useState(0);
  const [calibrated, setCalibrated] = useState(false);
  const [calibrationCount, setCalibrationCount] = useState(0);
  const [showReady, setShowReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStage, setLoadStage] = useState("Powering up…");
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [summaryUserTotal, setSummaryUserTotal] = useState(0);
  const [summaryGlobalTotal, setSummaryGlobalTotal] = useState(0);

  const [alignmentStatus, setAlignmentStatus] = useState<string>("no-pose");

  const [tuneValues, setTuneValues] = useState({ ...V1_DEFAULTS });
  const [tuneOpen, setTuneOpen] = useState(true);
  const [stateLog, setStateLog] = useState<string[]>([]);
  const lastSignalUpdateRef = useRef(0);
  const accentRef = useRef<string>("");
  const accentSecondaryRef = useRef<string>("");

  // V2-specific display state
  const [cameraAngle, setCameraAngle] = useState<CameraAngle>("unknown");
  const [stabilityStatus, setStabilityStatus] = useState<StabilityStatus>("unstable");
  const [stabilityProgress, setStabilityProgress] = useState(0);
  const [hipAngle, setHipAngle] = useState(180);
  const [kneeAngle, setKneeAngle] = useState(180);
  const [torsoAngle, setTorsoAngle] = useState(0);

  // Preload rep audio clips and brand assets
  useEffect(() => {
    preloadRepAudio(10);

    (async () => {
      try {
        const [logo, qrDataUrl] = await Promise.all([
          loadImage("/Repps-Blue-Logo.png").catch(() => null),
          generateQRDataUrl(profile?.id || "guest"),
        ]);
        const qrImg = qrDataUrl ? await loadImage(qrDataUrl).catch(() => null) : null;
        brandConfigRef.current = {
          logoImg: logo,
          sponsorImgs: [],
          qrDataUrl,
          _qrImg: qrImg,
          repCount: () => repCountRef.current,
          accentColor: () => getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim(),
        };
      } catch {
        // Brand overlay is optional — recording still works without it
      }
    })();
  }, [profile?.id]);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(animationIdRef.current);
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const insertRep = useCallback(
    () => {
      if (profile) {
        supabase
          .rpc("insert_rep", { p_exercise_type: "burpee" })
          .then(({ data, error }) => {
            if (error) console.error("Rep insert network error:", error);
            else if (data?.success === false) console.warn("Rep insert rejected:", data.error);
          });
      } else {
        supabase
          .rpc("insert_guest_rep", { p_exercise_type: "burpee" })
          .then(({ data, error }) => {
            if (error) console.error("Guest rep insert error:", error);
            else if (data?.id) addGuestRep(data.id);
          });
      }
    },
    [profile]
  );

  useEffect(() => {
    if (authLoading || screen !== "detecting") return;

    let cancelled = false;

    // Initialize the selected detection engine
    if (engineVersion === "v1") {
      engineV1Ref.current = new DetectionEngineV1();
      engineV2Ref.current = null;
    } else {
      engineV2Ref.current = new DetectionEngineV2();
      engineV1Ref.current = null;
    }

    const init = async () => {
      try {
        setLoadStage("Powering up Burpee Detector…");
        setLoadProgress(10);

        const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
          Promise.race([
            promise,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`${label} timed out (${ms / 1000}s)`)), ms)
            ),
          ]);

        const vision = await withTimeout(
          FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
          ),
          30000,
          "WASM loading"
        );
        if (cancelled) return;

        setLoadStage("Starting camera…");
        setLoadProgress(40);
        const landmarker = await withTimeout(
          PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
              delegate: "CPU",
            },
            runningMode: "VIDEO",
            numPoses: 1,
          }),
          30000,
          "Model loading"
        );
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;

        setLoadStage("Get ready to rumble…");
        setLoadProgress(75);
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user" },
            audio: true,
          });
        } catch {
          // Audio denied or unavailable — fall back to video only
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user" },
          });
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        if (videoRef.current) {
          const videoOnly = new MediaStream(stream.getVideoTracks());
          videoRef.current.srcObject = videoOnly;
          await videoRef.current.play();
          // Wait for video to actually produce frames before starting detection
          if (videoRef.current.readyState < 2) {
            await new Promise<void>((resolve) => {
              const vid = videoRef.current!;
              const onReady = () => { vid.removeEventListener("loadeddata", onReady); resolve(); };
              vid.addEventListener("loadeddata", onReady);
              setTimeout(() => { vid.removeEventListener("loadeddata", onReady); resolve(); }, 5000);
            });
          }
        }

        setLoadStage("Let's go!");
        setLoadProgress(100);
        setLoading(false);

        let lastDetectTime = 0;
        let lastRepCount = 0;
        const detect = () => {
          if (cancelled || !videoRef.current || !canvasRef.current || !landmarkerRef.current) {
            return;
          }

          // Skip frame if video hasn't produced data yet (Android slow camera start)
          if (videoRef.current.readyState < 2) {
            animationIdRef.current = requestAnimationFrame(detect);
            return;
          }

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

          const accent = accentRef.current || getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
          const accentSecondary = accentSecondaryRef.current || getComputedStyle(document.documentElement).getPropertyValue("--color-accent-secondary").trim();
          const drawer = new DrawingUtils(ctx);
          for (const landmarks of result.landmarks) {
            drawer.drawLandmarks(landmarks, {
              radius: 3,
              color: accent,
              fillColor: accentSecondary,
            });
            drawer.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
              color: accent + "80",
              lineWidth: 2,
            });
          }

          // Composite recording canvas: video + skeleton + brand overlay
          const recCanvas = recordCanvasRef.current;
          if (recCanvas && recorderRef.current?.isRecording) {
            const vw = videoRef.current.videoWidth;
            const vh = videoRef.current.videoHeight;
            const rctx = recCanvas.getContext("2d");
            if (rctx) {
              rctx.clearRect(0, 0, vw, vh);
              // Draw mirrored video
              rctx.save();
              rctx.translate(vw, 0);
              rctx.scale(-1, 1);
              rctx.drawImage(videoRef.current, 0, 0, vw, vh);
              rctx.restore();
              // Draw skeleton overlay (mirrored to match video)
              rctx.save();
              rctx.translate(vw, 0);
              rctx.scale(-1, 1);
              rctx.drawImage(canvasRef.current!, 0, 0, vw, vh);
              rctx.restore();
              // Draw brand overlay (logo, QR, sponsors, rep count)
              if (brandConfigRef.current) {
                drawBrandOverlay(rctx, vw, vh, brandConfigRef.current);
              }
            }
          }

          if (result.landmarks.length > 0) {
            const lm = result.landmarks[0] as unknown as Landmark[];

            if (engineVersion === "v1" && engineV1Ref.current) {
              const frame = engineV1Ref.current.processFrame(lm, now);

              if (now - lastSignalUpdateRef.current > 100) {
                lastSignalUpdateRef.current = now;
                setRatio(frame.ratio);
                setCurrentState(frame.state);
                setAlignmentStatus(frame.alignmentStatus);
                setCalibrationCount(frame.calibrationCount);
              }

              if (frame.calibrated && !calibratedRef.current) {
                calibratedRef.current = true;
                setCalibrated(true);
                setShowReady(true);
                playGoAudio();
                setTimeout(() => setShowReady(false), 1500);
                accentRef.current = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
                accentSecondaryRef.current = getComputedStyle(document.documentElement).getPropertyValue("--color-accent-secondary").trim();
                // Start recording — initialize canvas dimensions first
                if (recordCanvasRef.current && videoRef.current && !recorderRef.current?.isRecording) {
                  recordCanvasRef.current.width = videoRef.current.videoWidth;
                  recordCanvasRef.current.height = videoRef.current.videoHeight;
                  const audioTracks = streamRef.current?.getAudioTracks() ?? [];
                  recorderRef.current = createVideoRecorder(recordCanvasRef.current, audioTracks);
                  recorderRef.current.start();
                }
              }

              if (frame.repCount > lastRepCount) {
                lastRepCount = frame.repCount;
                repCountRef.current = frame.repCount;
                setReps(frame.repCount);
                playRepAudio(frame.repCount);
                navigator.vibrate?.(100);
                if (!tuneMode) insertRep();
                // Capture poster frame on first rep (user is fresh)
                if (frame.repCount === 1) {
                  try {
                    if (videoRef.current && videoRef.current.videoWidth > 0) {
                      const pc = document.createElement("canvas");
                      pc.width = videoRef.current.videoWidth;
                      pc.height = videoRef.current.videoHeight;
                      const pctx = pc.getContext("2d");
                      if (pctx) {
                        pctx.translate(pc.width, 0);
                        pctx.scale(-1, 1);
                        pctx.drawImage(videoRef.current, 0, 0);
                        setPosterUrl(pc.toDataURL("image/jpeg", 0.8));
                      }
                    }
                  } catch { /* ignore */ }
                }
              }

              if (frame.stateChanged) {
                setStateLog((prev) => {
                  const entry = `${frame.state} r=${frame.ratio.toFixed(2)} raw=${frame.rawRatio.toFixed(2)}`;
                  const next = [entry, ...prev];
                  return next.length > 20 ? next.slice(0, 20) : next;
                });
              }
            } else if (engineVersion === "v2" && engineV2Ref.current) {
              const frame = engineV2Ref.current.processFrame(lm, now);

              if (now - lastSignalUpdateRef.current > 100) {
                lastSignalUpdateRef.current = now;
                setRatio(frame.ratio);
                setCurrentState(frame.state);
                setAlignmentStatus(frame.alignmentStatus);
                setCalibrationCount(frame.calibrationCount);
                setCameraAngle(frame.cameraAngle);
                setStabilityStatus(frame.stabilityStatus);
                setStabilityProgress(frame.stabilityProgress);
                setHipAngle(frame.hipAngle);
                setKneeAngle(frame.kneeAngle);
                setTorsoAngle(frame.torsoAngle);
              }

              if (frame.calibrated && !calibratedRef.current) {
                calibratedRef.current = true;
                setCalibrated(true);
                setShowReady(true);
                playGoAudio();
                setTimeout(() => setShowReady(false), 1500);
                accentRef.current = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
                accentSecondaryRef.current = getComputedStyle(document.documentElement).getPropertyValue("--color-accent-secondary").trim();
                // Start recording — initialize canvas dimensions first
                if (recordCanvasRef.current && videoRef.current && !recorderRef.current?.isRecording) {
                  recordCanvasRef.current.width = videoRef.current.videoWidth;
                  recordCanvasRef.current.height = videoRef.current.videoHeight;
                  const audioTracks = streamRef.current?.getAudioTracks() ?? [];
                  recorderRef.current = createVideoRecorder(recordCanvasRef.current, audioTracks);
                  recorderRef.current.start();
                }
              }

              if (frame.repCount > lastRepCount) {
                lastRepCount = frame.repCount;
                repCountRef.current = frame.repCount;
                setReps(frame.repCount);
                playRepAudio(frame.repCount);
                navigator.vibrate?.(100);
                if (!tuneMode) insertRep();
                if (frame.repCount === 1) {
                  try {
                    if (videoRef.current && videoRef.current.videoWidth > 0) {
                      const pc = document.createElement("canvas");
                      pc.width = videoRef.current.videoWidth;
                      pc.height = videoRef.current.videoHeight;
                      const pctx = pc.getContext("2d");
                      if (pctx) {
                        pctx.translate(pc.width, 0);
                        pctx.scale(-1, 1);
                        pctx.drawImage(videoRef.current, 0, 0);
                        setPosterUrl(pc.toDataURL("image/jpeg", 0.8));
                      }
                    }
                  } catch { /* ignore */ }
                }
              }

              if (frame.stateChanged) {
                const angleInfo = frame.cameraAngle === "side"
                  ? ` hip=${frame.hipAngle.toFixed(0)}° torso=${frame.torsoAngle.toFixed(0)}°`
                  : "";
                setStateLog((prev) => {
                  const entry = `${frame.state} r=${frame.ratio.toFixed(2)} raw=${frame.rawRatio.toFixed(2)}${angleInfo}`;
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
  }, [authLoading, screen, insertRep, tuneMode, engineVersion]);

  const finishSession = useCallback(async () => {
    // Capture video blob BEFORE changing screen state
    let blob: Blob | null = null;
    try {
      if (recorderRef.current?.isRecording) {
        blob = await recorderRef.current.stop();
      }
    } catch {
      // Recording failed — continue without video
    }

    stopCamera();

    if (blob && blob.size > 0) {
      setRecordedBlob(blob);
      setRecordedUrl(URL.createObjectURL(blob));
    }
    setCelebrating(false);
    setScreen("summary");

    try {
      if (profile) {
        const [userResult, globalResult] = await Promise.all([
          supabase
            .from("reps")
            .select("*", { count: "exact", head: true })
            .eq("user_id", profile.id),
          supabase.from("reps").select("*", { count: "exact", head: true }),
        ]);
        setSummaryUserTotal(userResult.count ?? 0);
        setSummaryGlobalTotal(globalResult.count ?? 0);
      } else {
        const { count } = await supabase.from("reps").select("*", { count: "exact", head: true });
        setSummaryGlobalTotal(count ?? 0);
      }
    } catch {
      // Network failed — totals stay at 0
    }
  }, [stopCamera, profile]);

  const handleStop = useCallback(() => {
    cancelAnimationFrame(animationIdRef.current);
    setCelebrating(true);
    navigator.vibrate?.([100, 50, 100, 50, 200]);

    // Run confetti on the visible canvas overlay
    const confettiCanvas = confettiCanvasRef.current;
    if (confettiCanvas) {
      const dpr = window.devicePixelRatio || 1;
      const parent = confettiCanvas.parentElement;
      const w = parent?.clientWidth || confettiCanvas.clientWidth || window.innerWidth;
      const h = parent?.clientHeight || confettiCanvas.clientHeight || window.innerHeight;
      confettiCanvas.width = w * dpr;
      confettiCanvas.height = h * dpr;
    }

    // Also render confetti into the recording canvas
    const recCanvas = recordCanvasRef.current;
    const video = videoRef.current;
    const skelCanvas = canvasRef.current;
    if (recCanvas && video && recorderRef.current?.isRecording) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const rctx = recCanvas.getContext("2d");
      const particles = createParticles(vw, vh);
      const startTime = performance.now();

      const drawRecordingFrame = (now: number) => {
        if (!rctx) return;
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / CONFETTI_DURATION, 1);

        rctx.clearRect(0, 0, vw, vh);
        // Draw mirrored video
        rctx.save();
        rctx.translate(vw, 0);
        rctx.scale(-1, 1);
        rctx.drawImage(video, 0, 0, vw, vh);
        rctx.restore();
        // Draw skeleton
        if (skelCanvas) {
          rctx.save();
          rctx.translate(vw, 0);
          rctx.scale(-1, 1);
          rctx.drawImage(skelCanvas, 0, 0, vw, vh);
          rctx.restore();
        }
        // Draw brand overlay
        if (brandConfigRef.current) {
          drawBrandOverlay(rctx, vw, vh, brandConfigRef.current);
        }
        // Draw confetti — update particle positions
        for (const p of particles) {
          p.x += p.vx;
          p.vy += GRAVITY;
          p.y += p.vy;
          p.rotation += p.rotationSpeed;
        }
        drawConfettiFrame(rctx, vw, vh, progress, particles);

        if (progress < 1) {
          requestAnimationFrame(drawRecordingFrame);
        }
      };
      requestAnimationFrame(drawRecordingFrame);
    }

    // Run visible confetti and transition after it finishes
    if (confettiCanvas) {
      runConfetti(confettiCanvas, () => finishSession());
    } else {
      setTimeout(() => finishSession(), CONFETTI_DURATION);
    }
  }, [finishSession]);

  if (authLoading) return null;

  if (screen === "gender-picker") {
    const genderOptions: { label: string; value: Gender }[] = [
      { label: "Female", value: "female" },
      { label: "Male", value: "male" },
      { label: "Non-binary", value: "non_binary" },
    ];

    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] -mx-4 -mt-6 px-4">
        <div className="w-full max-w-sm text-center">
          <p className="text-display-md text-ink-primary">See how you rank!</p>
          <p className="text-body text-ink-secondary mt-3">
            Pick your category to see the leaderboard
          </p>
          <div className="flex flex-col gap-3 mt-8">
            {genderOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  if (!profile) {
                    setGuestGender(opt.value);
                  }
                  navigate(`/leaderboard?signup=1&gender=${opt.value}&reps=${reps}`);
                }}
                className="w-full py-4 px-6 rounded-pill bg-bg-elevated text-ink-primary font-semibold text-body-lg transition-all duration-200 ease-apple active:scale-95"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (screen === "summary") {
    return (
      <div className="flex flex-col -mx-4" style={{ height: "calc(100dvh - 44px - 68px)" }}>
        {/* Stats row */}
        <div className="flex items-baseline justify-center gap-4 px-4 pt-2 pb-1 flex-shrink-0">
          <div className="text-center">
            <p className="text-body-lg text-ink-primary font-bold tabular-nums leading-none">{summaryGlobalTotal.toLocaleString()}</p>
            <p className="text-micro text-ink-muted mt-0.5">GLOBAL</p>
          </div>
          <div className="w-px h-8 bg-divider" />
          <div className="text-center">
            <p className="text-display-md text-accent tabular-nums leading-none">+{reps}</p>
            <p className="text-micro text-ink-muted mt-0.5">{reps === 1 ? "REP" : "REPS"}</p>
          </div>
          {profile && (
            <>
              <div className="w-px h-8 bg-divider" />
              <div className="text-center">
                <p className="text-body-lg text-ink-primary font-bold tabular-nums leading-none">{summaryUserTotal.toLocaleString()}</p>
                <p className="text-micro text-ink-muted mt-0.5">YOUR TOTAL</p>
              </div>
            </>
          )}
        </div>

        {/* Video preview — constrained to fit between stats and action bar */}
        <div className="flex-1 min-h-0 flex items-center justify-center px-4 py-1">
          {recordedUrl ? (
            <div className="max-h-full w-full rounded-xl overflow-hidden bg-bg-surface flex items-center justify-center">
              <video
                src={recordedUrl}
                poster={posterUrl || undefined}
                controls
                playsInline
                className="max-w-full max-h-full rounded-xl"
              />
            </div>
          ) : (
            <p className="text-body text-ink-muted">
              {reps > 0 ? "Nice work!" : "No reps this time"}
            </p>
          )}
        </div>

        {/* Action bar */}
        <div className="flex-shrink-0 px-4 pb-2">
        <div className="bg-bg-elevated rounded-xl flex max-w-md mx-auto">
          <button
            onClick={() => {
              if (recordedUrl) URL.revokeObjectURL(recordedUrl);
              navigate("/home");
            }}
            className="flex-1 py-3 text-ink-primary font-bold text-caption transition-all duration-200 ease-apple active:scale-95"
          >
            Home
          </button>
          {recordedBlob && (
            <>
              <div className="w-px my-2 bg-divider" />
              <button
                onClick={async () => {
                  const ext = recordedBlob.type.includes("mp4") ? "mp4" : "webm";
                  const filename = `repps-${reps}-reps.${ext}`;
                  const file = new File([recordedBlob], filename, { type: recordedBlob.type });
                  if (navigator.canShare?.({ files: [file] })) {
                    try {
                      await navigator.share({
                        files: [file],
                        title: `${reps} ${reps === 1 ? "rep" : "reps"} on REPPs`,
                      });
                    } catch (e) {
                      if ((e as Error).name !== "AbortError") {
                        downloadBlob(recordedBlob, filename);
                      }
                    }
                  } else {
                    downloadBlob(recordedBlob, filename);
                  }
                  if (reps > 0) setScreen("gender-picker");
                }}
                className="flex-1 py-3 text-accent font-bold text-caption transition-all duration-200 ease-apple active:scale-95"
              >
                Share
              </button>
            </>
          )}
        </div>
        </div>
      </div>
    );
  }

  if (cameraError) {
    return (
      <div className="flex flex-col items-center justify-center text-center pt-24 px-4">
        <p className="text-display-md">📷</p>
        <p className="text-body text-ink-primary mt-4">{cameraError}</p>
        <button
          onClick={() => navigate("/home")}
          className="mt-8 bg-bg-elevated text-ink-primary font-bold text-body-lg rounded-pill py-4 px-8 transition-all duration-200 ease-apple active:scale-95"
        >
          Back to Home
        </button>
      </div>
    );
  }

  // Determine pre-calibration message based on engine version
  const getPreCalibrationMessage = () => {
    if (engineVersion === "v2" && alignmentStatus === "stabilizing") {
      return {
        title: "Place your phone down",
        subtitle: "Finding a stable position…",
        progress: stabilityProgress,
        color: stabilityStatus === "stabilizing" ? "var(--color-accent)" : "#5C6066",
      };
    }
    return {
      title:
        alignmentStatus === "no-pose" ? "Step into frame" :
        alignmentStatus === "too-close" ? "Step back a bit" :
        alignmentStatus === "too-far" ? "Move closer" :
        alignmentStatus === "off-center" ? "Move to center" :
        "Hold still…",
      subtitle: alignmentStatus === "aligned" ? "Calibrating your position" : "Line up with the outline",
      progress: calibrationCount / CALIBRATION_FRAMES,
      color: alignmentStatus === "aligned" ? "var(--color-accent)" : "#5C6066",
    };
  };

  const preCalMsg = getPreCalibrationMessage();

  return (
    <div className="flex flex-col items-center -mx-4 -mt-6">
      {/* Rep counter overlay */}
      <div className="w-full text-center py-4 relative z-10">
        {tuneMode && (
          <p className="text-micro text-accent uppercase mb-1">
            Tune Mode — {engineVersion.toUpperCase()}
            {engineVersion === "v2" && cameraAngle !== "unknown" && ` — ${cameraAngle.toUpperCase()}`}
          </p>
        )}
        <p className="text-micro text-ink-muted uppercase tracking-wide">Drop A Burpee</p>
        <p className="text-display-xl text-accent tabular-nums">{reps}</p>
        {calibrated && reps === 0 && (
          <p className="text-micro text-ink-muted mt-0.5">Each rep must be under 10 seconds</p>
        )}
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
        {!loading && !calibrated && (
          <div className="absolute inset-0 z-20 pointer-events-none">
            {/* Dark mask with body-shaped cutout */}
            <svg
              viewBox="0 0 300 400"
              className="absolute inset-0 w-full h-full"
              preserveAspectRatio="xMidYMid slice"
            >
              <defs>
                <mask id="body-cutout">
                  <rect width="300" height="400" fill="white" />
                  {/* Body silhouette path — standing person shape */}
                  <path
                    d="
                      M 150 50
                      C 138 50, 128 60, 128 72
                      C 128 84, 138 94, 150 94
                      C 162 94, 172 84, 172 72
                      C 172 60, 162 50, 150 50
                      Z
                      M 132 98
                      C 118 100, 112 108, 110 118
                      L 96 162
                      C 94 168, 98 172, 104 170
                      L 120 158
                      L 120 230
                      L 108 310
                      C 106 320, 112 326, 120 324
                      L 128 322
                      C 134 321, 138 316, 139 310
                      L 148 248
                      L 152 248
                      L 161 310
                      C 162 316, 166 321, 172 322
                      L 180 324
                      C 188 326, 194 320, 192 310
                      L 180 230
                      L 180 158
                      L 196 170
                      C 202 172, 206 168, 204 162
                      L 190 118
                      C 188 108, 182 100, 168 98
                      Z
                    "
                    fill="black"
                    transform="translate(0, 12)"
                  />
                </mask>
              </defs>
              <rect
                width="300" height="400"
                fill="black"
                opacity={alignmentStatus === "aligned" ? 0.6 : 0.7}
                mask="url(#body-cutout)"
                className="transition-opacity duration-300"
              />
            </svg>

            {/* Instruction card — positioned at bottom of camera area */}
            <div className="absolute bottom-4 left-0 right-0 flex justify-center px-4">
              <div className="bg-bg-base/85 backdrop-blur-sm rounded-xl px-6 py-4 text-center max-w-xs">
                <p className="text-body-lg text-ink-primary font-semibold">
                  {preCalMsg.title}
                </p>
                <p className="text-caption text-ink-secondary mt-1">
                  {preCalMsg.subtitle}
                </p>
                <div className="w-[80%] h-3 bg-bg-input rounded-pill overflow-hidden mt-4 mx-auto">
                  <div
                    className="h-full rounded-pill transition-all duration-150 ease-apple"
                    style={{
                      width: `${preCalMsg.progress * 100}%`,
                      backgroundColor: preCalMsg.color,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
        {showReady && (
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
            <p className="text-display-lg text-accent font-bold animate-pulse">GO!</p>
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
        {/* Hidden canvas for recording — composites video + skeleton + brand overlay */}
        <canvas ref={recordCanvasRef} style={{ display: "none" }} />
        {/* Confetti overlay canvas */}
        <canvas
          ref={confettiCanvasRef}
          className="absolute inset-0 z-30 pointer-events-none"
          style={{ width: "100%", height: "100%" }}
        />
      </div>

      {/* Finish button — fixed above bottom nav */}
      {calibrated && !celebrating && (
        <div className="fixed bottom-[76px] left-0 right-0 z-50 px-4 pb-2">
          <button
            onClick={handleStop}
            className="cta-button w-full max-w-md mx-auto block bg-accent text-ink-inverse font-bold text-body-lg rounded-pill py-4 transition-all duration-200 ease-apple active:scale-95 active:!animate-none"
          >
            Finish
          </button>
        </div>
      )}

      {/* Debug strip */}
      {!tuneMode && (
        <div className="fixed bottom-16 left-0 right-0 z-40 flex justify-center">
          <div className="flex gap-4 px-3 py-1 bg-bg-surface rounded-pill text-micro text-ink-muted tabular-nums">
            <span>{calibrated ? currentState : (alignmentStatus === "stabilizing" ? "Stabilizing…" : "Stand still…")}</span>
            <span>{ratio.toFixed(2)}</span>
            {engineVersion === "v2" && cameraAngle !== "unknown" && (
              <span>{cameraAngle}</span>
            )}
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
              <span>
                {engineVersion.toUpperCase()} — {calibrated ? currentState : (alignmentStatus === "stabilizing" ? "Stabilizing" : "Stand still…")} — ratio {ratio.toFixed(2)}
                {engineVersion === "v2" && cameraAngle !== "unknown" && ` — ${cameraAngle}`}
              </span>
              <span>{tuneOpen ? "▼" : "▲"}</span>
            </button>
            {tuneOpen && (
              <div className="px-3 pb-3 space-y-3">
                <div className="bg-bg-elevated rounded-md p-2 text-micro text-ink-muted">
                  DB writes disabled. Engine: {engineVersion.toUpperCase()}.
                  {engineVersion === "v2" && cameraAngle !== "unknown" && ` Angle: ${cameraAngle}.`}
                  {engineVersion === "v2" && !calibrated && stabilityStatus !== "stable" && " Waiting for stability…"}
                  {!calibrated && stabilityStatus === "stable" && " Stand still with full body visible…"}
                  {engineVersion === "v2" && calibrated && cameraAngle === "side" && (
                    <> Hip: {hipAngle.toFixed(0)}° Knee: {kneeAngle.toFixed(0)}° Torso: {torsoAngle.toFixed(0)}°</>
                  )}
                </div>
                {engineVersion === "v1" && (
                  <>
                    <TuneSlider
                      label="HIGH ratio (standing)"
                      value={tuneValues.highRatio}
                      min={0.5} max={0.95} step={0.01}
                      onChange={(v) => {
                        engineV1Ref.current?.setThresholds({ highRatio: v });
                        setTuneValues((p) => ({ ...p, highRatio: v }));
                      }}
                    />
                    <TuneSlider
                      label="LOW ratio (down)"
                      value={tuneValues.lowRatio}
                      min={0.2} max={0.7} step={0.01}
                      onChange={(v) => {
                        engineV1Ref.current?.setThresholds({ lowRatio: v });
                        setTuneValues((p) => ({ ...p, lowRatio: v }));
                      }}
                    />
                    <TuneSlider
                      label="Max rep duration (ms)"
                      value={tuneValues.maxDuration}
                      min={3000} max={15000} step={500}
                      onChange={(v) => {
                        engineV1Ref.current?.setThresholds({ maxDuration: v });
                        setTuneValues((p) => ({ ...p, maxDuration: v }));
                      }}
                    />
                  </>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setReps(0);
                      repCountRef.current = 0;
                      engineV1Ref.current?.reset();
                      engineV2Ref.current?.reset();
                      setStateLog([]);
                    }}
                    className="flex-1 bg-bg-input text-ink-secondary text-micro rounded-md py-2"
                  >
                    RESET COUNT
                  </button>
                  <button
                    onClick={() => {
                      if (engineVersion === "v1") {
                        engineV1Ref.current?.setThresholds({ ...V1_DEFAULTS });
                        setTuneValues({ ...V1_DEFAULTS });
                      }
                    }}
                    className="flex-1 bg-bg-input text-ink-secondary text-micro rounded-md py-2"
                  >
                    RESET DEFAULTS
                  </button>
                  <button
                    onClick={() => {
                      engineV1Ref.current?.recalibrate();
                      engineV2Ref.current?.recalibrate();
                      calibratedRef.current = false;
                      setCalibrated(false);
                      setCalibrationCount(0);
                      setStabilityStatus("unstable");
                      setStabilityProgress(0);
                      setCameraAngle("unknown");
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
