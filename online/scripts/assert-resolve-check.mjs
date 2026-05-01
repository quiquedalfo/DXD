/**
 * Pruebas puras de dominio (sin red): `resolveCheck` alineado a `submit_check_response` en Postgres.
 * Ejecutar: `npm run test:resolve-check` (compila @dxd/shared antes).
 */
import assert from "node:assert/strict";
import { resolveCheck } from "../packages/shared/dist/domain/resolveCheck.js";

function runOnce(label) {
  const base = {
    dieSize: 20,
    rollValue: 8,
    tokensSpent: 1,
    modifierApplied: 2,
    targetCheckValue: 10,
  };

  const r = resolveCheck({ ...base, explosionRule: "spec_roll_gte_die_size" });
  assert.equal(r.computedTotal, 11);
  assert.equal(r.outcome, "pass");
  assert.equal(r.margin, 1);
  assert.equal(r.explosionFlag, false);

  const fail = resolveCheck({
    ...base,
    modifierApplied: 0,
    explosionRule: "spec_roll_gte_die_size",
  });
  assert.equal(fail.outcome, "fail");
  assert.equal(fail.margin, -1);

  const maxEdge = resolveCheck({
    dieSize: 20,
    rollValue: 20,
    tokensSpent: 0,
    modifierApplied: 0,
    targetCheckValue: 20,
    explosionRule: "spec_roll_gte_die_size",
  });
  assert.equal(maxEdge.explosionFlag, true);

  const desk = resolveCheck({
    dieSize: 20,
    rollValue: 19,
    tokensSpent: 1,
    modifierApplied: 0,
    targetCheckValue: 30,
    explosionRule: "desktop_roll_plus_tokens_eq_max",
  });
  assert.equal(desk.explosionFlag, true);

  console.log(`assert-resolve-check [${label}]: OK`);
}

for (const pass of [1, 2]) {
  runOnce(`pasada ${pass}`);
}
