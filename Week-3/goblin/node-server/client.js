document.getElementById('fetchBtn').addEventListener('click', async () => {
  const responseDiv = document.getElementById('response');
  responseDiv.textContent = '요청 중...';

  try {
    const res = await fetch('/api/hello');
    const data = await res.json();
    responseDiv.textContent = `서버 응답: ${data.message} (시간: ${data.timestamp})`;
  } catch (err) {
    responseDiv.textContent = `오류 발생: ${err.message}`;
  }
});
