// Venue dressing sets (4D): each venue id maps to the builder that dresses it.
import { buildProvingGroundsDressing, Dressing, DressingContext } from './provingGrounds';
import { buildHanagiriDressing } from '../hanagiri/dressing';

export type { Dressing, DressingContext, CarDot } from './provingGrounds';

export const DRESSINGS: Record<string, (ctx: DressingContext) => Dressing> = {
  'proving-grounds': buildProvingGroundsDressing,
  'hanagiri-pass': buildHanagiriDressing,
};
