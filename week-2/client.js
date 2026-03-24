const bike = document.getElementById('bike');
const smoke = document.getElementById('smoke');

// 오토바이 흔들림 애니메이션
function shakeBike(time) {
  const y = Math.sin(time / 80) * 3;
  const rotate = Math.sin(time / 120) * 5;
  bike.style.transform = `translateY(${y}px) rotate(${rotate}deg)`;
  requestAnimationFrame(shakeBike);
}

// 연기 파티클 생성
function createSmoke() {
  const particle = document.createElement('span');
  particle.textContent = '💨';
  particle.style.cssText = `
    position: absolute;
    font-size: 14px;
    opacity: 0.8;
    top: 50%;
    left: 0;
    transform: translateY(-50%);
    transition: all 0.8s ease-out;
    pointer-events: none;
  `;
  smoke.appendChild(particle);

  requestAnimationFrame(() => {
    const randomY = (Math.random() - 0.5) * 20;
    particle.style.transform = `translate(${-30 - Math.random() * 20}px, ${randomY}px) scale(${0.5 + Math.random() * 0.8})`;
    particle.style.opacity = '0';
  });

  setTimeout(() => particle.remove(), 800);
}

// 페이지 로드 시 바로 시작
requestAnimationFrame(shakeBike);
setInterval(createSmoke, 150);
