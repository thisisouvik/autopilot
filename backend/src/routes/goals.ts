import { FastifyInstance } from "fastify";
import { verifyAuth } from "../middleware/auth";
import { getDb } from "../lib/db";

export default async function goalsRoutes(server: FastifyInstance) {
  server.addHook("onRequest", verifyAuth);

  server.get("/", async (request, reply) => {
    // Basic mock/placeholder for goals
    return reply.send([]);
  });

  server.post("/", async (request, reply) => {
    return reply.send({ success: true });
  });

  server.patch("/:id", async (request, reply) => {
    return reply.send({ success: true });
  });

  server.delete("/:id", async (request, reply) => {
    return reply.send({ success: true });
  });
}
