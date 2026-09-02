let shuttingDown = false;

export function markReadinessShuttingDown(): void {
  shuttingDown = true;
}

export function isReadinessShuttingDown(): boolean {
  return shuttingDown;
}
