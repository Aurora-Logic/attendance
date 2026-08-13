import type { DateRange } from 'react-day-picker';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { humaniseEnum } from '@/lib/format';
import {
  ATTENDANCE_FLAGS,
  ATTENDANCE_STATUSES,
  PUNCH_TYPES,
  type ReportFilterName,
} from '@vyuha/shared';

// The date pickers are shadcn Calendar/Popover/Sheet compositions living in the
// attendance feature; their own file says they belong in components/shared and
// are there only because that directory was locked while several screens were
// being built in parallel. Reusing them beats a second copy of the same
// composition, which is exactly what CLAUDE.md §3 asks for.
import { DateRangeField } from '@/features/attendance/pickers';

/**
 * REQ-J-01's filter bar: date range, location, department, employee, status,
 * flags -- and the punch direction, which the audit report needs and the
 * register has no use for.
 *
 * Which controls appear is driven by the report's own `filters` list, served
 * by the API. A report that cannot filter by status does not render a status
 * control that quietly does nothing.
 */

const ALL = 'ALL';

export interface ReportFilterState {
  readonly period: DateRange;
  readonly departmentId: string | null;
  readonly locationId: string | null;
  readonly employeeId: string | null;
  readonly status: string | null;
  readonly flags: string | null;
  readonly punchType: string | null;
}

interface Option {
  readonly id: string;
  readonly name: string;
}

interface FilterBarProps {
  available: readonly ReportFilterName[];
  value: ReportFilterState;
  onChange: (patch: Partial<ReportFilterState>) => void;
  departments: readonly Option[];
  locations: readonly Option[];
  periodOpen: boolean;
  onPeriodOpenChange: (open: boolean) => void;
  onClear: () => void;
  isFiltered: boolean;
}

function OptionSelect({
  label,
  value,
  placeholder,
  options,
  onValueChange,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  options: readonly Option[];
  onValueChange: (next: string | null) => void;
}) {
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next: string | null) => {
        onValueChange(next === null || next === ALL ? null : next);
      }}
    >
      <SelectTrigger aria-label={label} className="pointer-coarse:h-11 w-full sm:w-44">
        <SelectValue>
          {(current: string) =>
            options.find((option) => option.id === current)?.name ?? placeholder
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={ALL}>{placeholder}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function ReportFilterBar({
  available,
  value,
  onChange,
  departments,
  locations,
  periodOpen,
  onPeriodOpenChange,
  onClear,
  isFiltered,
}: FilterBarProps) {
  const shows = (name: ReportFilterName) => available.includes(name);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {shows('period') ? (
        <DateRangeField
          label="Report period"
          value={value.period}
          onValueChange={(next) => {
            onChange({ period: next });
          }}
          open={periodOpen}
          onOpenChange={onPeriodOpenChange}
          className="w-full sm:w-auto"
          hint={<ShortcutHint keys="alt+f2" className="ml-1 hidden md:inline-flex" />}
        />
      ) : null}

      {shows('departmentId') ? (
        <OptionSelect
          label="Filter by department"
          placeholder={departments.length === 0 ? 'No departments' : 'All departments'}
          options={departments}
          value={value.departmentId}
          onValueChange={(next) => {
            onChange({ departmentId: next });
          }}
        />
      ) : null}

      {shows('locationId') ? (
        <OptionSelect
          label="Filter by location"
          placeholder={locations.length === 0 ? 'No locations' : 'All locations'}
          options={locations}
          value={value.locationId}
          onValueChange={(next) => {
            onChange({ locationId: next });
          }}
        />
      ) : null}

      {shows('status') ? (
        <Select
          value={value.status ?? ALL}
          onValueChange={(next: string | null) => {
            onChange({ status: next === null || next === ALL ? null : next });
          }}
        >
          <SelectTrigger aria-label="Filter by status" className="pointer-coarse:h-11 w-full sm:w-40">
            <SelectValue>
              {(current: string) => (current === ALL ? 'All statuses' : humaniseEnum(current))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {ATTENDANCE_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {humaniseEnum(status)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : null}

      {shows('flags') ? (
        <Select
          value={value.flags ?? ALL}
          onValueChange={(next: string | null) => {
            onChange({ flags: next === null || next === ALL ? null : next });
          }}
        >
          <SelectTrigger aria-label="Filter by flag" className="pointer-coarse:h-11 w-full sm:w-40">
            <SelectValue>
              {(current: string) => (current === ALL ? 'All flags' : humaniseEnum(current))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>All flags</SelectItem>
              {ATTENDANCE_FLAGS.map((flag) => (
                <SelectItem key={flag} value={flag}>
                  {humaniseEnum(flag)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : null}

      {shows('punchType') ? (
        <Select
          value={value.punchType ?? ALL}
          onValueChange={(next: string | null) => {
            onChange({ punchType: next === null || next === ALL ? null : next });
          }}
        >
          <SelectTrigger
            aria-label="Filter by direction"
            className="pointer-coarse:h-11 w-full sm:w-36"
          >
            <SelectValue>
              {(current: string) => (current === ALL ? 'In and out' : humaniseEnum(current))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>In and out</SelectItem>
              {PUNCH_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {humaniseEnum(type)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : null}

      {isFiltered ? (
        <Button variant="ghost" size="sm" onClick={onClear}>
          <ACTION_ICONS.clearFilters data-icon="inline-start" />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
