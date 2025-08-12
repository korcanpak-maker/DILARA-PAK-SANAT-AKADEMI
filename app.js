
/* =========================
   Data layer (localStorage or Firestore)
   ========================= */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2,10);
const TL = n => new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'}).format(Number(n||0));

$('#year').textContent = new Date().getFullYear();

const dataShape = () => ({
  settings: {
    academyName: "Dilara Pak Sanat Akademi",
    defaultShare: 50,
    useFirebase: "no",
    firebase: { apiKey:"", authDomain:"", projectId:"", appId:"" }
  },
  students: [], teachers: [], courses: [],
  enrollments: [], // {id, studentId, courseId, teacherId, startDate, shareOverride?, schedule}
  payments: []     // {id, studentId, courseId, amount, date, method}
});

const store = {
  key: 'dpsa_pro_v1',
  load(){ try { return JSON.parse(localStorage.getItem(this.key)) || dataShape(); } catch(e){ return dataShape(); } },
  save(d){ localStorage.setItem(this.key, JSON.stringify(d)); }
};

let db = store.load();

/* Firebase setup (optional) */
let FB = { app:null, auth:null, fs:null, user:null };
async function tryInitFirebase(){
  if(db.settings.useFirebase!=="yes") return false;
  const cfg = db.settings.firebase;
  if(!cfg.apiKey || !cfg.projectId) return false;
  try{
    FB.app = firebase.initializeApp(cfg);
    FB.auth = firebase.auth();
    FB.fs   = firebase.firestore();
    // Offline cache
    FB.fs.enablePersistence?.().catch(()=>{});
    // Auth UI
    renderAuth();
    FB.auth.onAuthStateChanged(u=>{ FB.user=u; renderAuth(); if(u){ syncFromFirestore(); } });
    return true;
  }catch(e){ console.error(e); alert("Firebase başlatılamadı, localStorage kullanılacak."); return false; }
}
function renderAuth(){
  const el = $('#authArea');
  if(db.settings.useFirebase!=="yes"){ el.innerHTML = `<small class="muted">Misafir</small>`; return; }
  if(FB.user){
    el.innerHTML = `<small>${FB.user.displayName||FB.user.email}</small> <button class="btn-outline" id="logoutBtn">Çıkış</button>`;
    $('#logoutBtn').onclick = ()=>FB.auth.signOut();
  }else{
    el.innerHTML = `<button class="btn-outline" id="loginBtn">Google ile Giriş</button>`;
    $('#loginBtn').onclick = async ()=>{
      const provider = new firebase.auth.GoogleAuthProvider();
      await FB.auth.signInWithPopup(provider);
    };
  }
}
// Basic Firestore sync (one-shot pull + push on save). Collections separated.
async function syncFromFirestore(){
  if(!FB.user) return;
  const colls = ["students","teachers","courses","enrollments","payments","settings"];
  for(const c of colls){
    const snap = await FB.fs.collection(c).get();
    if(c==="settings"){
      if(!snap.empty){ db.settings = snap.docs[0].data(); }
    }else{
      db[c] = snap.docs.map(d=>({id:d.id, ...d.data()}));
    }
  }
  store.save(db); renderAll();
}
async function fsSaveCollection(name){
  if(db.settings.useFirebase!=="yes" || !FB.user) return;
  const batch = FB.fs.batch();
  const ref = FB.fs.collection(name);
  // Clear existing: for simplicity, overwrite by deleting all and adding
  const existing = await ref.get();
  existing.forEach(d=>batch.delete(d.ref));
  batch.commit && await batch.commit();
  // Recreate
  const batch2 = FB.fs.batch();
  if(name==="settings"){
    const docRef = FB.fs.collection(name).doc("main");
    batch2.set(docRef, db.settings);
  }else{
    db[name].forEach(item=>{
      const id = item.id || FB.fs.collection("_").doc().id;
      const {id:_, ...rest} = item;
      batch2.set(ref.doc(id), rest);
    });
  }
  await batch2.commit();
}

