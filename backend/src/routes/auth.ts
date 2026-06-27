import { FastifyInstance } from "fastify";
import { Keypair } from "@stellar/stellar-sdk";
import { getDb } from "../lib/db";

export default async function authRoutes(server: FastifyInstance) {
  
  server.post("/login", async (request, reply) => {
    const { publicKey, signature, message } = request.body as {
      publicKey: string;
      signature: string;
      message: string;
    };

    if (!publicKey || !signature || !message) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    // Verify signature
    try {
      const kp = Keypair.fromPublicKey(publicKey);
      const signatureBuffer = Buffer.from(signature, "base64");
      const isValid = kp.verify(Buffer.from(message), signatureBuffer);

      if (!isValid) {
        return reply.status(401).send({ error: "Invalid signature" });
      }
    } catch (err) {
      return reply.status(400).send({ error: "Invalid public key or signature format" });
    }

    const sql = getDb();
    
    // Check if user exists, or create them
    let users = await sql`SELECT id, "publicKey" FROM "User" WHERE "publicKey" = ${publicKey}`;
    let user;

    if (users.length === 0) {
      users = await sql`
        INSERT INTO "User" (id, "publicKey", "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), ${publicKey}, NOW(), NOW())
        RETURNING id, "publicKey"
      `;
    }
    user = users[0];

    // Generate JWT
    const token = server.jwt.sign({ id: user.id, publicKey: user.publicKey }, { expiresIn: "7d" });

    // Set cookie
    reply.setCookie("session", token, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return reply.send({ success: true, user });
  });

  server.post("/logout", async (request, reply) => {
    reply.setCookie("session", "", {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 0,
    });
    return reply.send({ success: true });
  });
}
