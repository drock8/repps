import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

interface QRScannerProps {
  onScan: (url: string) => void;
  onClose: () => void;
}

export default function QRScanner({ onScan, onClose }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setError("Camera access denied");
        return;
      }

      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

      const scan = () => {
        if (cancelled || !videoRef.current || videoRef.current.readyState < 2) {
          if (!cancelled) timeoutId = setTimeout(scan, 200);
          return;
        }
        const vw = videoRef.current.videoWidth;
        const vh = videoRef.current.videoHeight;
        canvas.width = vw;
        canvas.height = vh;
        ctx.drawImage(videoRef.current, 0, 0, vw, vh);
        const imageData = ctx.getImageData(0, 0, vw, vh);
        const code = jsQR(imageData.data, vw, vh);
        if (code?.data) {
          onScan(code.data);
          return;
        }
        if (!cancelled) timeoutId = setTimeout(scan, 150);
      };
      timeoutId = setTimeout(scan, 300);
    }

    start();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 pt-3 pb-2" style={{ paddingTop: "calc(12px + env(safe-area-inset-top))" }}>
        <p className="text-body text-white font-semibold">Scan QR Code</p>
        <button onClick={onClose} className="text-white/70 p-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="flex-1 relative flex items-center justify-center">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
        <canvas ref={canvasRef} className="hidden" />
        <div className="relative w-64 h-64 border-2 border-white/50 rounded-2xl">
          <div className="absolute top-0 left-0 w-8 h-8 border-t-3 border-l-3 border-white rounded-tl-2xl" />
          <div className="absolute top-0 right-0 w-8 h-8 border-t-3 border-r-3 border-white rounded-tr-2xl" />
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-3 border-l-3 border-white rounded-bl-2xl" />
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-3 border-r-3 border-white rounded-br-2xl" />
        </div>
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <p className="text-white text-body text-center px-8">{error}</p>
          </div>
        )}
      </div>

      <p className="text-center text-white/60 text-caption pb-6" style={{ paddingBottom: "calc(24px + env(safe-area-inset-bottom))" }}>
        Point at a QR code
      </p>
    </div>
  );
}
