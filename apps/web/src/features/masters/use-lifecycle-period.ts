import { useSearchParams } from 'react-router';

import { toDateParam } from '@/features/attendance/format';

import { readLifecyclePeriod, type LifecyclePeriod } from './lifecycle-period';

/** The period and comparison the URL carries, defaulting to the financial year to date. */
export function useLifecyclePeriod(): LifecyclePeriod {
  const [searchParams] = useSearchParams();
  return readLifecyclePeriod(searchParams, toDateParam(new Date()));
}
