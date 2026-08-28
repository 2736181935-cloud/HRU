import { rpc } from './supabase.js';

const app = document.querySelector('#app');
const progressBar = document.querySelector('#progressBar');
const STEPS = ['consent','scenario','ai_authority_material','evaluation_complete','feedback_material','comprehension_check','manipulation_check','organizational_dehumanization','demographics','complete'];
let state = { publicId: localStorage.getItem('study_public_id'), sessionToken: localStorage.getItem('study_session_token'), step: 'consent', condition: null, enteredAt: Date.now(), focusLoss: 0 };
document.addEventListener('visibilitychange', () => { if (document.hidden) state.focusLoss += 1; });
const escapeHtml = value => String(value).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function beginStep(step) { state.step = step; state.enteredAt = Date.now(); state.focusLoss = 0; progressBar.style.width = `${Math.max(0, STEPS.indexOf(step)) / (STEPS.length - 1) * 100}%`; render(); }
function card(content) { app.innerHTML = `<section class="card">${content}</section>`; window.scrollTo(0,0); }
function error(message) { const old = document.querySelector('.error'); if (old) old.remove(); app.querySelector('.card').insertAdjacentHTML('beforeend', `<div class="error">${escapeHtml(message)}</div>`); }
async function submitStep(answers = {}) {
  try {
    const result = await rpc('submit_step', { p_public_id:state.publicId, p_session_token:state.sessionToken, p_step_code:state.step, p_answers:answers, p_entered_at:new Date(state.enteredAt).toISOString(), p_duration_ms:Date.now()-state.enteredAt, p_focus_loss_count:state.focusLoss });
    beginStep(result.currentStep);
  } catch (e) { error(e.message); }
}
function selected(name) { return document.querySelector(`input[name="${name}"]:checked`)?.value; }
function choice(name, value, label) { return `<label class="option"><input type="radio" name="${name}" value="${escapeHtml(value)}"><span>${escapeHtml(label)}</span></label>`; }
function scaleQuestion(code, text) { return `<div class="question"><div class="question-title">${escapeHtml(text)}</div><div class="scale">${[1,2,3,4,5,6,7].map(n=>`<label><input type="radio" name="${code}" value="${n}">${n}</label>`).join('')}</div><div class="anchors"><span>非常不同意</span><span>非常同意</span></div></div>`; }
function collect(codes) { const result={}; for (const code of codes) { const value=selected(code); if (!value) throw new Error('请完成本页所有题目'); result[code]=value; } return result; }
function nextButton(label='继续') { return `<div class="actions"><button id="next" class="btn btn-primary">${label}</button></div>`; }

