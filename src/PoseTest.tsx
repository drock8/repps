import { useEffect, useRef, useState } from "react";
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "@mediapipe/tasks-vision";

type RepState = "HIGH" | "LOW" | "UNKNOWN";

export default function PoseTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // State machine refs (not React state — we update these every frame)
  const repStateRef = useRef<RepState>("UNKNOWN");
  const lastHighTimeRef = useRef<number>(0);
  const hasBeenLowRef = useRef<boolean>(false);

  // Visible state — only updates when a rep completes
  const [reps, setReps] = useState(0);
  const [currentState, setCurrentState] = useState<RepState>("UNKNOWN");
  const [noseY, setNoseY] = useState(0);

  useEffect(() => {
    let landmarker: PoseLandmarker | null = null;
    let animationId = 0;

    const init = async () => {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
      });

     let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
        });
      } catch (err) {
        alert("Camera error: " + (err as Error).message);
        return;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const detect = () => {
        if (!videoRef.current || !canvasRef.current || !landmarker) return;
        const result = landmarker.detectForVideo(
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
          drawer.drawLandmarks(landmarks);
          drawer.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS);
        }

        // --- REP DETECTION LOGIC ---
        if (result.landmarks.length > 0) {
          const nose = result.landmarks[0][0]; // landmark 0 = nose
          const y = nose.y;
          setNoseY(y);

          const now = performance.now();
          const HIGH_THRESHOLD = 0.4;
          const LOW_THRESHOLD = 0.7;
          const MAX_REP_DURATION_MS = 8000;

          // Determine current physical state
          let newState: RepState = repStateRef.current;
          if (y < HIGH_THRESHOLD) newState = "HIGH";
          else if (y > LOW_THRESHOLD) newState = "LOW";

          // State transition logic
          if (newState !== repStateRef.current) {
            if (newState === "HIGH") {
              // Returned to standing
              if (
                hasBeenLowRef.current &&
                now - lastHighTimeRef.current < MAX_REP_DURATION_MS
              ) {
                // Completed a full rep: HIGH → LOW → HIGH
                setReps((r) => r + 1);
              }
              // Reset for next rep
              lastHighTimeRef.current = now;
              hasBeenLowRef.current = false;
            } else if (newState === "LOW") {
              hasBeenLowRef.current = true;
            }
            repStateRef.current = newState;
            setCurrentState(newState);
          }
        }

        animationId = requestAnimationFrame(detect);
      };
      detect();
    };

    init();
    return () => {
      cancelAnimationFrame(animationId);
      landmarker?.close();
    };
  }, []);

  return (
    <div style={{ maxWidth: "640px", margin: "0 auto" }}>
      {/* Counter display */}
      <div
        style={{
          textAlign: "center",
          padding: "20px",
          background: "#1a1a1a",
          color: "#ff6b35",
          fontSize: "72px",
          fontWeight: "bold",
          fontFamily: "monospace",
        }}
      >
        {reps}
      </div>

      {/* Debug strip */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "8px 16px",
          background: "#2a2a2a",
          color: "#fff",
          fontFamily: "monospace",
          fontSize: "12px",
        }}
      >
        <span>State: {currentState}</span>
        <span>Nose Y: {noseY.toFixed(2)}</span>
        <span>Been low: {hasBeenLowRef.current ? "yes" : "no"}</span>
      </div>

      {/* Camera + skeleton */}
      <div style={{ position: "relative", width: "100%" }}>
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: "100%", display: "block" }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
          }}
        />
      </div>

      {/* Reset button */}
      <button
        onClick={() => {
          setReps(0);
          repStateRef.current = "UNKNOWN";
          hasBeenLowRef.current = false;
        }}
        style={{
          marginTop: "16px",
          padding: "12px 24px",
          background: "#ff6b35",
          color: "white",
          border: "none",
          borderRadius: "8px",
          fontSize: "16px",
          cursor: "pointer",
          width: "100%",
        }}
      >
        Reset Counter
      </button>
    </div>
  );
}
