// ─── Auth Routes ─────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { registerUser, loginUser } from '../services/auth.service';
import { authenticate } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import { logger } from '../logger';

const router = Router();

// ─── POST /api/auth/register ──────────────────────────────────────────────
router.post(
  '/register',
  [
    body('email').isEmail().withMessage('Gültige E-Mail-Adresse erforderlich'),
    body('username').isLength({ min: 3, max: 30 }).withMessage('Benutzername: 3-30 Zeichen'),
    body('password').isLength({ min: 8 }).withMessage('Passwort: mindestens 8 Zeichen'),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const { email, username, password, role } = req.body;
      const result = await registerUser(email, username, password, role);
      res.status(201).json(result);
    } catch (err: any) {
      res.status(409).json({ error: err.message });
    }
  }
);

// ─── POST /api/auth/login ─────────────────────────────────────────────────
router.post(
  '/login',
  [
    body('login').notEmpty().withMessage('E-Mail oder Benutzername erforderlich'),
    body('password').notEmpty().withMessage('Passwort erforderlich'),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const { login, password } = req.body;
      const result = await loginUser(login, password);
      res.json(result);
    } catch (err: any) {
      res.status(401).json({ error: err.message });
    }
  }
);

// ─── GET /api/auth/me ─────────────────────────────────────────────────────
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, email: true, username: true, role: true, createdAt: true },
    });
    if (!user) {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return;
    }
    res.json(user);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/auth/me ─────────────────────────────────────────────────────
