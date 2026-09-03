import { AuthProvider, type Prisma, type User } from "@prisma/client";
import { prisma } from "./prisma";
import { AppError } from "../middleware/errorHandler";

/**
 * Identity resolution for every sign-in path.
 *
 * One human maps to exactly one `User` row. A provider identity is matched
 * first by its own provider id, then linked onto an existing account by
 * verified email, and only otherwise creates a new account. This is what keeps
 * phone / Google / Apple / Facebook from producing duplicate users.
 */

export type SocialIdentity = {
  email: string | null;
  name: string;
  givenName: string;
};

function nameFallback(email: string | null): string {
  return email?.split("@")[0] || "Guest";
}

async function linkOrCreate(
  where: Prisma.UserWhereUniqueInput,
  identity: SocialIdentity,
  provider: AuthProvider,
  link: Prisma.UserUpdateInput & Prisma.UserCreateInput,
): Promise<User> {
  const existing = await prisma.user.findUnique({ where });
  if (existing) return existing;

  // Verified email from the provider is a safe join key onto an existing user.
  if (identity.email) {
    const byEmail = await prisma.user.findUnique({
      where: { email: identity.email },
    });
    if (byEmail) {
      return prisma.user.update({
        where: { id: byEmail.id },
        data: {
          ...link,
          firstName: byEmail.firstName || identity.givenName,
          fullName: byEmail.fullName || identity.name,
        },
      });
    }
  }

  return prisma.user.create({
    data: {
      ...link,
      email: identity.email,
      authProvider: provider,
      firstName: identity.givenName,
      fullName: identity.name,
    },
  });
}

export function findOrCreateGoogleUser(input: SocialIdentity & { googleId: string }) {
  return linkOrCreate(
    { googleId: input.googleId },
    input,
    AuthProvider.GOOGLE,
    { googleId: input.googleId } as Prisma.UserUpdateInput & Prisma.UserCreateInput,
  );
}

export function findOrCreateAppleUser(input: SocialIdentity & { appleId: string }) {
  return linkOrCreate(
    { appleId: input.appleId },
    input,
    AuthProvider.APPLE,
    { appleId: input.appleId } as Prisma.UserUpdateInput & Prisma.UserCreateInput,
  );
}

export function findOrCreateFacebookUser(
  input: SocialIdentity & { facebookId: string },
) {
  return linkOrCreate(
    { facebookId: input.facebookId },
    input,
    AuthProvider.FACEBOOK,
    { facebookId: input.facebookId } as Prisma.UserUpdateInput &
      Prisma.UserCreateInput,
  );
}

/** Phone is verified by OTP, so it is authoritative on its own. */
export async function findOrCreatePhoneUser(e164: string): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { phone: e164 } });
  if (existing) return existing;

  return prisma.user.create({
    data: {
      phone: e164,
      authProvider: AuthProvider.PHONE,
      firstName: "Guest",
      fullName: "Guest",
    },
  });
}

export async function findOrCreateEmailUser(email: string): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;

  const hint = nameFallback(email);
  return prisma.user.create({
    data: {
      email,
      authProvider: AuthProvider.EMAIL,
      firstName: hint,
      fullName: hint,
    },
  });
}

export type PublicUser = ReturnType<typeof publicUser>;

/** The only user shape sent to clients. Never leaks provider ids or tokens. */
export function publicUser(user: User) {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    fullName: user.fullName,
    dateOfBirth: user.dateOfBirth
      ? user.dateOfBirth.toISOString().slice(0, 10)
      : null,
    gender: user.gender,
    socialEnergy: user.socialEnergy,
    interests: user.interests,
    verificationStatus: user.verificationStatus,
    isAgeVerified: user.isAgeVerified,
    attendanceCount: user.attendanceCount,
    currentStreak: user.currentStreak,
    authProvider: user.authProvider,
    /** Which sign-in methods are attached, so the client can offer linking. */
    linkedProviders: {
      phone: Boolean(user.phone),
      email: Boolean(user.email),
      google: Boolean(user.googleId),
      apple: Boolean(user.appleId),
      facebook: Boolean(user.facebookId),
    },
  };
}

export function parseDob(value: string): Date {
  const iso = Date.parse(value);
  if (!Number.isNaN(iso)) return new Date(iso);

  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value.trim());
  if (!match) throw new AppError("dateOfBirth must be ISO or dd-mm-yyyy");

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new AppError("Invalid date of birth");
  }
  return date;
}

export function ageFromDob(dob: Date): number {
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const months = now.getUTCMonth() - dob.getUTCMonth();
  if (months < 0 || (months === 0 && now.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}
