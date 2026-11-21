export async function connectSse(base, headers = {}) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/notifications`, { headers, signal: controller.signal });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  async function readFrame() {
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) === -1) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('SSE stream closed before the expected event');
      buffer += decoder.decode(chunk.value, { stream: true });
    }
    const lines = buffer.slice(0, boundary).split('\n');
    buffer = buffer.slice(boundary + 2);
    return lines;
  }
  return {
    response,
    async next(event = 'notification') {
      const deadline = setTimeout(() => controller.abort(), 5000);
      try {
        let lines = await readFrame();
        while (!lines.includes(`event: ${event}`)) lines = await readFrame();
        return {
          id: lines.find((line) => line.startsWith('id: '))?.slice(4),
          data: JSON.parse(lines.find((line) => line.startsWith('data: ')).slice(6))
        };
      } finally {
        clearTimeout(deadline);
      }
    },
    async close() {
      controller.abort();
      await reader.cancel().catch(() => {});
    }
  };
}
