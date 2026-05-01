"use client";

/**
 * D20 wireframe — lienzo 100×100 u.
 *
 * Carga continua (abajo → arriba): el progreso reparte longitud sobre cada arista en orden.
 * Usamos `<line>` por segmento con stroke-dasharray en la arista actual en construcción:
 * un único `<path>` con varias `M` rompe el dash en muchos navegadores (subtrazos independientes).
 */
const STROKE_DIM = "#00FF66";
const STROKE_LIT = "#7CFFB8";
const STROKE_WIDTH = 2.6;

const CX = 50;
const CY = 50;
const R = 39;
const K = R * (Math.sqrt(3) / 2);

const INNER_TOP_Y = 34;

function outerHexCW(): {
  A: readonly [number, number];
  B: readonly [number, number];
  D: readonly [number, number];
  I: readonly [number, number];
  F: readonly [number, number];
  H: readonly [number, number];
} {
  return {
    A: [CX, CY - R],
    B: [CX - K, CY - R / 2],
    D: [CX - K, CY + R / 2],
    I: [CX, CY + R],
    F: [CX + K, CY + R / 2],
    H: [CX + K, CY - R / 2],
  };
}

function innerCG(o: ReturnType<typeof outerHexCW>): {
  C: readonly [number, number];
  G: readonly [number, number];
} {
  const midBD: readonly [number, number] = [o.B[0], CY];
  const t = (INNER_TOP_Y - o.A[1]) / (midBD[1] - o.A[1]);
  const cx = o.A[0] + t * (midBD[0] - o.A[0]);
  const cy = INNER_TOP_Y;
  const x = Number(cx.toFixed(4));
  const y = Number(cy.toFixed(4));
  return {
    C: [x, y],
    G: [CX + (CX - x), y],
  };
}

const O = outerHexCW();
const IN = innerCG(O);

const EY = 74;

const POINTS = {
  A: O.A,
  B: O.B,
  C: IN.C,
  D: O.D,
  E: [CX, EY] as const,
  F: O.F,
  G: IN.G,
  H: O.H,
  I: O.I,
} as const;

type PointKey = keyof typeof POINTS;

function seg(a: PointKey, b: PointKey): readonly [number, number, number, number] {
  const p = POINTS[a];
  const q = POINTS[b];
  return [p[0], p[1], q[0], q[1]];
}

/** Orden del trazo: abajo → arriba. */
const SEGMENTS: ReadonlyArray<readonly [number, number, number, number]> = [
  seg("E", "I"),
  seg("D", "I"),
  seg("I", "F"),
  seg("D", "E"),
  seg("E", "F"),
  seg("C", "E"),
  seg("G", "E"),
  seg("C", "D"),
  seg("G", "F"),
  seg("C", "G"),
  seg("B", "C"),
  seg("G", "H"),
  seg("C", "A"),
  seg("A", "G"),
  seg("B", "D"),
  seg("F", "H"),
  seg("A", "B"),
  seg("H", "A"),
];

function segmentLength([x1, y1, x2, y2]: readonly [number, number, number, number]): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

const SEGMENT_LENGTHS = SEGMENTS.map(segmentLength);
const WIRE_TOTAL_LENGTH = SEGMENT_LENGTHS.reduce((a, b) => a + b, 0);

/** Cuánto de cada arista está “dibujado” según progreso global [0, total]. */
function litPortions(progress: number): number[] {
  let budget = Math.max(0, Math.min(1, progress)) * WIRE_TOTAL_LENGTH;
  return SEGMENT_LENGTHS.map((L) => {
    if (budget <= 0) return 0;
    if (budget >= L) {
      budget -= L;
      return L;
    }
    const v = budget;
    budget = 0;
    return v;
  });
}

type D20LoadingOverlayProps = {
  progress: number;
};

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

export function D20LoadingOverlay({ progress }: D20LoadingOverlayProps) {
  const p = clampProgress(progress);
  const portions = litPortions(p);

  return (
    <div
      className="d20-loader"
      role="status"
      aria-live="polite"
      aria-label={`Cargando mesa ${Math.round(p * 100)} por ciento`}
    >
      <div className="d20-loader__svg-wrap">
        <svg className="d20-loader__svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <title>d20</title>
          {/* Silueta tenue: todas las aristas */}
          <g className="d20-loader__wire-dim">
            {SEGMENTS.map(([x1, y1, x2, y2], index) => (
              <line
                key={`dim-${index}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={STROKE_DIM}
                strokeWidth={STROKE_WIDTH}
                strokeLinecap="butt"
                strokeLinejoin="miter"
                strokeOpacity={0.22}
              />
            ))}
          </g>
          {/* Trazo cargado: por arista, revelado parcial solo donde corresponde */}
          <g className="d20-loader__wire-lit">
            {SEGMENTS.map(([x1, y1, x2, y2], index) => {
              const L = SEGMENT_LENGTHS[index];
              const lit = portions[index];
              if (lit <= 0) return null;

              const common = {
                x1,
                y1,
                x2,
                y2,
                stroke: STROKE_LIT,
                strokeWidth: STROKE_WIDTH,
                strokeLinecap: "butt" as const,
                strokeLinejoin: "miter" as const,
              };

              if (lit >= L - 1e-9) {
                return <line key={`lit-${index}`} {...common} />;
              }

              return (
                <line
                  key={`lit-${index}`}
                  {...common}
                  strokeDasharray={`${L} ${L}`}
                  strokeDashoffset={L - lit}
                />
              );
            })}
          </g>
        </svg>
      </div>
      <p className="d20-loader__label">Sincronizando mesa… {Math.round(p * 100)}%</p>
    </div>
  );
}
