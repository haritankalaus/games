'use strict';
const cards = [...document.querySelectorAll('.game-card')];
const filters = [...document.querySelectorAll('.filter')];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
filters.forEach(button => button.addEventListener('click', () => {
  filters.forEach(filter => {
    const active = filter === button;
    filter.classList.toggle('active', active);
    filter.setAttribute('aria-pressed', String(active));
  });
  cards.forEach(card => { card.hidden = button.dataset.filter !== 'all' && card.dataset.category !== button.dataset.filter; });
  const count = cards.filter(card => !card.hidden).length;
  document.querySelector('#filter-status').textContent = `Showing ${count} ${count === 1 ? 'game' : 'games'}.`;
}));
document.querySelector('#surprise').addEventListener('click', event => {
  const choices = cards.filter(card => !card.hidden);
  const card = choices[Math.floor(Math.random() * choices.length)];
  const url = card.querySelector('.play').getAttribute('href');
  event.currentTarget.disabled = true;
  event.currentTarget.textContent = `Let's play ${card.querySelector('h3').textContent}!`;
  if (!reducedMotion.matches) {
    const container = document.querySelector('#confetti');
    for (let i = 0; i < 36; i++) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = ['#d4ff79', '#ff98cf', '#c5b5ff', '#fffaf0'][i % 4];
      piece.style.setProperty('--drift', `${Math.random() * 180 - 90}px`);
      piece.style.animationDelay = `${Math.random() * .2}s`;
      container.append(piece);
    }
  }
  setTimeout(() => { window.location.href = url; }, reducedMotion.matches ? 0 : 850);
});
