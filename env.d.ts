// Declare globals for Deno runtime
declare var Deno: {
    statSync(path: string): { size: number; mtime: Date | null };
    stat(path: string): Promise<{ size: number; mtime: Date | null }>;
    readTextFile(path: string): Promise<string>;
    readFile(path: string): Promise<Uint8Array>;
    readFileSync(path: string): Uint8Array;
};
