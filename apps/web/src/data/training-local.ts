import { userDb } from './db';

export interface Enrollment {
  key: string;
  /** YYYY-MM-DD */
  startDate: string;
}

export async function getEnrollment(): Promise<Enrollment | null> {
  return ((await userDb().kv.get('plan'))?.value as Enrollment | undefined) ?? null;
}

export async function enrollPlan(key: string, startDate: string) {
  await userDb().kv.put({ key: 'plan', value: { key, startDate } satisfies Enrollment });
}

export async function leavePlan() {
  await userDb().kv.delete('plan');
}