async function consent() {
  card(`<div class="eyebrow">学术研究问卷</div><h1>AI辅助绩效管理系统认知研究</h1><p>您好！本调查旨在了解企业员工对AI辅助绩效管理系统的认知与感受。调查匿名进行，数据仅用于学术研究。</p><div class="notice">参与完全自愿。您可以选择不参与，也可以在提交前关闭页面退出。</div><p>请选择是否同意参与本研究：</p><div class="options">${choice('CONSENT','yes','我已阅读上述说明，并自愿参与本研究')}${choice('CONSENT','no','我不同意参与本研究')}</div>${nextButton('确认选择')}`);
  document.querySelector('#next').onclick = async () => {
    const answer=selected('CONSENT'); if(!answer) return error('请选择是否同意参与');
    if(answer==='no') return card('<div class="success"><h1>感谢您的关注</h1><p>您选择不参与本研究，本网站不会保存您的问卷答案。</p></div>');
    try { const result=await rpc('start_participant',{p_source:new URLSearchParams(location.search).get('source')||''}); state.publicId=result.publicId; state.sessionToken=result.sessionToken; localStorage.setItem('study_public_id',result.publicId); localStorage.setItem('study_session_token',result.sessionToken); await loadSession(); } catch(e){error(e.message);}
  };
}
function scenario() { card(`<div class="eyebrow">情景材料</div><h1>请认真阅读以下工作情景</h1><div class="record"><div class="record-head">工作情景</div><div class="record-body"><p>请想象您目前在一家中型互联网公司工作。公司最近引入了一套AI辅助绩效评估系统，该系统会基于您三个月内的工作数据（如项目完成率、协作评分、文档质量等）辅助绩效评分。</p></div></div>${nextButton()}`); document.querySelector('#next').onclick=()=>submitStep(); }
function aiMaterial(){const high=state.condition.aiWeight==='high';card(`<div class="eyebrow">绩效评估流程</div><h1>AI系统在本轮评估中的作用</h1><div class="notice">${high?'您的绩效评估得分完全由该AI评估决定。':'您的绩效评估得分由您的主管决定，主管可能会参考，也可能不会参考该AI系统的评估结果。'}</div>${nextButton()}`);document.querySelector('#next').onclick=()=>submitStep();}
function evaluation(){card(`<div class="eyebrow">绩效反馈</div><h1>绩效反馈面谈</h1><div class="record"><div class="record-head">公司流程</div><div class="record-body"><p>在最终公布的评估结果后，按照公司流程，您的直属主管与您进行了一对一的绩效反馈面谈，以沟通评估结果和后续工作安排。</p></div></div>${nextButton('查看面谈内容')}`);document.querySelector('#next').onclick=()=>submitStep();}
function feedback(){const dev=state.condition.feedback==='developmental';const text=dev?'面谈中，您的直属主管针对您的绩效评估得分进行了具体分析，为您提出针对性的改进措施与提升建议。':'面谈中，您的直属主管笼统提及了您的绩效评估得分，未做具体分析，也未给出针对性的改进措施或提升建议。';card(`<div class="eyebrow">一对一沟通</div><h1>绩效反馈面谈</h1><div class="record"><div class="record-head">面谈内容</div><div class="record-body"><p>${text}</p></div></div>${nextButton()}`);document.querySelector('#next').onclick=()=>submitStep();}
function checks(){card(`<div class="eyebrow">材料理解</div><h1>请根据刚才的材料回答</h1><div class="question"><div class="question-title">1. 本轮最终评估结论主要由谁决定？</div><div class="options">${choice('CHECK_AI_AUTHORITY','ai','AI绩效评估系统')}${choice('CHECK_AI_AUTHORITY','supervisor','直属主管')}${choice('CHECK_AI_AUTHORITY','colleagues','同事共同决定')}${choice('CHECK_AI_AUTHORITY','unknown','无法确定')}</div></div><div class="question"><div class="question-title">2. 主管是否提供了具体的改进建议？</div><div class="options">${choice('CHECK_FEEDBACK','yes','提供了具体改进建议')}${choice('CHECK_FEEDBACK','no','未提供具体改进建议')}${choice('CHECK_FEEDBACK','unknown','无法确定')}</div></div>${nextButton()}`);document.querySelector('#next').onclick=()=>{try{submitStep(collect(['CHECK_AI_AUTHORITY','CHECK_FEEDBACK']));}catch(e){error(e.message)}};}
const aip=['所使用的AI对评估的整体政策或程序具有影响力。','所使用的AI决定了影响我个人评估结果的事项。','所使用的AI影响了我个人评估（考核）的执行方式。'];
const df=['在给我反馈时，我的主管专注于帮助我学习和提高。','我的直属主管没有给我有利于我发展的反馈。','我的主管会为我提供有用的信息，告诉我如何提高我的工作绩效。'];
function manipulation(){const codes=['AIP1','AIP2','AIP3','DF1','DF2','DF3'];card(`<div class="eyebrow">个人感受</div><h1>请根据刚才的情景作答</h1><p class="muted">1表示“非常不同意”，7表示“非常同意”。</p>${[...aip,...df].map((q,i)=>scaleQuestion(codes[i],q)).join('')}${nextButton()}`);document.querySelector('#next').onclick=()=>{try{submitStep(collect(codes));}catch(e){error(e.message)}};}
const od=['组织把我视作服务于其自身目的的工具。','组织只有在需要我的时候，才会对我产生兴趣。','对组织而言，唯一重要的就是我能为它做出什么贡献。','组织仅仅把我视作一个数字。','组织对待我时仿佛我只是一件物品。'];
function organizational(){const codes=['OD1','OD2','OD3','OD4','OD5'];card(`<div class="eyebrow">组织感受</div><h1>如果您处于上述情景，请判断以下陈述</h1><p class="muted">1表示“非常不同意”，7表示“非常同意”。</p>${od.map((q,i)=>scaleQuestion(codes[i],q)).join('')}${nextButton()}`);document.querySelector('#next').onclick=()=>{try{submitStep(collect(codes));}catch(e){error(e.message)}};}
function demographics(){const fields=[['GENDER','性别',['男','女','其他/不便回答']],['AGE_GROUP','年龄',['18–25岁','26–35岁','36–45岁','46岁及以上']],['EDUCATION','最高学历',['高中及以下','专科','本科','硕士及以上']],['WORK_YEARS','工作年限',['没有任何工作经历','只有实习经历','不足1年','1–3年','4–6年','7年及以上']],['PERFORMANCE_EXPERIENCE','是否经历过正式绩效考核',['是','否']],['AI_USAGE','是否使用过AI办公工具',['是','否']],['AI_FAMILIARITY','对AI技术的熟悉程度',['非常不熟悉','不熟悉','一般','熟悉','非常熟悉']]];card(`<div class="eyebrow">基本信息</div><h1>最后，请填写以下信息</h1>${fields.map(([c,l,opts])=>`<div class="form-row"><label for="${c}">${l}</label><select id="${c}"><option value="">请选择</option>${opts.map(o=>`<option>${o}</option>`).join('')}</select></div>`).join('')}${nextButton('提交问卷')}`);document.querySelector('#next').onclick=()=>{try{const a={};for(const [c] of fields){const v=document.querySelector(`#${c}`).value;if(!v)throw new Error('请完成所有基本信息题');a[c]=v}submitStep(a)}catch(e){error(e.message)}};}
async function complete(){try{const result=await rpc('complete_participant',{p_public_id:state.publicId,p_session_token:state.sessionToken});localStorage.removeItem('study_public_id');localStorage.removeItem('study_session_token');progressBar.style.width='100%';card(`<div class="success"><div class="eyebrow">提交成功</div><h1>感谢您的参与</h1><p>您的回答已成功记录。匿名完成码：</p><div class="code">${escapeHtml(result.completionCode)}</div><p class="muted">请保存该完成码，然后关闭本页面。</p></div>`);}catch(e){card(`<h1>提交未完成</h1><div class="error">${escapeHtml(e.message)}</div>`);}}
function render(){({consent,scenario,ai_authority_material:aiMaterial,evaluation_complete:evaluation,feedback_material:feedback,comprehension_check:checks,manipulation_check:manipulation,organizational_dehumanization:organizational,demographics,complete}[state.step]||consent)();}
async function loadSession(){if(!state.publicId||!state.sessionToken)return beginStep('consent');try{const session=await rpc('get_participant',{p_public_id:state.publicId,p_session_token:state.sessionToken});state.condition={aiWeight:session.aiWeight,feedback:session.feedback};beginStep(session.status==='completed'?'complete':session.currentStep);}catch{localStorage.removeItem('study_public_id');localStorage.removeItem('study_session_token');state.publicId=null;state.sessionToken=null;beginStep('consent');}}
loadSession();