// Eigenes Profil aktualisieren (E-Mail, Benutzername)
router.put(
  '/me',
  authenticate,
  [
    body('email').optional().isEmail().withMessage('Gültige E-Mail-Adresse erforderlich'),
    body('username').optional().isLength({ min: 3, max: 30 }).withMessage('Benutzername: 3-30 Zeichen'),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const { email, username } = req.body;
      const data: any = {};
      if (email) data.email = email;
      if (username) data.username = username;

      if (Object.keys(data).length === 0) {
        res.status(400).json({ error: 'Keine Änderungen angegeben' });
        return;
      }

      // Eindeutigkeitsprüfung
      if (email || username) {
        const existing = await prisma.user.findFirst({
          where: {
            AND: [
              { id: { not: req.user!.userId } },
              { OR: [
                ...(email ? [{ email }] : []),
                ...(username ? [{ username }] : []),
              ]},
            ],
          },
        });
        if (existing) {
          res.status(409).json({ error: 'E-Mail oder Benutzername bereits vergeben' });
          return;
        }
      }

      const user = await prisma.user.update({
        where: { id: req.user!.userId },
        data,
        select: { id: true, email: true, username: true, role: true, createdAt: true },
      });

      logger.info(`Profil aktualisiert: ${user.username} (${user.id})`);
      res.json(user);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── PUT /api/auth/password ───────────────────────────────────────────────
// Eigenes Passwort ändern
router.put(
  '/password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Aktuelles Passwort erforderlich'),
    body('newPassword').isLength({ min: 8 }).withMessage('Neues Passwort: mindestens 8 Zeichen'),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const { currentPassword, newPassword } = req.body;

      const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
      if (!user) {
        res.status(404).json({ error: 'Benutzer nicht gefunden' });
        return;
      }

      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) {
        res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
        return;
      }

      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      });

      logger.info(`Passwort geändert: ${user.username} (${user.id})`);
      res.json({ message: 'Passwort erfolgreich geändert' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── GET /api/auth/users (Admin only) ─────────────────────────────────────
router.get('/users', authenticate, async (req: Request, res: Response) => {
  if (req.user!.role !== 'ADMIN') {
    res.status(403).json({ error: 'Nur Admins dürfen Benutzer auflisten' });
    return;
  }

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { auditLogs: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/auth/users (Admin only) ────────────────────────────────────
// Admin erstellt neuen Benutzer
router.post(
  '/users',
  authenticate,
  [
    body('email').isEmail().withMessage('Gültige E-Mail-Adresse erforderlich'),
    body('username').isLength({ min: 3, max: 30 }).withMessage('Benutzername: 3-30 Zeichen'),
    body('password').isLength({ min: 8 }).withMessage('Passwort: mindestens 8 Zeichen'),
    body('role').isIn(['ADMIN', 'OPERATOR', 'VIEWER']).withMessage('Rolle: ADMIN, OPERATOR oder VIEWER'),
  ],
  async (req: Request, res: Response) => {
    if (req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: 'Nur Admins dürfen Benutzer erstellen' });
      return;
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const { email, username, password, role } = req.body;
      const result = await registerUser(email, username, password, role);
      logger.info(`Benutzer erstellt von Admin ${req.user!.username}: ${username} (${role})`);
      res.status(201).json(result.user);
    } catch (err: any) {
      res.status(409).json({ error: err.message });
    }
  }
);

// ─── PUT /api/auth/users/:id (Admin only) ─────────────────────────────────
// Admin aktualisiert einen Benutzer (Rolle, E-Mail, Username)
router.put(
  '/users/:id',
  authenticate,
  [
    body('email').optional().isEmail().withMessage('Gültige E-Mail-Adresse erforderlich'),
    body('username').optional().isLength({ min: 3, max: 30 }).withMessage('Benutzername: 3-30 Zeichen'),
    body('role').optional().isIn(['ADMIN', 'OPERATOR', 'VIEWER']).withMessage('Rolle: ADMIN, OPERATOR oder VIEWER'),
  ],
  async (req: Request, res: Response) => {
    if (req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: 'Nur Admins dürfen Benutzer ändern' });
      return;
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const id = req.params.id as string;
      const { email, username, role } = req.body;
      const data: any = {};
      if (email) data.email = email;
      if (username) data.username = username;
      if (role) data.role = role;

      if (Object.keys(data).length === 0) {
        res.status(400).json({ error: 'Keine Änderungen angegeben' });
        return;
      }

      // Eindeutigkeitsprüfung
      if (email || username) {
        const existing = await prisma.user.findFirst({
          where: {
            AND: [
              { id: { not: id } },
              { OR: [
                ...(email ? [{ email }] : []),
                ...(username ? [{ username }] : []),
              ]},
            ],
          },
        });
        if (existing) {
          res.status(409).json({ error: 'E-Mail oder Benutzername bereits vergeben' });
          return;
        }
      }

      const user = await prisma.user.update({
        where: { id },
        data,
        select: { id: true, email: true, username: true, role: true, createdAt: true },
      });

      logger.info(`Benutzer aktualisiert von Admin ${req.user!.username}: ${user.username} → ${JSON.stringify(data)}`);
      res.json(user);
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ error: 'Benutzer nicht gefunden' });
        return;
      }
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── PUT /api/auth/users/:id/reset-password (Admin only) ──────────────────
// Admin setzt Passwort eines Benutzers zurück
router.put(
  '/users/:id/reset-password',
  authenticate,
  [
    body('newPassword').isLength({ min: 8 }).withMessage('Neues Passwort: mindestens 8 Zeichen'),
  ],
  async (req: Request, res: Response) => {
    if (req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: 'Nur Admins dürfen Passwörter zurücksetzen' });
      return;
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const id = req.params.id as string;
      const { newPassword } = req.body;

      const hashedPassword = await bcrypt.hash(newPassword, 12);
      const user = await prisma.user.update({
        where: { id },
        data: { password: hashedPassword },
        select: { id: true, username: true },
      });

      logger.info(`Passwort zurückgesetzt von Admin ${req.user!.username} für: ${user.username}`);
      res.json({ message: `Passwort für ${user.username} erfolgreich zurückgesetzt` });
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ error: 'Benutzer nicht gefunden' });
        return;
      }
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── DELETE /api/auth/users/:id (Admin only) ──────────────────────────────
// Admin löscht einen Benutzer
router.delete('/users/:id', authenticate, async (req: Request, res: Response) => {
  if (req.user!.role !== 'ADMIN') {
    res.status(403).json({ error: 'Nur Admins dürfen Benutzer löschen' });
    return;
  }

  try {
    const id = req.params.id as string;

    // Selbstlöschung verhindern
    if (id === req.user!.userId) {
      res.status(400).json({ error: 'Du kannst dich nicht selbst löschen' });
      return;
    }

    // Letzten Admin schützen
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
    const targetUser = await prisma.user.findUnique({ where: { id }, select: { role: true, username: true } });

    if (!targetUser) {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return;
    }

    if (targetUser.role === 'ADMIN' && adminCount <= 1) {
      res.status(400).json({ error: 'Der letzte Admin-Benutzer kann nicht gelöscht werden' });
      return;
    }

    await prisma.user.delete({ where: { id } });
    logger.info(`Benutzer gelöscht von Admin ${req.user!.username}: ${targetUser.username}`);
    res.json({ message: `Benutzer ${targetUser.username} gelöscht` });
  } catch (err: any) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;
