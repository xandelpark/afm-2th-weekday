const http = require('http');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const SYSTEM_PROMPT = `당신은 따뜻하고 공감 능력이 뛰어난 심리상담사입니다.
- 내담자의 이야기에 경청하고 공감해주세요.
- 판단하지 않고, 있는 그대로 받아들여주세요.
- 적절한 질문으로 내담자가 스스로 감정을 탐색할 수 있도록 도와주세요.
- 답변은 간결하고 따뜻하게 해주세요.
- 위기 상황(자해, 자살 등)이 감지되면 전문 상담 기관(자살예방상담전화 1393, 정신건강위기상담전화 1577-0199)을 안내해주세요.`;

const HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI 심리상담</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f0f2f5;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: #6c5ce7;
      color: white;
      padding: 16px 20px;
      text-align: center;
      font-size: 18px;
      font-weight: 600;
    }
    #chat {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .msg {
      max-width: 75%;
      padding: 12px 16px;
      border-radius: 18px;
      line-height: 1.5;
      font-size: 15px;
      white-space: pre-wrap;
    }
    .assistant {
      align-self: flex-start;
      background: white;
      color: #333;
      border-bottom-left-radius: 4px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    }
    .user {
      align-self: flex-end;
      background: #6c5ce7;
      color: white;
      border-bottom-right-radius: 4px;
    }
    .typing {
      align-self: flex-start;
      background: white;
      padding: 12px 20px;
      border-radius: 18px;
      font-size: 20px;
      letter-spacing: 3px;
      color: #999;
    }
    #input-area {
      padding: 12px 16px;
      background: white;
      border-top: 1px solid #ddd;
      display: flex;
      gap: 10px;
    }
    #input {
      flex: 1;
      padding: 12px 16px;
      border: 1px solid #ddd;
      border-radius: 24px;
      font-size: 15px;
      outline: none;
    }
    #input:focus { border-color: #6c5ce7; }
    #send {
      padding: 10px 20px;
      background: #6c5ce7;
      color: white;
      border: none;
      border-radius: 24px;
      font-size: 15px;
      cursor: pointer;
    }
    #send:disabled { background: #b8b5d4; cursor: default; }
  </style>
</head>
<body>
  <header>AI 심리상담</header>
  <div id="chat">
    <div class="msg assistant">안녕하세요, 저는 AI 심리상담사입니다. 편하게 이야기해 주세요. 오늘 기분이 어떠신가요?</div>
  </div>
  <div id="input-area">
    <input id="input" placeholder="메시지를 입력하세요..." autocomplete="off">
    <button id="send">전송</button>
  </div>
  <script>
    const chat = document.getElementById('chat');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const messages = [
      { role: 'assistant', content: '안녕하세요, 저는 AI 심리상담사입니다. 편하게 이야기해 주세요. 오늘 기분이 어떠신가요?' }
    ];
    let sending = false;

    function addMsg(role, text) {
      const div = document.createElement('div');
      div.className = 'msg ' + role;
      div.textContent = text;
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
      return div;
    }

    async function send() {
      const text = input.value.trim();
      if (!text || sending) return;
      sending = true;
      input.value = '';
      sendBtn.disabled = true;

      addMsg('user', text);
      messages.push({ role: 'user', content: text });

      const typing = document.createElement('div');
      typing.className = 'typing';
      typing.textContent = '...';
      chat.appendChild(typing);
      chat.scrollTop = chat.scrollHeight;

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages })
        });
        const data = await res.json();
        typing.remove();

        const reply = data.reply || '죄송합니다, 잠시 후 다시 시도해주세요.';
        addMsg('assistant', reply);
        messages.push({ role: 'assistant', content: reply });
      } catch (e) {
        typing.remove();
        addMsg('assistant', '오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      }
      sendBtn.disabled = false;
      sending = false;
      input.focus();
    }

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    input.focus();
  </script>
</body>
</html>`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function callOpenAI(messages) {
  const payload = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages
    ],
    max_tokens: 500,
    temperature: 0.8
  });

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: payload
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    try {
      const body = JSON.parse(await readBody(req));
      const reply = await callOpenAI(body.messages);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reply }));
    } catch (err) {
      console.error('OpenAI 오류:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reply: '죄송합니다, 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`AI 심리상담 서버 실행 중: http://localhost:${PORT}`);
});
