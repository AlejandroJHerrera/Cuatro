/**
 * Passport setup — only Google's strategy is registered here. Email/password
 * is handled directly in routes (no passport-local; bcrypt + a session write
 * is simpler and avoids a dependency).
 *
 * Sessions store only the user id; the full user is hydrated per-request in
 * deserializeUser via Prisma.
 */
import passport from "passport";
import { Strategy as GoogleStrategy, type Profile } from "passport-google-oauth20";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { AuthProvider, type User } from "@prisma/client";

passport.serializeUser<string>((user, done) => {
  done(null, (user as User).id);
});

passport.deserializeUser<string>(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user ?? false);
  } catch (err) {
    done(err as Error);
  }
});

export const googleStrategyConfigured =
  !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET;

if (googleStrategyConfigured) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID!,
        clientSecret: env.GOOGLE_CLIENT_SECRET!,
        callbackURL: `${env.BACKEND_URL}/api/auth/google/callback`,
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: Profile,
        done: (err: Error | null, user?: User | false) => void,
      ) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase();
          if (!email) {
            return done(new Error("Google profile is missing an email."));
          }
          // Find by Google id first, then by email (link existing accounts).
          const byProvider = await prisma.user.findUnique({
            where: { provider_providerId: { provider: AuthProvider.google, providerId: profile.id } },
          });
          if (byProvider) return done(null, byProvider);

          const existing = await prisma.user.findUnique({ where: { email } });
          if (existing) {
            const updated = await prisma.user.update({
              where: { id: existing.id },
              data: {
                provider: AuthProvider.google,
                providerId: profile.id,
                name: existing.name ?? profile.displayName ?? null,
                avatarUrl: existing.avatarUrl ?? profile.photos?.[0]?.value ?? null,
              },
            });
            return done(null, updated);
          }

          const created = await prisma.user.create({
            data: {
              email,
              name: profile.displayName ?? null,
              avatarUrl: profile.photos?.[0]?.value ?? null,
              provider: AuthProvider.google,
              providerId: profile.id,
            },
          });
          return done(null, created);
        } catch (err) {
          return done(err as Error);
        }
      },
    ),
  );
}

export { passport };
