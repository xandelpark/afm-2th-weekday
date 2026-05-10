// ===== 상태 관리 =====
let isGenerating = false;
let history = [];

// ===== DOM 요소 =====
const $ = (sel) => document.querySelector(sel);
const promptInput = $('#prompt-input');
const generateBtn = $('#generate-btn');
const modelSelect = $('#model-select');
const sizeSelect = $('#size-select');
const stepsInput = $('#steps-input');
const guidanceInput = $('#guidance-input');
const seedInput = $('#seed-input');
const resultArea = $('#result-area');
const historyList = $('#history-list');
const clearHistoryBtn = $('#clear-history-btn');
const spinner = $('#spinner');
const statusText = $('#status-text');
const advancedToggle = $('#advanced-toggle');
const advancedPanel = $('#advanced-panel');

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', () => {
  loadHistory();
  setupEventListeners();
});

function setupEventListeners() {
  generateBtn.addEventListener('click', handleGenerate);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  });
  clearHistoryBtn.addEventListener('click', handleClearHistory);
  advancedToggle.addEventListener('click', () => {
    advancedPanel.classList.toggle('hidden');
    const arrow = advancedToggle.querySelector('.arrow');
    arrow.textContent = advancedPanel.classList.contains('hidden') ? '▶' : '▼';
  });
}

// ===== 이미지 생성 =====
async function handleGenerate() {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    showStatus('프롬프트를 입력해주세요.', 'error');
    promptInput.focus();
    return;
  }
  if (isGenerating) return;

  isGenerating = true;
  generateBtn.disabled = true;
  spinner.classList.remove('hidden');
  resultArea.innerHTML = '';
  showStatus('이미지를 생성하고 있습니다... (약 10~30초 소요)', 'loading');

  const body = {
    prompt,
    model: modelSelect.value,
    image_size: sizeSelect.value,
    num_inference_steps: parseInt(stepsInput.value) || 28,
    guidance_scale: parseFloat(guidanceInput.value) || 3.5,
    num_images: 1
  };
  const seedVal = seedInput.value.trim();
  if (seedVal) body.seed = parseInt(seedVal);

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await res.json();

    if (!json.success) {
      showStatus(`오류: ${json.message}`, 'error');
      return;
    }

    renderResult(json.data);
    showStatus('이미지가 생성되었습니다!', 'success');
    loadHistory();
  } catch (err) {
    showStatus(`네트워크 오류: ${err.message}`, 'error');
  } finally {
    isGenerating = false;
    generateBtn.disabled = false;
    spinner.classList.add('hidden');
  }
}

// ===== 결과 렌더링 =====
function renderResult(record) {
  resultArea.innerHTML = '';
  if (!record.images || record.images.length === 0) {
    resultArea.innerHTML = '<p class="no-result">생성된 이미지가 없습니다.</p>';
    return;
  }

  record.images.forEach((img) => {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.innerHTML = `
      <img src="${img.url}" alt="${record.prompt}" loading="lazy" />
      <div class="result-info">
        <p class="result-prompt">${escapeHtml(record.prompt)}</p>
        <p class="result-meta">${img.width}×${img.height} · seed: ${record.seed ?? 'random'}</p>
        <a href="${img.url}" target="_blank" class="download-btn">원본 보기 ↗</a>
      </div>
    `;
    resultArea.appendChild(card);
  });
}

// ===== 히스토리 =====
async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    const json = await res.json();
    if (json.success) {
      history = json.data;
      renderHistory();
    }
  } catch (err) {
    // 무시
  }
}

function renderHistory() {
  if (history.length === 0) {
    historyList.innerHTML = '<p class="empty-history">아직 생성된 이미지가 없습니다.</p>';
    return;
  }

  historyList.innerHTML = history.map((item) => `
    <div class="history-item" data-id="${item.id}">
      <img src="${item.images[0]?.url || ''}" alt="" class="history-thumb" loading="lazy" />
      <div class="history-info">
        <p class="history-prompt">${escapeHtml(item.prompt)}</p>
        <span class="history-time">${formatTime(item.createdAt)}</span>
      </div>
      <button class="history-delete" onclick="deleteHistoryItem(${item.id})">✕</button>
    </div>
  `).join('');

  // 히스토리 아이템 클릭하면 프롬프트 복사
  historyList.querySelectorAll('.history-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('history-delete')) return;
      const id = Number(el.dataset.id);
      const item = history.find((h) => h.id === id);
      if (item) {
        promptInput.value = item.prompt;
        renderResult(item);
        promptInput.focus();
      }
    });
  });
}

async function deleteHistoryItem(id) {
  try {
    await fetch(`/api/history/${id}`, { method: 'DELETE' });
    loadHistory();
  } catch (err) {
    // 무시
  }
}

async function handleClearHistory() {
  if (!confirm('모든 히스토리를 삭제하시겠습니까?')) return;
  try {
    await fetch('/api/history', { method: 'DELETE' });
    resultArea.innerHTML = '';
    loadHistory();
  } catch (err) {
    // 무시
  }
}

// ===== 유틸 =====
function showStatus(msg, type) {
  statusText.textContent = msg;
  statusText.className = `status-text ${type}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
