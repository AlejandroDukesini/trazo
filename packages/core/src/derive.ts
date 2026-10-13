import { computeStats, estimateCalories, type ActivityStats } from './metrics.js';
import type { Stream } from './schemas.js';
import { edwardsTrimp, hrZones, srpeLoad, timeInZones } from './training.js';

export interface Physio {
  weightKg: number | null | undefined;
  hrMax: number | null | undefined;
}

export interface ManualValues {
  elapsedS: number;
  distanceM?: number;
  movingS?: number;
  elevGainM?: number;
}

export interface DerivedActivity {
  stats: ActivityStats | null;
  timerS: number;
  movingS: number;
  distanceM: number;
  elevGainM: number | null;
  avgSpeed: number;
  /** Estimación (MET × peso). null sin peso conocido. */
  calories: number | null;
  /** TRIMP de Edwards con FC y FCmáx; si no, sRPE con esfuerzo percibido; si no, null. */
  trainingLoad: number | null;
}

/**
 * Campos derivados de una actividad. Única implementación compartida por el cliente
 * (valores provisionales offline) y el servidor (valores definitivos).
 */
export function deriveActivity(stream: Stream | null, sport: string, lapMarks: number[], rpe: number | null | undefined, physio: Physio, manual: ManualValues): DerivedActivity {
  if (!stream || stream.t.length < 2) {
    const movingS = manual.movingS ?? manual.elapsedS;
    const distanceM = manual.distanceM ?? 0;
    return {
      stats: null,
      timerS: manual.elapsedS,
      movingS,
      distanceM,
      elevGainM: manual.elevGainM ?? null,
      avgSpeed: movingS > 0 ? distanceM / movingS : 0,
      calories: estimateCalories(sport, movingS, distanceM, physio.weightKg),
      trainingLoad: rpe ? srpeLoad(movingS, rpe) : null,
    };
  }
  const st = computeStats(stream, sport, { lapMarks });
  let load: number | null = null;
  if (stream.hr && physio.hrMax) load = edwardsTrimp(timeInZones(stream.t, stream.hr, hrZones(physio.hrMax), stream.seg));
  else if (rpe) load = srpeLoad(st.movingS, rpe);
  return {
    stats: st,
    timerS: st.timerS,
    movingS: st.movingS,
    distanceM: st.distanceM,
    elevGainM: st.elevGainM,
    avgSpeed: st.avgSpeed,
    calories: estimateCalories(sport, st.movingS, st.distanceM, physio.weightKg),
    trainingLoad: load,
  };
}
