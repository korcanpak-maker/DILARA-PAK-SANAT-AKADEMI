
/* Simple SPA with hash routing + localStorage persistence */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

const store = {
  key: 'dpsa_data_v1',
  load(){
    try { return JSON.parse(localStorage.getItem(this.key)) || this.blank(); }
    catch(e){ return this.blank(); }
  },
  save(d){ localStorage.setItem(this.key, JSON.stringify(d)); },
  blank(){
    return {
      settings: { defaultShare: 50, academyName: "Dilara Pak Sanat Akademi" },
      students: [], teachers: [], courses: [],
      enrollments: [], // {id, studentId, teacherId, courseId, schedule}
      payments: []     // {id, studentId, courseId, amount, date, method}
    };
  }
};

let db = store.load();
$('#year').textContent = new Date().getFullYear();

/* Routing */
function showPage(hash){
  const target = (hash || location.hash || '#dashboard').split('?')[0];
  $$('.page').forEach(p => p.classList.add('hidden'));
  $$('.tabs .tab').forEach(a => a.classList.remove('active'));
  $(target)?.classList.remove('hidden');
  $(`.tabs .tab[href="${target}"]`)?.classList.add('active');
  renderAll();
}
window.addEventListener('hashchange', () => showPage(location.hash));
showPage(location.hash);

/* Helpers */
const uid = () => Math.random().toString(36).slice(2,10);
const byId = (arr, id) => arr.find(x => x.id === id);
function confirmDelete(cb){ if (confirm('Silmek istediğine emin misin?')) cb(); }

function formatTL(n){ return new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'}).format(Number(n||0)); }

/* Stats */
function renderStats(){
  const total = db.students.length;
  const tCount = db.teachers.length;
  const cCount = db.courses.length;
  const paid = db.payments.reduce((s,p)=>s+Number(p.amount||0),0);
  $('#stats').innerHTML = `
    <div class="card"><strong>Öğrenci</strong><div>${total}</div></div>
    <div class="card"><strong>Öğretmen</strong><div>${tCount}</div></div>
    <div class="card"><strong>Ders</strong><div>${cCount}</div></div>
    <div class="card"><strong>Toplam Tahsilat</strong><div>${formatTL(paid)}</div></div>
  `;
}

/* Tables */
function table(headers, rows){
  return `<table class="table">
    <thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('') || `<tr><td colspan="${headers.length}"><i>Boş</i></td></tr>`}</tbody>
  </table>`;
}

/* Students */
function renderStudents(){
  const rows = db.students.map(s=>`
    <tr>
      <td>${s.name}</td><td>${s.phone||''}</td><td>${s.email||''}</td>
      <td class="row-actions">
        <button class="btn-outline" data-edit-student="${s.id}">Düzenle</button>
        <button class="btn-outline" data-del-student="${s.id}">Sil</button>
      </td>
    </tr>`);
  $('#studentTable').innerHTML = table(['Ad Soyad','Telefon','E-posta',''], rows);
  // actions
  $$('#studentTable [data-edit-student]').forEach(b=>b.onclick=()=>openStudent(byId(db.students,b.dataset.editStudent)));
  $$('#studentTable [data-del-student]').forEach(b=>b.onclick=()=>confirmDelete(()=>{
    db.enrollments = db.enrollments.filter(e=>e.studentId!==b.dataset.delStudent);
    db.payments = db.payments.filter(p=>p.studentId!==b.dataset.delStudent);
    db.students = db.students.filter(s=>s.id!==b.dataset.delStudent);
    store.save(db); renderAll();
  }));
}
function openStudent(data){
  const dlg = $('#studentModal'), f = $('#studentForm');
  f.reset();
  if(data){ f.id.value=data.id; f.name.value=data.name; f.phone.value=data.phone||''; f.email.value=data.email||''; }
  dlg.showModal();
  dlg.addEventListener('close', saveStudent, {once:true});
}
function saveStudent(){
  const f = $('#studentForm');
  if(f.returnValue==='cancel') return;
  const item = { id: f.id.value || uid(), name: f.name.value.trim(), phone: f.phone.value.trim(), email: f.email.value.trim() };
  if(!item.name) return;
  const i = db.students.findIndex(x=>x.id===item.id);
  if(i>-1) db.students[i]=item; else db.students.push(item);
  store.save(db); renderAll();
}
$('[data-open="studentModal"]').onclick = ()=>openStudent();

/* Teachers */
function renderTeachers(){
  const rows = db.teachers.map(t=>`
    <tr>
      <td>${t.name}</td><td>${t.expertise||''}</td><td>${(t.share ?? '')}</td>
      <td class="row-actions">
        <button class="btn-outline" data-edit-teacher="${t.id}">Düzenle</button>
        <button class="btn-outline" data-del-teacher="${t.id}">Sil</button>
      </td>
    </tr>`);
  $('#teacherTable').innerHTML = table(['Ad Soyad','Uzmanlık','Pay (%)',''], rows);
  $$('#teacherTable [data-edit-teacher]').forEach(b=>b.onclick=()=>openTeacher(byId(db.teachers,b.dataset.editTeacher)));
  $$('#teacherTable [data-del-teacher]').forEach(b=>b.onclick=()=>confirmDelete(()=>{
    db.enrollments = db.enrollments.filter(e=>e.teacherId!==b.dataset.delTeacher);
    db.teachers = db.teachers.filter(t=>t.id!==b.dataset.delTeacher);
    store.save(db); renderAll();
  }));
}
function openTeacher(data){
  const dlg = $('#teacherModal'), f = $('#teacherForm'); f.reset();
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
  store.save(db); renderAll();
}
$('[data-open="teacherModal"]').onclick=()=>openTeacher();

/* Courses */
function renderCourses(){
  const rows = db.courses.map(c=>`
    <tr>
      <td>${c.title}</td><td>${formatTL(c.price)}</td>
      <td class="row-actions">
        <button class="btn-outline" data-edit-course="${c.id}">Düzenle</button>
        <button class="btn-outline" data-del-course="${c.id}">Sil</button>
      </td>
    </tr>`);
  $('#courseTable').innerHTML = table(['Ders','Ücret (Aylık)',''], rows);
  $$('#courseTable [data-edit-course]').forEach(b=>b.onclick=()=>openCourse(byId(db.courses,b.dataset.editCourse)));
  $$('#courseTable [data-del-course]').forEach(b=>b.onclick=()=>confirmDelete(()=>{
    db.enrollments = db.enrollments.filter(e=>e.courseId!==b.dataset.delCourse);
    db.payments = db.payments.filter(p=>p.courseId!==b.dataset.delCourse);
    db.courses = db.courses.filter(c=>c.id!==b.dataset.delCourse);
    store.save(db); renderAll();
  }));
}
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
  store.save(db); renderAll();
}
$('[data-open="courseModal"]').onclick=()=>openCourse();

