// Mobile menu toggle
const menuBtn = document.getElementById('menuBtn');
const nav = document.getElementById('nav');

menuBtn?.addEventListener('click', () => {
  nav.classList.toggle('open');
});

// Smooth scroll for internal links
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const href = a.getAttribute('href');
    if (href && href.startsWith('#')) {
      e.preventDefault();
      document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      nav.classList.remove('open');
    }
  });
});

// Year in footer
document.getElementById('year').textContent = new Date().getFullYear();

// Basic client-side validation before submit (enhancement)
const form = document.getElementById('contactForm');
form?.addEventListener('submit', (e) => {
  const required = form.querySelectorAll('[required]');
  let ok = true;
  required.forEach(el => { if (!el.value.trim()) ok = false; });
  if (!ok) {
    e.preventDefault();
    alert('Lütfen gerekli alanları doldurun.');
  }
});
