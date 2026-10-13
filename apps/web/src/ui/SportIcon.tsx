import { getSport } from '@trazo/core';
import { Bike, Dumbbell, Footprints, Mountain, PersonStanding, TentTree, Waves, type LucideIcon } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  footprints: Footprints,
  mountain: Mountain,
  bike: Bike,
  'person-standing': PersonStanding,
  'tent-tree': TentTree,
  waves: Waves,
  dumbbell: Dumbbell,
};

export function sportIcon(sport: string): LucideIcon {
  return ICONS[getSport(sport).icon] ?? Dumbbell;
}

export function SportIcon({ sport, size = 18 }: { sport: string; size?: number }) {
  const Icon = sportIcon(sport);
  return <Icon width={size} height={size} aria-label={getSport(sport).label} />;
}