/* Enrollments */
function renderEnrollmentOptions(){
  const sf=$('#enrollForm'); const pf=$('#paymentForm');
  sf.studentId.innerHTML = db.students.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  sf.teacherId.innerHTML = db.teachers.map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
  sf.courseId.innerHTML = db.courses.map(c=>`<option value="${c.id}">${c.title}</option>`).join('');
  pf.studentId.innerHTML = db.students.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  pf.courseId.innerHTML = db.courses.map(c=>`<option value="${c.id}">${c.title}</option>`).join('');
}
function renderEnrollments(){
  renderEnrollmentOptions();
  const rows = db.enrollments.map(e=>{
    const s=byId(db.students,e.studentId)?.name||'-';
    const c=byId(db.courses,e.courseId)?.title||'-';
    const t=byId(db.teachers,e.teacherId)?.name||'-';
    return `<tr>
      <td>${s}</td><td>${c}</td><td>${t}</td><td>${e.schedule||''}</td>
      <td class="row-actions">
        <button class="btn-outline" data-edit-enroll="${e.id}">Düzenle</button>
        <button class="btn-outline" data-del-enroll="${e.id}">Sil</button>
      </td>
    </tr>`;
  });
  $('#enrollmentTable').innerHTML = table(['Öğrenci','Ders','Öğretmen','Plan',''], rows);
  $$('#enrollmentTable [data-edit-enroll]').forEach(b=>b.onclick=()=>openEnroll(byId(db.enrollments,b.dataset.editEnroll)));
  $$('#enrollmentTable [data-del-enroll]').forEach(b=>b.onclick=()=>confirmDelete(()=>{
    db.enrollments = db.enrollments.filter(x=>x.id!==b.dataset.delEnroll);
    store.save(db); renderAll();
  }));
}
function openEnroll(data){
  const dlg=$('#enrollModal'), f=$('#enrollForm'); f.reset(); renderEnrollmentOptions();
  if(data){ f.id.value=data.id; f.studentId.value=data.studentId; f.teacherId.value=data.teacherId; f.courseId.value=data.courseId; f.schedule.value=data.schedule||''; }
  dlg.showModal();
  dlg.addEventListener('close', saveEnroll, {once:true});
}
function saveEnroll(){
  const f=$('#enrollForm'); if(f.returnValue==='cancel') return;
  const item={ id:f.id.value||uid(), studentId:f.studentId.value, teacherId:f.teacherId.value, courseId:f.courseId.value, schedule:f.schedule.value.trim() };
  const i=db.enrollments.findIndex(x=>x.id===item.id);
  if(i>-1) db.enrollments[i]=item; else db.enrollments.push(item);
  store.save(db); renderAll();
}
$('[data-open="enrollModal"]').onclick=()=>openEnroll();

