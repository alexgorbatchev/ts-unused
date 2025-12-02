// Test cases for enum return types
export enum Status {
  Idle = 0,
  Running = 1,
  Success = 2,
  Error = 3,
  Warning = 4,
}

export enum Platform {
  None = 0,
  Linux = 1 << 0,
  MacOS = 1 << 1,
  Windows = 1 << 2,
  Unix = Platform.Linux | Platform.MacOS,
  All = Platform.Linux | Platform.MacOS | Platform.Windows,
}

// This function returns some Status values but not all
// Should NOT be flagged for never-returned types since it returns an enum
export function getStatus(): Status {
  const rand = Math.random();
  if (rand > 0.5) return Status.Success;
  return Status.Error;
  // Status.Idle, Status.Running, Status.Warning are never returned
  // But since Status is an enum and we return at least one value, this should be OK
}

// This function returns some Platform enum values
// Should NOT be flagged for never-returned types
export function detectPlatform(platform: string): Platform {
  if (platform === "darwin") return Platform.MacOS;
  if (platform === "linux") return Platform.Linux;
  if (platform === "win32") return Platform.Windows;
  return Platform.None;
  // Platform.Unix and Platform.All are never returned, but should be OK
}

// This function returns enum OR null
// Should flag null as never returned, but NOT the enum values
export function getStatusOrNull(): Status | null {
  return Status.Success;
  // null is never returned - should be flagged
  // Status.Error, etc. not returned - should NOT be flagged (enum rule)
}

// This function returns enum OR string
// Should flag string literal as never returned
export function getStatusOrError(): Status | "unknown" {
  return Status.Error;
  // "unknown" is never returned - should be flagged
  // Other Status values not returned - should NOT be flagged (enum rule)
}
