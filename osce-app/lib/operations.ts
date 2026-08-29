type Context = Record<string, string | number | boolean | null | undefined>;

export function logOperationalError(category: string, error: unknown, context: Context = {}) {
  console.error(JSON.stringify({
    level: 'error',
    category,
    errorType: error instanceof Error ? error.name : 'UnknownError',
    ...context,
    timestamp: new Date().toISOString(),
  }));
}
