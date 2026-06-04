import QRCode from "qrcode";

const DARK = "#111315";
const LIGHT = "#F5F2EA";

interface RenderOpts {
  size: number;
  logoSrc?: string;
  cornerRadius?: number;
}

function isFinderModule(row: number, col: number, moduleCount: number): boolean {
  const inTopLeft = row < 7 && col < 7;
  const inTopRight = row < 7 && col >= moduleCount - 7;
  const inBottomLeft = row >= moduleCount - 7 && col < 7;
  return inTopLeft || inTopRight || inBottomLeft;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fill();
}

function drawFinderPattern(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  cellSize: number
) {
  const outerR = cellSize * 1.2;
  const innerR = cellSize * 0.8;

  ctx.fillStyle = DARK;
  drawRoundedRect(ctx, originX, originY, cellSize * 7, cellSize * 7, outerR);

  ctx.fillStyle = LIGHT;
  drawRoundedRect(
    ctx,
    originX + cellSize,
    originY + cellSize,
    cellSize * 5,
    cellSize * 5,
    innerR
  );

  ctx.fillStyle = DARK;
  drawRoundedRect(
    ctx,
    originX + cellSize * 2,
    originY + cellSize * 2,
    cellSize * 3,
    cellSize * 3,
    innerR * 0.6
  );
}

export async function renderStyledQR(
  canvas: HTMLCanvasElement,
  url: string,
  opts: RenderOpts
): Promise<void> {
  const { size, logoSrc, cornerRadius = 0.35 } = opts;

  const qr = QRCode.create(url, { errorCorrectionLevel: "H" });
  const modules = qr.modules;
  const moduleCount = modules.size;
  const data = modules.data;

  const margin = 2;
  const totalModules = moduleCount + margin * 2;
  const cellSize = size / totalModules;
  const r = cellSize * cornerRadius;

  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = LIGHT;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = DARK;
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (isFinderModule(row, col, moduleCount)) continue;
      if (!data[row * moduleCount + col]) continue;

      const x = (col + margin) * cellSize;
      const y = (row + margin) * cellSize;
      drawRoundedRect(ctx, x, y, cellSize, cellSize, r);
    }
  }

  const topLeft = margin * cellSize;
  const topRight = (moduleCount - 7 + margin) * cellSize;
  const bottomLeft = (moduleCount - 7 + margin) * cellSize;

  drawFinderPattern(ctx, topLeft, topLeft, cellSize);
  drawFinderPattern(ctx, topRight, topLeft, cellSize);
  drawFinderPattern(ctx, topLeft, bottomLeft, cellSize);

  if (logoSrc) {
    try {
      const img = await loadImg(logoSrc);
      const logoSize = size * 0.22;
      const pad = logoSize * 0.15;
      const cx = (size - logoSize) / 2;
      const cy = (size - logoSize) / 2;

      ctx.fillStyle = LIGHT;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, (logoSize + pad) / 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.drawImage(img, cx, cy, logoSize, logoSize);
    } catch {
      // Logo failed to load — QR still works without it
    }
  }

  roundCanvasCorners(ctx, size, cellSize * 2);
}

function roundCanvasCorners(
  ctx: CanvasRenderingContext2D,
  size: number,
  r: number
) {
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.arcTo(size, 0, size, r, r);
  ctx.lineTo(size, size - r);
  ctx.arcTo(size, size, size - r, size, r);
  ctx.lineTo(r, size);
  ctx.arcTo(0, size, 0, size - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function generateStyledQRDataUrl(
  url: string,
  size: number,
  logoSrc?: string
): Promise<string> {
  const canvas = document.createElement("canvas");
  await renderStyledQR(canvas, url, { size, logoSrc });
  return canvas.toDataURL("image/png");
}
