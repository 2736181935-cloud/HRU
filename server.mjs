import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CONDITIONS, STEP_ORDER, chooseBalancedCondition, csvEscape, nextStep } from './lib/experiment.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_DIR = join(ROOT, 'data');
mkdirSync(DATA_DIR, { recursive: true });

const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-password';
const IP_HASH_SALT = process.env.IP_HASH_SALT || randomBytes(32).toString('hex');
const STUDY_MODE = process.env.STUDY_MODE === 'formal' ? 'formal' : 'pilot';
const DB_PATH = process.env.DB_PATH || join(DATA_DIR, 'study.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(`
  CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY, public_id TEXT UNIQUE NOT NULL, study_mode TEXT NOT NULL,
    condition_code TEXT NOT NULL, ai_weight TEXT NOT NULL, feedback TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress', current_step TEXT,
    questionnaire_version TEXT NOT NULL DEFAULT '1.0.0', source TEXT,
    ip_hash TEXT, device_category TEXT, started_at TEXT NOT NULL,
    completed_at TEXT, last_active_at TEXT NOT NULL, completion_code TEXT UNIQUE
  );
  CREATE TABLE IF NOT EXISTS responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, participant_id TEXT NOT NULL,
    question_code TEXT NOT NULL, raw_value TEXT, numeric_value REAL,
    answered_at TEXT NOT NULL, UNIQUE(participant_id, question_code),
    FOREIGN KEY(participant_id) REFERENCES participants(id)
  );
  CREATE TABLE IF NOT EXISTS step_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, participant_id TEXT NOT NULL,
    step_code TEXT NOT NULL, entered_at TEXT, submitted_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0, focus_loss_count INTEGER NOT NULL DEFAULT 0,
    validation_passed INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(participant_id) REFERENCES participants(id)
  );
  CREATE TABLE IF NOT EXISTS quality_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT, participant_id TEXT NOT NULL,
    flag_code TEXT NOT NULL, details TEXT, created_at TEXT NOT NULL,
    UNIQUE(participant_id, flag_code), FOREIGN KEY(participant_id) REFERENCES participants(id)
  );
