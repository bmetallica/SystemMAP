// ─── Auth-Service ────────────────────────────────────────────────────────
// JWT-basierte Authentifizierung mit bcrypt-Password-Hashing

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient, UserRole } from '@prisma/client';
import { config } from '../config';

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

export interface JwtPayload {
  userId: string;
  email: string;
  username: string;
  role: UserRole;
}

export interface AuthResult {
  token: string;
  user: {
    id: string;
    email: string;
    username: string;
    role: UserRole;
  };
}

/**
 * Erstellt einen neuen Benutzer.
 */
export async function registerUser(
  email: string,
  username: string,
  password: string,
  role: UserRole = UserRole.VIEWER
): Promise<AuthResult> {
  // Prüfen ob User existiert
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  });
  if (existing) {
    throw new Error('E-Mail oder Benutzername bereits vergeben');
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: { email, username, password: hashedPassword, role },
  });

  const token = generateToken(user);
  return {
    token,
    user: { id: user.id, email: user.email, username: user.username, role: user.role },
  };
}

/**
 * Authentifiziert einen Benutzer mit E-Mail/Username und Passwort.
 */
export async function loginUser(login: string, password: string): Promise<AuthResult> {
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: login }, { username: login }] },
  });

  if (!user) {
    throw new Error('Ungültige Anmeldedaten');
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    throw new Error('Ungültige Anmeldedaten');
  }

  const token = generateToken(user);
  return {
    token,
    user: { id: user.id, email: user.email, username: user.username, role: user.role },
  };
}

/**
 * Generiert einen JWT-Token.
 */
function generateToken(user: { id: string; email: string; username: string; role: UserRole }): string {
  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
  };

  return jwt.sign(payload, config.jwt.secret as jwt.Secret, {
    expiresIn: config.jwt.expiresIn,
  } as jwt.SignOptions);
}

/**
 * Verifiziert einen JWT-Token.
 */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwt.secret) as JwtPayload;
}
