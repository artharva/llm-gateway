/** Replaces global fetch for one test with canned responses, and records the requests. */
export function mockFetch(responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const original = global.fetch;
  global.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error('mockFetch: no more responses');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return {
    calls,
    body: (i = 0) => JSON.parse(String(calls[i]?.init.body)) as Record<string, unknown>,
    restore: () => {
      global.fetch = original;
    },
  };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