`);

const adminSessions = new Map();
const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};
const body = async req => {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 100_000) throw new Error('请求内容过大'); chunks.push(chunk); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
};
const hash = value => createHash('sha256').update(`${IP_HASH_SALT}:${value || ''}`).digest('hex');
const passwordMatches = input => {
  const a = scryptSync(String(input), 'ai-study-admin', 32);
  const b = scryptSync(ADMIN_PASSWORD, 'ai-study-admin', 32);
  return timingSafeEqual(a, b);
};
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(v => v.trim().split('=')));
const isAdmin = req => {
  const token = cookies(req).admin_session;
  const expiry = adminSessions.get(token);
  return Boolean(expiry && expiry > Date.now());
};
const getParticipant = publicId => db.prepare('SELECT * FROM participants WHERE public_id=?').get(publicId);

function assignmentCounts() {
  return Object.fromEntries(CONDITIONS.map(({ code }) => [code,
    db.prepare("SELECT COUNT(*) count FROM participants WHERE condition_code=? AND status IN ('in_progress','completed') AND study_mode=?").get(code, STUDY_MODE).count,
  ]));
}

function saveAnswers(participantId, answers) {
  const statement = db.prepare(`INSERT INTO responses(participant_id,question_code,raw_value,numeric_value,answered_at)
    VALUES(?,?,?,?,?) ON CONFLICT(participant_id,question_code) DO UPDATE SET raw_value=excluded.raw_value,numeric_value=excluded.numeric_value,answered_at=excluded.answered_at`);
  const now = new Date().toISOString();
  for (const [code, value] of Object.entries(answers || {})) {
    if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) continue;
    statement.run(participantId, code, typeof value === 'string' ? value : JSON.stringify(value), Number.isFinite(Number(value)) ? Number(value) : null, now);
  }
}

function buildExport() {
  const participants = db.prepare('SELECT * FROM participants ORDER BY started_at').all();
  const responseRows = db.prepare('SELECT participant_id,question_code,raw_value FROM responses').all();
  const responseMap = new Map(); const codes = new Set();
  for (const row of responseRows) { if (!responseMap.has(row.participant_id)) responseMap.set(row.participant_id, {}); responseMap.get(row.participant_id)[row.question_code] = row.raw_value; codes.add(row.question_code); }
  const questionCodes = [...codes].sort();
  const headers = ['public_id','study_mode','condition_code','ai_weight','feedback','status','started_at','completed_at','completion_code',...questionCodes];
  const lines = [headers.map(csvEscape).join(',')];
  for (const p of participants) {
    const answers = responseMap.get(p.id) || {};
    lines.push([p.public_id,p.study_mode,p.condition_code,p.ai_weight,p.feedback,p.status,p.started_at,p.completed_at,p.completion_code,...questionCodes.map(c => answers[c])].map(csvEscape).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

async function api(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/participants') {
    const input = await body(req); const condition = chooseBalancedCondition(assignmentCounts());
    const id = randomUUID(); const publicId = `P-${randomBytes(5).toString('hex').toUpperCase()}`; const now = new Date().toISOString();
    db.prepare(`INSERT INTO participants(id,public_id,study_mode,condition_code,ai_weight,feedback,current_step,source,ip_hash,device_category,started_at,last_active_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, publicId, STUDY_MODE, condition.code, condition.aiWeight, condition.feedback, STEP_ORDER[0], String(input.source || '').slice(0,100), hash(req.socket.remoteAddress), /mobile/i.test(req.headers['user-agent'] || '') ? 'mobile' : 'desktop', now, now);
    return json(res, 201, { publicId, currentStep: STEP_ORDER[0] });
  }
  const sessionMatch = url.pathname.match(/^\/api\/participants\/([^/]+)$/);
  if (req.method === 'GET' && sessionMatch) {
    const p = getParticipant(sessionMatch[1]); if (!p) return json(res, 404, { error: '参与者不存在' });
    return json(res, 200, { publicId: p.public_id, currentStep: p.current_step, status: p.status, aiWeight: p.ai_weight, feedback: p.feedback, completionCode: p.completion_code });
  }
  const stepMatch = url.pathname.match(/^\/api\/participants\/([^/]+)\/steps$/);
  if (req.method === 'POST' && stepMatch) {
    const p = getParticipant(stepMatch[1]); if (!p) return json(res, 404, { error: '参与者不存在' });
    if (p.status === 'completed') return json(res, 409, { error: '问卷已完成' });
    const input = await body(req); const stepCode = String(input.stepCode || '');
    if (stepCode !== p.current_step) return json(res, 409, { error: '页面顺序不正确', currentStep: p.current_step });
    saveAnswers(p.id, input.answers);
    const now = new Date().toISOString(); const next = nextStep(stepCode);
    db.prepare('INSERT INTO step_events(participant_id,step_code,entered_at,submitted_at,duration_ms,focus_loss_count) VALUES(?,?,?,?,?,?)').run(p.id, stepCode, input.enteredAt || null, now, Math.max(0, Math.min(Number(input.durationMs) || 0, 3_600_000)), Math.max(0, Number(input.focusLossCount) || 0));
    db.prepare('UPDATE participants SET current_step=?,last_active_at=? WHERE id=?').run(next, now, p.id);
    if (stepCode === 'comprehension_check') {
      const aiCorrect = input.answers?.CHECK_AI_AUTHORITY === (p.ai_weight === 'high' ? 'ai' : 'supervisor');
      const feedbackCorrect = input.answers?.CHECK_FEEDBACK === (p.feedback === 'developmental' ? 'yes' : 'no');
      const flag = db.prepare('INSERT OR IGNORE INTO quality_flags(participant_id,flag_code,details,created_at) VALUES(?,?,?,?)');
      if (!aiCorrect) flag.run(p.id, 'FAILED_AI_CHECK', '{}', now);
      if (!feedbackCorrect) flag.run(p.id, 'FAILED_FEEDBACK_CHECK', '{}', now);
    }
    return json(res, 200, { currentStep: next });
  }
  const completeMatch = url.pathname.match(/^\/api\/participants\/([^/]+)\/complete$/);
  if (req.method === 'POST' && completeMatch) {
    const p = getParticipant(completeMatch[1]); if (!p) return json(res, 404, { error: '参与者不存在' });
    if (p.status === 'completed') return json(res, 200, { completionCode: p.completion_code });
    if (p.current_step !== 'complete') return json(res, 409, { error: '问卷尚未完成', currentStep: p.current_step });
    const code = `OD-${randomBytes(4).toString('hex').toUpperCase()}`; const now = new Date().toISOString();
    db.prepare("UPDATE participants SET status='completed',completed_at=?,last_active_at=?,completion_code=? WHERE id=?").run(now, now, code, p.id);
    return json(res, 200, { completionCode: code });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    const input = await body(req); if (!passwordMatches(input.password)) return json(res, 401, { error: '密码错误' });
    const token = randomBytes(32).toString('hex'); adminSessions.set(token, Date.now() + 8 * 60 * 60 * 1000);
    return json(res, 200, { ok: true }, { 'Set-Cookie': `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` });
  }
  if (url.pathname.startsWith('/api/admin/') && !isAdmin(req)) return json(res, 401, { error: '请先登录' });
  if (req.method === 'GET' && url.pathname === '/api/admin/dashboard') {
    const totals = db.prepare("SELECT COUNT(*) total, SUM(status='completed') completed FROM participants WHERE study_mode=?").get(STUDY_MODE);
    const groups = db.prepare("SELECT condition_code,COUNT(*) total,SUM(status='completed') completed FROM participants WHERE study_mode=? GROUP BY condition_code ORDER BY condition_code").all(STUDY_MODE);
    const flags = db.prepare('SELECT flag_code,COUNT(*) count FROM quality_flags GROUP BY flag_code').all();
    return json(res, 200, { mode: STUDY_MODE, totals, groups, flags });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/responses') {
    const rows = db.prepare(`SELECT p.public_id,p.condition_code,p.ai_weight,p.feedback,p.status,p.started_at,p.completed_at,
      (SELECT COUNT(*) FROM quality_flags q WHERE q.participant_id=p.id) flag_count FROM participants p ORDER BY p.started_at DESC LIMIT 500`).all();
    return json(res, 200, rows);
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/export.csv') {
    const csv = buildExport(); res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="study-data.csv"', 'Cache-Control': 'no-store' }); return res.end(csv);
  }
  return json(res, 404, { error: '接口不存在' });
}

const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml' };
function staticFile(req, res, url) {
  let pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  if (pathname === '/admin') pathname = '/admin.html';
  const file = normalize(join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'", 'Cache-Control': extname(file) === '.html' ? 'no-store' : 'public, max-age=3600' });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try { if (url.pathname.startsWith('/api/')) await api(req, res, url); else staticFile(req, res, url); }
  catch (error) { console.error(error); if (!res.headersSent) json(res, error instanceof SyntaxError ? 400 : 500, { error: error.message || '服务器错误' }); }
});
server.listen(PORT, HOST, () => {
  console.log(`AI绩效实验网站已启动：http://${HOST}:${PORT}`);
  if (ADMIN_PASSWORD === 'change-this-password') console.warn('警告：请通过ADMIN_PASSWORD设置正式后台密码。');
  console.log(`数据文件：${DB_PATH}`);
});
