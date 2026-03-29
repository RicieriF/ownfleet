/**
 * Pulse skeleton shown while waiting for the first API response.
 * No text, no spinner — looks like "something is about to appear".
 */
export function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4 animate-pulse">
      {/* Header bar */}
      <div className="h-5 w-1/2 rounded bg-gray-200" />
      {/* Body lines */}
      <div className="h-4 w-3/4 rounded bg-gray-200" />
      <div className="h-4 w-2/3 rounded bg-gray-200" />
      {/* Map placeholder */}
      <div className="h-48 rounded-lg bg-gray-200 mt-2" />
    </div>
  );
}
