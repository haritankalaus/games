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

const rocketScene = document.querySelector('.rocket-scene');
const rocketVehicle = document.querySelector('.rocket-vehicle');
let rocketFlight = null;
let launchTimer = null;
function cornerTransform() {
  const scene = rocketScene.getBoundingClientRect();
  return `translate(${Math.max(0, innerWidth - scene.left - scene.width - 18)}px, ${24 - (scene.bottom - rocketVehicle.offsetHeight - 10)}px) rotate(25deg) scale(.55)`;
}
function dockRocket() {
  rocketScene.className = 'rocket-scene docked';
  rocketVehicle.style.transform = cornerTransform();
}
function launchRocket() {
  rocketFlight?.cancel();
  clearTimeout(launchTimer);
  rocketVehicle.style.transform = '';
  if (reducedMotion.matches) { dockRocket(); return; }
  rocketScene.className = 'rocket-scene preparing';
  launchTimer = setTimeout(() => {
    rocketScene.className = 'rocket-scene flying';
    const box = rocketScene.getBoundingClientRect();
    const dx = Math.max(0, innerWidth - box.left - box.width - 18);
    const dy = 24 - (box.bottom - rocketVehicle.offsetHeight - 10);
    rocketFlight = rocketVehicle.animate([
      { transform: 'translate(0,0) rotate(0deg) scale(1)', offset: 0 },
      { transform: 'translate(0,-65px) rotate(0deg) scale(1)', offset: .2 },
      { transform: `translate(${dx * .35}px,${dy * .7}px) rotate(40deg) scale(.85)`, offset: .6 },
      { transform: cornerTransform(), offset: 1 }
    ], { duration: 2400, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards' });
    rocketFlight.onfinish = () => { rocketFlight.cancel(); dockRocket(); };
  }, 1600);
}
launchTimer = setTimeout(launchRocket, 700);
window.addEventListener('resize', () => {
  if (rocketScene.classList.contains('docked')) rocketVehicle.style.transform = cornerTransform();
});
