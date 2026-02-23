import dotenv from 'dotenv';
import path from 'path';

// .env aus dem Backend-Verzeichnis laden (backend/.env)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Datenbank (wird von Prisma direkt aus DATABASE_URL gelesen)
  databaseUrl: process.env.DATABASE_URL!,

  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'CHANGE_ME',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },

  // Master-Key für AES-256-GCM Verschlüsselung
  encryptionMasterKey: process.env.ENCRYPTION_MASTER_KEY || '',

  // Nmap
  nmapPath: process.env.NMAP_PATH || '/usr/bin/nmap',

  // LLM (Etappe 5)
  llm: {
    apiUrl: process.env.LLM_API_URL || 'http://localhost:8001/v1/chat/completions',
    model: process.env.LLM_MODEL || 'gemma2',
  },
} as const;

// Validierung beim Start
export function validateConfig(): void {
  if (config.jwt.secret === 'CHANGE_ME') {
    console.warn('⚠️  JWT_SECRET ist nicht gesetzt – bitte in .env konfigurieren!');
  }
  if (!config.encryptionMasterKey || config.encryptionMasterKey.length !== 64) {
    throw new Error(
      'ENCRYPTION_MASTER_KEY muss exakt 64 Hex-Zeichen (32 Bytes) lang sein. ' +
      'Generieren mit: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
}
