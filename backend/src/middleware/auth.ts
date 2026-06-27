import { FastifyReply, FastifyRequest } from "fastify";

export async function verifyAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: "Unauthorized" });
  }
}
