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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    sockets,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};
