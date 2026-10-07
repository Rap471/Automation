export function sanitizeFileName(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return (cleaned || "game").slice(0, 80);
}

export function spinFolder(spinNumber: number): string {
  return `spin-${String(spinNumber).padStart(3, "0")}`;
}