/* =========================
   Routing + UX niceties
   ========================= */
function showPage(hash){
  const target = (hash || location.hash || '#dashboard').split('?')[0];
  $$('.page').forEach(p => p.classList.add('hidden'));
  $$('.tabs .tab').forEach(a => a.classList.remove('active'));
  $(target)?.classList.remove('hidden');
  $(`.tabs .tab[href="${target}"]`)?.classList.add('active');
  renderAll();
}
window.addEventListener('hashchange', ()=>showPage(location.hash));
showPage(location.hash);

function closeDialogOnBackdrop(dlg){
  dlg.addEventListener('click', (e)=>{
    const rect = dlg.getBoundingClientRect();
    const inDialog = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if(!inDialog) dlg.close('cancel');
  });
  dlg.addEventListener('keydown', (e)=>{ if(e.key==='Escape') dlg.close('cancel'); });
}
$$('dialog').forEach(closeDialogOnBackdrop);
$$('[data-close]').forEach(b=> b.addEventListener('click', (e)=> b.closest('dialog')?.close('cancel')));

/* =========================
   Helpers
   ========================= */
const byId = (arr, id) => arr.find(x => x.id === id);
function sortBy(arr, key, dir=1){ return [...arr].sort((a,b)=> (a[key] > b[key] ? dir : -dir)); }
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

/* =========================
   Finance helpers: dues & payouts
   ========================= */
