export interface Manifest {
  path(key: string): string;
}

export function createManifest(data: Record<string, string>, prefix: string): Manifest {
  const base = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return {
    path(key: string): string {
      const lookup = key.startsWith("/") ? key.slice(1) : key;
      const mapped = data[lookup];
      const resolved = mapped ?? lookup;
      return `${base}/${resolved}`;
    },
  };
}
