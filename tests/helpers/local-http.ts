import { createServer, RequestListener } from "http";
import { AddressInfo, Socket } from "net";
export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const localHTTP = async (handler: RequestListener) => {
  const sockets = new Set<Socket>();
  const server = createServer(handler);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  // IPv6 loopback isolates fixtures from development IPv4 proxy/port rules.
  const host = "::1";
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  return {
    server,
    sockets,
    url: `http://[${host}]:${(server.address() as AddressInfo).port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};