/* Payments */
function renderPayments(){
  const rows = db.payments.map(p=>{
    const s=byId(db.students,p.studentId)?.name||'-';
    const c=byId(db.courses,p.courseId)?.title||'-';
    return `<tr>
      <td>${p.date}</td><td>${s}</td><td>${c}</td><td>${p.method}</td><td>${formatTL(p.amount)}</td>
      <td class="row-actions">
        <button class="btn-outline" data-edit-payment="${p.id}">Düzenle</button>
        <button class="btn-outline" data-del-payment="${p.id}">Sil</button>
      </td>
    </tr>`;
  });
  $('#paymentTable').innerHTML = table(['Tarih','Öğrenci','Ders','Tip','Tutar',''], rows);
  $$('#paymentTable [data-edit-payment]').forEach(b=>b.onclick=()=>openPayment(byId(db.payments,b.dataset.editPayment)));
  $$('#paymentTable [data-del-payment]').forEach(b=>b.onclick=()=>confirmDelete(()=>{
    db.payments = db.payments.filter(x=>x.id!==b.dataset.delPayment);
    store.save(db); renderAll();
  }));
}
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
  store.save(db); renderAll();
}
$('[data-open="paymentModal"]').onclick=()=>openPayment();

/* Payouts calculation */
function calcPayouts(){
  // Aggregate payments per (teacher, course)
  const map = new Map();
  for(const e of db.enrollments){
    // find payments for this student-course pair
    const relatedPayments = db.payments.filter(p=>p.courseId===e.courseId && db.students.some(s=>s.id===p.studentId));
  }
  // Simpler: distribute payments by course; teacher gets share for enrollments on that course.
  // For each payment: find enrollments of that student for that course -> pay teacher(s) by share.
  const payouts = {}; // key `${teacherId}` -> amount
  for(const p of db.payments){
    const relEnrolls = db.enrollments.filter(e=>e.studentId===p.studentId && e.courseId===p.courseId);
    if(relEnrolls.length===0) continue;
    const perEnroll = p.amount / relEnrolls.length;
    for(const e of relEnrolls){
      const t = byId(db.teachers,e.teacherId);
      const share = (t?.share ?? db.settings.defaultShare)/100;
      payouts[e.teacherId] = (payouts[e.teacherId]||0) + perEnroll*share;
    }
  }
  return payouts;
}
function renderPayouts(){
  const payouts = calcPayouts();
  const rows = Object.entries(payouts).map(([tid, amt])=>{
    const t=byId(db.teachers,tid);
    return `<tr><td>${t?.name||'-'}</td><td>${formatTL(amt)}</td></tr>`;
  });
  $('#payoutTable').innerHTML = table(['Öğretmen','Hakediş (Hesaplanan)'], rows);
}
$('#recalcPayouts').onclick=()=>renderPayouts();

/* Settings */
function renderSettings(){
  const f=$('#settingsForm');
  f.defaultShare.value = db.settings.defaultShare;
  f.academyName.value = db.settings.academyName;
  f.onsubmit = (e)=>{
    e.preventDefault();
    db.settings.defaultShare = Number(f.defaultShare.value||50);
    db.settings.academyName = f.academyName.value || "Dilara Pak Sanat Akademi";
    store.save(db);
    alert('Ayarlar kaydedildi');
  };
}

/* Render all */
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

/* Open modal buttons */
$$('[data-open]').forEach(b=>b.onclick=()=>{
  const id = b.getAttribute('data-open'); $(`#${id}`).showModal();
});
