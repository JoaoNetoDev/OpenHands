import { InputSkeleton } from "../input-skeleton";

export function SystemSettingsInputsSkeleton() {
  return (
    <div
      data-testid="system-settings-skeleton"
      className="px-11 py-9 flex flex-col gap-6"
    >
      <InputSkeleton />
      <InputSkeleton />
      <InputSkeleton />
    </div>
  );
}
