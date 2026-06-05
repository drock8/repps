import QRCode from "qrcode";

export interface BrandOverlayConfig {
  logoImg: HTMLImageElement | null;
  sponsorImgs: HTMLImageElement[];
  qrDataUrl: string | null;
  _qrImg?: HTMLImageElement | null;
  repCount: () => number;
  accentColor: () => string;
}

const QR_SIZE = 128;
const LOGO_HEIGHT = 54;
const SPONSOR_HEIGHT = 28;
const PADDING = 32;
const BOTTOM_BAR_HEIGHT = 160;

export async function generateQRDataUrl(referralUrl: string, logoSrc?: string): Promise<string> {
  const size = QR_SIZE * 4;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  await QRCode.toCanvas(canvas, referralUrl, {
    width: size,
    margin: 1,
    color: { dark: "#111315", light: "#F5F2EA" },
    errorCorrectionLevel: "H",
  });
  if (logoSrc) {
    try {
      const logo = await loadImage(logoSrc);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const logoSize = size * 0.22;
        const pad = logoSize * 0.12;
        const cx = (size - logoSize) / 2;
        const cy = (size - logoSize) / 2;
        ctx.fillStyle = "#F5F2EA";
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, (logoSize + pad) / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.drawImage(logo, cx, cy, logoSize, logoSize);
      }
    } catch {
      // Logo failed — QR still works without it
    }
  }
  return canvas.toDataURL("image/png");
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function drawBrandOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  config: BrandOverlayConfig
) {
  const { logoImg, sponsorImgs, repCount } = config;

  // Bottom bar background
  ctx.fillStyle = "rgba(17, 19, 21, 0.75)";
  ctx.fillRect(0, h - BOTTOM_BAR_HEIGHT, w, BOTTOM_BAR_HEIGHT);

  // Rep count in bottom bar — left side
  const count = repCount();
  ctx.fillStyle = config.accentColor();
  ctx.font = `bold ${Math.round(h * 0.035)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `${count} ${count === 1 ? "REP" : "REPS"}`,
    PADDING,
    h - BOTTOM_BAR_HEIGHT / 2
  );

  // REPPS logo — top left
  if (logoImg) {
    const logoW = (logoImg.width / logoImg.height) * LOGO_HEIGHT;
    ctx.drawImage(logoImg, PADDING, PADDING, logoW, LOGO_HEIGHT);
  }

  // QR code — bottom right with CTA
  if (config._qrImg) {
    const qrY = h - BOTTOM_BAR_HEIGHT + (BOTTOM_BAR_HEIGHT - QR_SIZE) / 2;
    const qrX = w - QR_SIZE - PADDING;
    const qrR = QR_SIZE * 0.1;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(qrX, qrY, QR_SIZE, QR_SIZE, qrR);
    ctx.clip();
    ctx.drawImage(config._qrImg, qrX, qrY, QR_SIZE, QR_SIZE);
    ctx.restore();
    const ctaSize = Math.round(h * 0.018);
    ctx.fillStyle = "#F5F2EA";
    ctx.font = `bold ${ctaSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText("Scan to join →", qrX - 12, h - BOTTOM_BAR_HEIGHT / 2);
  }

  // Sponsor logos — top right, stacked vertically
  let sponsorY = PADDING;
  for (const sImg of sponsorImgs) {
    const sW = (sImg.width / sImg.height) * SPONSOR_HEIGHT;
    ctx.drawImage(sImg, w - sW - PADDING, sponsorY, sW, SPONSOR_HEIGHT);
    sponsorY += SPONSOR_HEIGHT + 8;
  }
}

export interface RecorderHandle {
  start: () => void;
  stop: () => Promise<Blob>;
  isRecording: boolean;
}

export function createVideoRecorder(
  canvas: HTMLCanvasElement,
  audioTracks: MediaStreamTrack[],
  fps = 30
): RecorderHandle {
  const canvasStream = canvas.captureStream(fps);
  const combinedStream = new MediaStream(canvasStream.getVideoTracks());

  for (const track of audioTracks) {
    combinedStream.addTrack(track);
  }

  const chunks: Blob[] = [];
  let recorder: MediaRecorder | null = null;
  let recording = false;

  const mimeType = MediaRecorder.isTypeSupported("video/mp4;codecs=avc1,mp4a")
    ? "video/mp4"
    : MediaRecorder.isTypeSupported("video/mp4")
      ? "video/mp4"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : MediaRecorder.isTypeSupported("video/webm")
          ? "video/webm"
          : "video/mp4";

  return {
    get isRecording() {
      return recording;
    },
    start() {
      chunks.length = 0;
      recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 4_000_000 });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.start(1000);
      recording = true;
    },
    stop() {
      return new Promise<Blob>((resolve) => {
        if (!recorder || recorder.state === "inactive") {
          resolve(new Blob(chunks, { type: mimeType }));
          recording = false;
          return;
        }
        let resolved = false;
        const finish = () => {
          if (resolved) return;
          resolved = true;
          recording = false;
          resolve(new Blob(chunks, { type: mimeType }));
        };
        recorder.onstop = finish;
        // Flush any buffered data before stopping
        try { recorder.requestData(); } catch {}
        setTimeout(finish, 2000);
        recorder.stop();
      });
    },
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
