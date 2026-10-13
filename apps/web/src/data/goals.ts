import { periodEnd, periodStart, sumMetric, uuidv7, type ActivityLite, type GoalMetric, type GoalPeriod } from '@trazo/core';
import { userDb, type StoredGoal } from './db';

export interface GoalView {
  id: string;
  period: GoalPeriod;
  metric: GoalMetric;
  sport: string | null;
  target: number;
  value: number;
  progress: number;
  periodStart: string;
  periodEnd: string;
}

/** Calcula el progreso de cada objetivo con las actividades del periodo en curso. */
export function goalProgress(goals: StoredGoal[], acts: ActivityLite[]): GoalView[] {
  return goals.map((g) => {
    const start = periodStart(g.period);
    const end = periodEnd(g.period, start);
    const value = sumMetric(acts, g.metric, g.sport, start, end);
    return {
      id: g.id,
      period: g.period,
      metric: g.metric,
      sport: g.sport,
      target: g.target,
      value,
      progress: g.target > 0 ? Math.min(1, value / g.target) : 0,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
    };
  });
}

export async function addGoal(input: { period: GoalPeriod; metric: GoalMetric; target: number; sport: string | null }) {
  const goal: StoredGoal = { id: uuidv7(), createdAt: new Date().toISOString(), ...input };
  await userDb().goals.put(goal);
  return goal;
}

export async function deleteGoal(id: string) {
  await userDb().goals.delete(id);
}
