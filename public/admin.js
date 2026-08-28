import { ADMIN_EMAIL } from './config.js';
import { captureAuthSession, rpc, sendMagicLink } from './supabase.js';

const login = document.querySelector('#login');
const dashboard = document.querySelector('#dashboard');
const message = document.querySelector('#message');
const token = captureAuthSession();
let cachedRows = [];

const esc = value => String(value ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const csvEscape = value => {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"','""')}"` : text;
};

function showError(error) {
  message.innerHTML = `<div class="error">${esc(error.message || error)}</div>`;
}

function downloadCsv() {
  const answerCodes = [...new Set(cachedRows.flatMap(row => Object.keys(row.answers || {})))].sort();
  const headers = ['public_id','condition_code','ai_weight','feedback','status','started_at','completed_at','completion_code','flag_count',...answerCodes];
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of cachedRows) {
    lines.push([row.public_id,row.condition_code,row.ai_weight,row.feedback,row.status,row.started_at,row.completed_at,row.completion_code,row.flag_count,...answerCodes.map(code=>row.answers?.[code])].map(csvEscape).join(','));
  }
  const blob = new Blob(['\uFEFF'+lines.join('\r\n')], { type:'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `HRU-study-${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function load() {
  if (!token) return;
  try {
    const [stats, rows] = await Promise.all([rpc('admin_dashboard',{},token),rpc('admin_responses',{},token)]);
    cachedRows = rows;
    login.hidden = true;
    dashboard.hidden = false;
    dashboard.innerHTML = `<div class="notice">总记录：${stats.totals.total||0}　已完成：${stats.totals.completed||0}</div>
      <h2>四组分布</h2><div class="record"><div class="record-body">${stats.groups.map(g=>`<p><strong>${esc(g.condition_code)}组</strong>：${g.total}人，完成${g.completed||0}人</p>`).join('')||'暂无数据'}</div></div>
      <div class="actions"><button id="exportBtn" class="btn btn-primary">导出CSV</button></div>
      <h2>最近记录</h2><div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>编号</th><th>组别</th><th>状态</th><th>异常标记</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.public_id)}</td><td>${esc(r.condition_code)}</td><td>${esc(r.status)}</td><td>${r.flag_count}</td></tr>`).join('')}</tbody></table></div>`;
    document.querySelector('#exportBtn').onclick = downloadCsv;
  } catch (error) {
    sessionStorage.removeItem('admin_access_token');
    showError(error);
  }
}

document.querySelector('#loginBtn').onclick = async () => {
  try {
    await sendMagicLink(ADMIN_EMAIL);
    message.innerHTML = '<div class="notice">登录邮件已发送至管理员邮箱，请点击邮件中的链接返回后台。</div>';
  } catch (error) { showError(error); }
};

load();
