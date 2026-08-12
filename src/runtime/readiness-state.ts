let shuttingDown = false;

export function markReadinessShuttingDown(): void {
  shuttingDown = true;
}

export function resetReadinessStateForTest(): void {
  shuttingDown = false;
}

export function isReadinessShuttingDown(): boolean {
  return shuttingDown;
}
