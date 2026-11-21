import { subscribeNotifications } from '../services/notificationsService.mjs';

export function streamNotifications(req, res) {
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  let closed = false;
  let unsubscribe = () => {};
  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  }
  function write(frame) {
    if (closed) return;
    try {
      // A slow client must reconnect rather than accumulate an unbounded queue.
      if (!res.write(frame)) {
        cleanup();
        res.end();
      }
    } catch {
      cleanup();
      res.destroy();
    }
  }
  res.on('close', cleanup);
  unsubscribe = subscribeNotifications((notification) => {
    write(`id: ${notification.id}\nevent: notification\ndata: ${JSON.stringify(notification)}\n\n`);
  });
  const heartbeat = setInterval(() => write(': heartbeat\n\n'), 15000);
  heartbeat.unref();
  // No history replay: opening/reopening the stream triggers a fresh REST read.
  write('retry: 3000\nevent: ready\ndata: {}\n\n');
}
