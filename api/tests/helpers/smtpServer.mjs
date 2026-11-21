import { createServer } from 'node:net';
import { once } from 'node:events';

// A local SMTP fixture: reject DATA temporarily, then accept it after recovery.
export async function createSmtpServer({ failures = 0 } = {}) {
  const attempts = [];
  const accepted = [];
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', (error) => {
      // Process-restart tests deliberately close connections during teardown.
      if (!['ECONNRESET', 'EPIPE'].includes(error.code)) server.emit('error', error);
    });
    let buffer = '';
    let body = null;
    socket.write('220 localhost SMTP test server\r\n');

    function handleLine(line) {
      if (body !== null) {
        if (line !== '.') return body.push(line);
        const message = body.join('\r\n');
        body = null;
        attempts.push(message);
        if (failures > 0) {
          failures -= 1;
          return socket.write('451 4.3.0 Temporary SMTP failure\r\n');
        }
        accepted.push(message);
        return socket.write('250 2.0.0 Accepted\r\n');
      }
      if (line.toUpperCase() === 'DATA') {
        body = [];
        return socket.write('354 End with a dot\r\n');
      }
      if (line.toUpperCase() === 'QUIT') return socket.end('221 Bye\r\n');
      socket.write('250 OK\r\n');
    }

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        handleLine(line);
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: server.address().port, attempts, accepted,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}
