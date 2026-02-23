// ─── Auth-Middleware ──────────────────────────────────────────────────────
// Prüft JWT-Token und setzt req.user

import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { verifyToken, JwtPayload } from '../services/auth.service';

// Express Request-Type erweitern
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Middleware: Prüft ob ein gültiger JWT-Token vorhanden ist.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Nicht authentifiziert – Bearer Token fehlt' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Ungültiger oder abgelaufener Token' });
  }
}

/**
 * Middleware-Factory: Prüft ob der Benutzer eine bestimmte Rolle hat.
 */
export function authorize(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Nicht authentifiziert' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Keine Berechtigung für diese Aktion' });
      return;
    }

    next();
  };
}