function monthKey(d){ const dt=new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`; }
function monthsBetween(start, end){ const s=new Date(start); const e=new Date(end); const arr=[]; s.setDate(1); e.setDate(1);
  while(s<=e){ arr.push(monthKey(s)); s.setMonth(s.getMonth()+1); } return arr; }

// Expected dues for a given enrollment and month: by course price.
function monthlyDuesForEnrollment(enroll, yyyymm){
  const course = byId(db.courses, enroll.courseId); if(!course) return 0;
  // If start date is after the month, zero
  const sd = new Date(enroll.startDate); const [y,m] = yyyymm.split('-').map(Number);
  const firstDay = new Date(y, m-1, 1);
  if(sd > new Date(y, m-1, 31)) return 0;
  return Number(course.price||0);
}

// Calculate per student-course: expected vs paid for selected month (or all).
function calcFinanceSummary(filterMonth=null){
  const summary = {}; // key studentId|courseId -> {expected, paid}
  // Expected: for each enrollment, add monthly dues for that month (or all months since start).
  const months = filterMonth? [filterMonth] : [monthKey(new Date())];
  for(const e of db.enrollments){
    for(const mo of months){
      const exp = monthlyDuesForEnrollment(e, mo);
      const key = `${e.studentId}|${e.courseId}|${mo}`;
      if(!summary[key]) summary[key] = { expected:0, paid:0, studentId:e.studentId, courseId:e.courseId, month:mo };
      summary[key].expected += exp;
    }
  }
  // Paid
  for(const p of db.payments){
    const mo = monthKey(p.date);
    if(filterMonth && mo!==filterMonth) continue;
    const key = `${p.studentId}|${p.courseId}|${mo}`;
    if(!summary[key]) summary[key] = { expected:0, paid:0, studentId:p.studentId, courseId:p.courseId, month:mo };
    summary[key].paid += Number(p.amount||0);
  }
  return Object.values(summary);
}

// Payouts: distribute per payment among enrollments of that student-course; apply share override order.
function teacherShareForEnrollment(enroll){
  if(enroll.shareOverride!=null && enroll.shareOverride!=='') return Number(enroll.shareOverride)/100;
  const t = byId(db.teachers, enroll.teacherId);
  if(t && t.share!=null && t.share!=='') return Number(t.share)/100;
  return Number(db.settings.defaultShare||50)/100;
}
function calcPayouts(filterMonth=null){
  const totals = {}; // teacherId -> amount
  for(const p of db.payments){
    const mo = monthKey(p.date);
    if(filterMonth && mo!==filterMonth) continue;
    const relEnrolls = db.enrollments.filter(e=>e.studentId===p.studentId && e.courseId===p.courseId);
    if(relEnrolls.length===0) continue;
    const perEnroll = Number(p.amount||0)/relEnrolls.length;
    for(const e of relEnrolls){
      const share = teacherShareForEnrollment(e);
      totals[e.teacherId] = (totals[e.teacherId]||0) + perEnroll*share;
    }
  }
  return totals;
}

/* =========================
   Renderers with search/filter/sort
   ========================= */
let sortState = { students:{key:'name',dir:1}, teachers:{key:'name',dir:1}, courses:{key:'title',dir:1},
  enrollments:{key:'student',dir:1}, payments:{key:'date',dir:-1} };

function renderStats(){
  const paid = db.payments.reduce((s,p)=>s+Number(p.amount||0),0);
  $('#stats').innerHTML = `
    <div class="card"><strong>Öğrenci</strong><div>${db.students.length}</div></div>
    <div class="card"><strong>Öğretmen</strong><div>${db.teachers.length}</div></div>
    <div class="card"><strong>Ders</strong><div>${db.courses.length}</div></div>
    <div class="card"><strong>Toplam Tahsilat</strong><div>${TL(paid)}</div></div>`;

  const month = monthKey(new Date());
  const sum = calcFinanceSummary(month);
  const expected = sum.reduce((s,x)=>s+x.expected,0);
  const paidM = sum.reduce((s,x)=>s+x.paid,0);
  $('#financeSummary').innerHTML = `<b>${month}</b> için Beklenen: ${TL(expected)} — Ödenen: ${TL(paidM)} — Fark: ${TL(expected-paidM)}`;
}

function table(heads, rows, sortKeyGroup){
  const thead = `<thead><tr>${heads.map(h=>`<th data-sort="${h.key||''}">${h.label}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${rows.join('') || `<tr><td colspan="${heads.length}"><i>Boş</i></td></tr>`}</tbody>`;
  const html = `<table class="table">${thead}${tbody}</table>`;
  const wrap = document.createElement('div'); wrap.innerHTML = html;
  if(sortKeyGroup){
    wrap.querySelectorAll('th[data-sort]').forEach(th=>{
      const key = th.getAttribute('data-sort'); if(!key) return;
      th.addEventListener('click', ()=>{
        const s = sortState[sortKeyGroup];
        s.dir = (s.key===key) ? -s.dir : 1; s.key = key;
        renderAll();
      });
    });
  }
  return wrap.innerHTML;
}

function renderStudents(){
  const q = $('#studentSearch').value?.toLowerCase() || '';
  let arr = db.students.filter(s=>[s.name,s.email,s.phone].join(' ').toLowerCase().includes(q));
  const s = sortState.students;
  arr = arr.sort((a,b)=> (a[s.key] > b[s.key] ? s.dir : -s.dir));
  const rows = arr.map(s=>`
    <tr>
      <td>${s.name}</td><td>${s.phone||''}</td><td>${s.email||''}</td>
      <td class="row-actions">
        <button class="btn-outline" data-edit-student="${s.id}">Düzenle</button>
        <button class="btn-outline" data-del-student="${s.id}">Sil</button>
      </td>
    </tr>`);
  $('#studentTable').innerHTML = table(
    [{label:'Ad Soyad',key:'name'},{label:'Telefon',key:'phone'},{label:'E-posta',key:'email'},{label:''}],
    rows,'students');
  $$('#studentTable [data-edit-student]').forEach(b=>b.onclick=()=>openStudent(byId(db.students,b.dataset.editStudent)));
  $$('#studentTable [data-del-student]').forEach(b=>b.onclick=()=>{ if(confirm('Silinsin mi?')){ 
    db.enrollments = db.enrollments.filter(e=>e.studentId!==b.dataset.delStudent);
    db.payments   = db.payments.filter(p=>p.studentId!==b.dataset.delStudent);
    db.students   = db.students.filter(x=>x.id!==b.dataset.delStudent);
    store.save(db); fsSaveCollection('students'); renderAll(); } });
}
$('#studentSearch')?.addEventListener('input', debounce(()=>renderStudents(),300));

function renderTeachers(){
  const q = $('#teacherSearch').value?.toLowerCase() || '';
  let arr = db.teachers.filter(t=>[t.name,t.expertise].join(' ').toLowerCase().includes(q));
  const s = sortState.teachers;
  arr = arr.sort((a,b)=> (a[s.key] > b[s.key] ? s.dir : -s.dir));
  const rows = arr.map(t=>`
    <tr>
      <td>${t.name}</td><td>${t.expertise||''}</td><td>${t.share ?? ''}</td>
      <td class="row-actions">
        <button class="btn-outline" data-edit-teacher="${t.id}">Düzenle</button>
        <button class="btn-outline" data-del-teacher="${t.id}">Sil</button>
      </td>
    </tr>`);
  $('#teacherTable').innerHTML = table(
    [{label:'Ad Soyad',key:'name'},{label:'Uzmanlık',key:'expertise'},{label:'Pay (%)',key:'share'},{label:''}],
    rows,'teachers');
  $$('#teacherTable [data-edit-teacher]').forEach(b=>b.onclick=()=>openTeacher(byId(db.teachers,b.dataset.editTeacher)));
  $$('#teacherTable [data-del-teacher]').forEach(b=>b.onclick=()=>{ if(confirm('Silinsin mi?')){
    db.enrollments = db.enrollments.filter(e=>e.teacherId!==b.dataset.delTeacher);
    db.teachers = db.teachers.filter(x=>x.id!==b.dataset.delTeacher);
    store.save(db); fsSaveCollection('teachers'); renderAll(); } });
}
$('#teacherSearch')?.addEventListener('input', debounce(()=>renderTeachers(),300));

function renderCourses(){
  const q = $('#courseSearch').value?.toLowerCase() || '';
  let arr = db.courses.filter(c=>c.title.toLowerCase().includes(q));
  const s = sortState.courses;
  arr = arr.sort((a,b)=> (a[s.key] > b[s.key] ? s.dir : -s.dir));
  const rows = arr.map(c=>`
    <tr>
      <td>${c.title}</td><td>${TL(c.price)}</td>
      <td class="row-actions">
        <button class="btn-outline" data-edit-course="${c.id}">Düzenle</button>
        <button class="btn-outline" data-del-course="${c.id}">Sil</button>
      </td>
    </tr>`);
  $('#courseTable').innerHTML = table(
    [{label:'Ders',key:'title'},{label:'Ücret (Aylık)',key:'price'},{label:''}],
    rows,'courses');
  $$('#courseTable [data-edit-course]').forEach(b=>b.onclick=()=>openCourse(byId(db.courses,b.dataset.editCourse)));
  $$('#courseTable [data-del-course]').forEach(b=>b.onclick=()=>{ if(confirm('Silinsin mi?')){
    db.payments = db.payments.filter(p=>p.courseId!==b.dataset.delCourse);
    db.enrollments = db.enrollments.filter(e=>e.courseId!==b.dataset.delCourse);
    db.courses = db.courses.filter(x=>x.id!==b.dataset.delCourse);
    store.save(db); fsSaveCollection('courses'); renderAll(); } });
}
$('#courseSearch')?.addEventListener('input', debounce(()=>renderCourses(),300));

function renderEnrollments(){
  const q = $('#enrollSearch').value?.toLowerCase() || '';
  // month filter not strictly applied to list; but used in finance/payouts
  const arr = db.enrollments.filter(e=>{
    const s=byId(db.students,e.studentId)?.name||'';
    const c=byId(db.courses,e.courseId)?.title||'';
    const t=byId(db.teachers,e.teacherId)?.name||'';
    return [s,c,t].join(' ').toLowerCase().includes(q);
  });
  const s = sortState.enrollments;
  const rows = arr.map(e=>{
    const st=byId(db.students,e.studentId)?.name||'-';
    const co=byId(db.courses,e.courseId)?.title||'-';
    const te=byId(db.teachers,e.teacherId)?.name||'-';
    return `<tr>
      <td>${st}</td><td>${co}</td><td>${te}</td><td>${e.startDate||''}</td><td>${e.schedule||''}</td><td>${e.shareOverride ?? ''}</td>
      <td class="row-actions">
        <button class="btn-outline" data-edit-enroll="${e.id}">Düzenle</button>
        <button class="btn-outline" data-del-enroll="${e.id}">Sil</button>
      </td>
    </tr>`;
  });
  $('#enrollmentTable').innerHTML = table(
    [{label:'Öğrenci',key:'student'},{label:'Ders',key:'course'},{label:'Öğretmen',key:'teacher'},{label:'Başlangıç',key:'startDate'},{label:'Plan',key:'schedule'},{label:'Pay % (kayıt)',key:'shareOverride'},{label:''}],
    rows,'enrollments');
  $$('#enrollmentTable [data-edit-enroll]').forEach(b=>b.onclick=()=>openEnroll(byId(db.enrollments,b.dataset.editEnroll)));
  $$('#enrollmentTable [data-del-enroll]').forEach(b=>b.onclick=()=>{ if(confirm('Silinsin mi?')){
    db.enrollments = db.enrollments.filter(x=>x.id!==b.dataset.delEnroll);
    store.save(db); fsSaveCollection('enrollments'); renderAll(); } });
}
$('#enrollSearch')?.addEventListener('input', debounce(()=>renderEnrollments(),300));

function renderPayments(){
  const q = $('#paymentSearch').value?.toLowerCase() || '';
  const from = $('#payFrom').value ? new Date($('#payFrom').value) : null;
  const to   = $('#payTo').value ? new Date($('#payTo').value) : null;
  let arr = db.payments.filter(p=>{
    const s=byId(db.students,p.studentId)?.name||'';
    const c=byId(db.courses,p.courseId)?.title||'';
    const txt = `${s} ${c}`.toLowerCase();
    const d = new Date(p.date);
    return txt.includes(q) && (!from || d>=from) && (!to || d<=to);
  });
  const s = sortState.payments;
  arr = arr.sort((a,b)=> (a[s.key] > b[s.key] ? s.dir : -s.dir));
  const rows = arr.map(p=>{
    const s=byId(db.students,p.studentId)?.name||'-';
    const c=byId(db.courses,p.courseId)?.title||'-';
    return `<tr>
      <td>${p.date}</td><td>${s}</td><td>${c}</td><td>${p.method}</td><td>${TL(p.amount)}</td>
      <td class="row-actions">
        <button class="btn-outline" data-edit-payment="${p.id}">Düzenle</button>
        <button class="btn-outline" data-del-payment="${p.id}">Sil</button>
      </td>
    </tr>`;
  });
  $('#paymentTable').innerHTML = table(
    [{label:'Tarih',key:'date'},{label:'Öğrenci',key:'student'},{label:'Ders',key:'course'},{label:'Tip',key:'method'},{label:'Tutar',key:'amount'},{label:''}],
    rows,'payments');
  $$('#paymentTable [data-edit-payment]').forEach(b=>b.onclick=()=>openPayment(byId(db.payments,b.dataset.editPayment)));
  $$('#paymentTable [data-del-payment]').forEach(b=>b.onclick=()=>{ if(confirm('Silinsin mi?')){
    db.payments = db.payments.filter(x=>x.id!==b.dataset.delPayment);
    store.save(db); fsSaveCollection('payments'); renderAll(); } });
}
$('#paymentSearch')?.addEventListener('input', debounce(()=>renderPayments(),300));
$('#payFrom')?.addEventListener('change', ()=>renderPayments());
$('#payTo')?.addEventListener('change', ()=>renderPayments());

function renderPayouts(){
  const mo = $('#payoutMonth').value || monthKey(new Date());
  const totals = calcPayouts(mo);
  const rows = Object.entries(totals).map(([tid,amt])=>{
    const t = byId(db.teachers, tid);
    return `<tr><td>${t?.name||'-'}</td><td>${TL(amt)}</td></tr>`;
  });
  $('#payoutTable').innerHTML = table([{label:'Öğretmen'},{label:'Hakediş'}], rows);
}
$('#recalcPayouts').onclick=()=>renderPayouts();

/* =========================
   Forms & CRUD
   ========================= */
function openStudent(data){
  const dlg = $('#studentModal'), f = $('#studentForm');
  f.reset();
  if(data){ f.id.value=data.id; f.name.value=data.name; f.phone.value=data.phone||''; f.email.value=data.email||''; }
  dlg.showModal();
  dlg.addEventListener('close', saveStudent, {once:true});
}
function saveStudent(){
  const f = $('#studentForm'); if(f.returnValue==='cancel') return;
  const item = { id:f.id.value||uid(), name:f.name.value.trim(), phone:f.phone.value.trim(), email:f.email.value.trim() };
  if(!item.name) return;
  const i = db.students.findIndex(x=>x.id===item.id);
  if(i>-1) db.students[i]=item; else db.students.push(item);
  store.save(db); fsSaveCollection('students'); renderAll();
}
$('[data-open="studentModal"]').onclick=()=>openStudent();

function openTeacher(data){
  const dlg=$('#teacherModal'), f=$('#teacherForm'); f.reset();
  if(data){ f.id.value=data.id; f.name.value=data.name; f.expertise.value=data.expertise||''; f.share.value=(data.share ?? ''); }
  dlg.showModal();
  dlg.addEventListener('close', saveTeacher, {once:true});
}
function saveTeacher(){
  const f=$('#teacherForm'); if(f.returnValue==='cancel') return;
  const item={ id:f.id.value||uid(), name:f.name.value.trim(), expertise:f.expertise.value.trim(), share: f.share.value===''? null : Number(f.share.value) };
  if(!item.name) return;
  const i=db.teachers.findIndex(x=>x.id===item.id);
  if(i>-1) db.teachers[i]=item; else db.teachers.push(item);
  store.save(db); fsSaveCollection('teachers'); renderAll();
}
$('[data-open="teacherModal"]').onclick=()=>openTeacher();

function openCourse(data){
  const dlg=$('#courseModal'), f=$('#courseForm'); f.reset();
  if(data){ f.id.value=data.id; f.title.value=data.title; f.price.value=data.price; }
  dlg.showModal();
  dlg.addEventListener('close', saveCourse, {once:true});
}
function saveCourse(){
  const f=$('#courseForm'); if(f.returnValue==='cancel') return;
  const item={ id:f.id.value||uid(), title:f.title.value.trim(), price:Number(f.price.value||0) };
  if(!item.title) return;
  const i=db.courses.findIndex(x=>x.id===item.id);
  if(i>-1) db.courses[i]=item; else db.courses.push(item);
  store.save(db); fsSaveCollection('courses'); renderAll();
}
$('[data-open="courseModal"]').onclick=()=>openCourse();

function renderEnrollmentOptions(){
  const sf=$('#enrollForm'); const pf=$('#paymentForm');
  sf.studentId.innerHTML = db.students.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  sf.teacherId.innerHTML = db.teachers.map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
  sf.courseId.innerHTML = db.courses.map(c=>`<option value="${c.id}">${c.title}</option>`).join('');
  pf.studentId.innerHTML = db.students.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  pf.courseId.innerHTML = db.courses.map(c=>`<option value="${c.id}">${c.title}</option>`).join('');
}
function openEnroll(data){
  const dlg=$('#enrollModal'), f=$('#enrollForm'); f.reset(); renderEnrollmentOptions();
  if(data){ f.id.value=data.id; f.studentId.value=data.studentId; f.teacherId.value=data.teacherId; f.courseId.value=data.courseId; f.startDate.value=data.startDate||''; f.schedule.value=data.schedule||''; f.shareOverride.value=(data.shareOverride ?? ''); }
  dlg.showModal();
  dlg.addEventListener('close', saveEnroll, {once:true});
}
function saveEnroll(){
  const f=$('#enrollForm'); if(f.returnValue==='cancel') return;
  const item={ id:f.id.value||uid(), studentId:f.studentId.value, teacherId:f.teacherId.value, courseId:f.courseId.value, startDate:f.startDate.value, schedule:f.schedule.value.trim(), shareOverride: f.shareOverride.value===''? null : Number(f.shareOverride.value) };
  const i=db.enrollments.findIndex(x=>x.id===item.id);
  if(i>-1) db.enrollments[i]=item; else db.enrollments.push(item);
  store.save(db); fsSaveCollection('enrollments'); renderAll();
}
$('[data-open="enrollModal"]').onclick=()=>openEnroll();

function openPayment(data){
  const dlg=$('#paymentModal'), f=$('#paymentForm'); f.reset(); renderEnrollmentOptions();
  if(data){ f.id.value=data.id; f.studentId.value=data.studentId; f.courseId.value=data.courseId; f.amount.value=data.amount; f.date.value=data.date; f.method.value=data.method; }
  dlg.showModal();
  dlg.addEventListener('close', savePayment, {once:true});
}
function savePayment(){
  const f=$('#paymentForm'); if(f.returnValue==='cancel') return;
  const item={ id:f.id.value||uid(), studentId:f.studentId.value, courseId:f.courseId.value, amount:Number(f.amount.value||0), date:f.date.value, method:f.method.value };
  const i=db.payments.findIndex(x=>x.id===item.id);
  if(i>-1) db.payments[i]=item; else db.payments.push(item);
  store.save(db); fsSaveCollection('payments'); renderAll();
}
$('[data-open="paymentModal"]').onclick=()=>openPayment();

/* =========================
   Settings + Import/Export + Init
   ========================= */
function renderSettings(){
  const f=$('#settingsForm');
  f.academyName.value = db.settings.academyName;
  f.defaultShare.value = db.settings.defaultShare;
  f.useFirebase.value = db.settings.useFirebase||"no";
  f.apiKey.value = db.settings.firebase.apiKey||"";
  f.authDomain.value = db.settings.firebase.authDomain||"";
  f.projectId.value = db.settings.firebase.projectId||"";
  f.appId.value = db.settings.firebase.appId||"";
  f.onsubmit = async (e)=>{
    e.preventDefault();
    db.settings.academyName = f.academyName.value || "Dilara Pak Sanat Akademi";
    db.settings.defaultShare = Number(f.defaultShare.value||50);
    db.settings.useFirebase = f.useFirebase.value;
    db.settings.firebase = { apiKey:f.apiKey.value, authDomain:f.authDomain.value, projectId:f.projectId.value, appId:f.appId.value };
    store.save(db);
    if(db.settings.useFirebase==="yes"){ await tryInitFirebase(); await fsSaveCollection('settings'); }
    alert('Ayarlar kaydedildi');
  };
  $('#exportJson').onclick=()=>{
    const blob = new Blob([JSON.stringify(db,null,2)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'dpsa-backup.json'; a.click();
  };
  $('#importJson').onchange=(e)=>{
    const file = e.target.files?.[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = async ()=>{
      try{
        const obj = JSON.parse(reader.result);
        db = Object.assign(dataShape(), obj);
        store.save(db);
        if(db.settings.useFirebase==="yes"){ await tryInitFirebase(); ['students','teachers','courses','enrollments','payments','settings'].forEach(fsSaveCollection); }
        renderAll();
        alert('İçe aktarıldı');
      }catch(err){ alert('Geçersiz JSON'); }
    };
    reader.readAsText(file);
  };
}

/* Re-render */
function renderAll(){
  renderStats();
  renderStudents();
  renderTeachers();
  renderCourses();
  renderEnrollments();
  renderPayments();
  renderPayouts();
  renderSettings();
}
tryInitFirebase(); // if enabled in settings
