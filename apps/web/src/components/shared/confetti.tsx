import { useCallback, useEffect, useRef } from 'react';

/**
 * A short burst of confetti for the one moment this product celebrates: an
 * early arrival at the punch screen (owner, 21 Aug 2026). Hand-rolled on a
 * canvas rather than a dependency, because eighty lines is less to own than
 * a package. Honours prefers-reduced-motion by drawing nothing - the toast
 * still says what happened, so nobody misses the fact, only the motion.
 *
 * Colours come from the theme tokens, read at fire time, so the burst is the
 * product's palette in both themes rather than a fixed rainbow.
 */

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  width: number;
  height: number;
  colour: string;
  life: number;
}

const PIECES = 90;
const GRAVITY = 0.18;
const DRAG = 0.992;
const LIFETIME_FRAMES = 150;
const TOKENS = ['--primary', '--chart-2', '--chart-3', '--chart-4', '--chart-5'];

function tokenColours(): string[] {
  const style = getComputedStyle(document.documentElement);
  return TOKENS.map((token) => style.getPropertyValue(token).trim()).filter((value) => value !== '');
}

export function useConfetti(): { canvas: React.ReactNode; fire: () => void } {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = 'none';
    }
  }, []);

  useEffect(() => stop, [stop]);

  const fire = useCallback(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    stop();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    canvas.style.display = 'block';
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const colours = tokenColours();
    const originX = window.innerWidth / 2;
    const originY = window.innerHeight * 0.6;
    const pieces: Piece[] = Array.from({ length: PIECES }, (_, index) => {
      // Two fans, left and right, so the burst reads as thrown rather than dropped.
      const angle = (-Math.PI / 2) + (index % 2 === 0 ? -1 : 1) * (Math.PI / 6 + Math.random() * (Math.PI / 5));
      const speed = 9 + Math.random() * 7;
      return {
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
        width: 6 + Math.random() * 5,
        height: 3 + Math.random() * 3,
        colour: colours[index % Math.max(1, colours.length)] ?? 'currentColor',
        life: LIFETIME_FRAMES,
      };
    });

    const step = () => {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      let alive = 0;
      for (const piece of pieces) {
        if (piece.life <= 0) continue;
        alive += 1;
        piece.vy += GRAVITY;
        piece.vx *= DRAG;
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.rotation += piece.spin;
        piece.life -= 1;
        context.save();
        context.globalAlpha = Math.min(1, piece.life / 40);
        context.translate(piece.x, piece.y);
        context.rotate(piece.rotation);
        context.fillStyle = piece.colour;
        context.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
        context.restore();
      }
      if (alive > 0) frameRef.current = requestAnimationFrame(step);
      else stop();
    };
    frameRef.current = requestAnimationFrame(step);
  }, [stop]);

  const canvas = (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 hidden h-full w-full"
    />
  );

  return { canvas, fire };
}
