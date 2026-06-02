import type { User as PrismaUser } from "@prisma/client";

declare global {
  namespace Express {
    // Passport assigns the deserialized user here.
    interface User extends PrismaUser {}
  }
}

export {};
