import { MonitorIcon, MoonIcon, SunIcon } from '@phosphor-icons/react';

import { useTheme } from '@/components/theme-provider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

/**
 * Light, dark or the device's choice: the one appearance that is each
 * person's rather than the workspace's. A ToggleGroup rather than three
 * buttons with hand-managed pressed state: three mutually exclusive
 * options is exactly what it is for, and it carries the radio semantics
 * and arrow-key movement for free.
 *
 * The guard on an empty selection matters -- Base UI reports the group
 * value as an array and will hand back an empty one if the pressed item is
 * pressed again. There is no such thing as "no theme", so that deselect is
 * ignored. Used by the account sheet and the profile.
 */
export function ThemeToggleGroup({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <ToggleGroup
      variant="outline"
      className={className ?? 'w-full'}
      value={[theme]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === 'light' || next === 'dark' || next === 'system') setTheme(next);
      }}
    >
      <ToggleGroupItem value="light" className="min-h-11 flex-1">
        <SunIcon />
        Light
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" className="min-h-11 flex-1">
        <MoonIcon />
        Dark
      </ToggleGroupItem>
      <ToggleGroupItem value="system" className="min-h-11 flex-1">
        <MonitorIcon />
        System
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
