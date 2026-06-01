const COLORS = ["#E8913A", "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"];
const PARTICLE_COUNT = 80;
const GRAVITY = 0.003;
const DURATION_MS = 2000;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  shape: "rect" | "circle";
}

function createParticles(_width: number, _height: number): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + (i % 3) * 0.2;
    const speed = 0.008 + (i % 7) * 0.003;
    particles.push({
      x: 0.5 + ((i % 5) - 2) * 0.05,
      y: 0.4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.012,
      size: 6 + (i % 4) * 4,
      color: COLORS[i % COLORS.length],
      rotation: (i * 37) % 360,
      rotationSpeed: (i % 2 === 0 ? 1 : -1) * (3 + (i % 5)),
      shape: i % 3 === 0 ? "circle" : "rect",
    });
  }
  return particles;
}

export function runConfetti(
  canvas: HTMLCanvasElement,
  onComplete: () => void,
): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    onComplete();
    return () => {};
  }

  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  const particles = createParticles(cssW, cssH);
  const startTime = performance.now();
  let animId = 0;
  let cancelled = false;

  const dpr = canvas.width / cssW || 1;

  const draw = (now: number) => {
    if (cancelled) return;
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / DURATION_MS, 1);
    const fade = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.globalAlpha = fade;

    for (const p of particles) {
      p.x += p.vx;
      p.vy += GRAVITY;
      p.y += p.vy;
      p.rotation += p.rotationSpeed;

      const px = p.x * cssW;
      const py = p.y * cssH;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;

      if (p.shape === "circle") {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    }

    ctx.restore();
    ctx.globalAlpha = 1;

    if (progress >= 1) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      onComplete();
      return;
    }
    animId = requestAnimationFrame(draw);
  };

  animId = requestAnimationFrame(draw);

  return () => {
    cancelled = true;
    cancelAnimationFrame(animId);
  };
}

export function drawConfettiFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  progress: number,
  particles: ReturnType<typeof createParticles>,
) {
  const fade = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1;
  ctx.globalAlpha = fade;

  for (const p of particles) {
    const px = p.x * w;
    const py = p.y * h;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate((p.rotation * Math.PI) / 180);
    ctx.fillStyle = p.color;

    if (p.shape === "circle") {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

export { createParticles, DURATION_MS, GRAVITY };
