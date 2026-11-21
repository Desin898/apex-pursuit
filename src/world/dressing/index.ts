// Venue dressing sets (4D): each venue id maps to the builder that dresses it.
// Phase 5's mountain pass adds its own entry here.
import { buildProvingGroundsDressing, Dressing, DressingContext } from './provingGrounds';

export type { Dressing, DressingContext, CarDot } from './provingGrounds';

export const DRESSINGS: Record<string, (ctx: DressingContext) => Dressing> = {
  'proving-grounds': buildProvingGroundsDressing,
};
