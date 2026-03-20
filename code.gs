// ============================================================
//  書單分析工具 — Google Apps Script 後端 (code.gs)
//  部署方式：擴充功能 → Apps Script → 貼上此程式碼
//            → 部署 → 新增部署 → 網頁應用程式
//            → 執行身份：我 ／ 存取權：所有人
// ============================================================

// ▼▼▼ 填入你的 Gemini API Key ▼▼▼
const GEMINI_API_KEY = 'AIzaSyCpJLTYfE84zttQZBhwmcRB94j6FW_FP0Q';
// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

const SHEET_NAME    = '書單';          // 工作表名稱，請勿修改（與試算表一致）
const GEMINI_MODEL  = 'gemini-2.5-flash'; // 可改成 gemini-2.5-flash-lite 節省配額

// ─────────────────────────────────────────────────────────────
//  doGet：前端呼叫入口（使用 GET + query string）
// ─────────────────────────────────────────────────────────────
function doGet(e) {
  const action = e.parameter.action;
  let result;

  try {
    const books = getBooksData();

    if (!books || books.length === 0) {
      result = { error: '試算表中沒有書籍資料，請先在「書單」工作表填入資料。' };
    } else if (action === 'analyzePersonality') {
      result = analyzeReadingPersonality(books);
    } else if (action === 'recommend') {
      result = recommendNextBook(books);
    } else if (action === 'findBlindSpots') {
      result = findReadingBlindSpots(books);
    } else {
      result = { error: '未知的 action 參數：' + action };
    }
  } catch (err) {
    result = { error: '發生錯誤：' + err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────
//  從試算表讀取書籍資料
//  欄位順序：書名(A) | 類別(B) | 評分(C) | 狀態(D)
// ─────────────────────────────────────────────────────────────
function getBooksData() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('找不到工作表「' + SHEET_NAME + '」，請確認名稱是否正確。');

  const data  = sheet.getDataRange().getValues();
  const books = [];

  for (let i = 1; i < data.length; i++) {          // 第一列為標題，從第二列讀起
    const title = String(data[i][0]).trim();
    if (!title) continue;                            // 跳過空列
    books.push({
      title:    title,
      category: String(data[i][1]).trim(),
      rating:   Number(data[i][2]),
      status:   String(data[i][3]).trim()
    });
  }
  return books;
}

// ─────────────────────────────────────────────────────────────
//  呼叫 Gemini API
// ─────────────────────────────────────────────────────────────
function callGemini(prompt) {
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    GEMINI_MODEL + ':generateContent?key=' + GEMINI_API_KEY;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.75, maxOutputTokens: 1024 }
  };

  const options = {
    method:             'post',
    contentType:        'application/json',
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const json     = JSON.parse(response.getContentText());
  if (json.error) throw new Error(json.error.message);

  return json.candidates[0].content.parts[0].text;
}

// ─────────────────────────────────────────────────────────────
//  分析 1：閱讀性格
// ─────────────────────────────────────────────────────────────
function analyzeReadingPersonality(books) {
  const bookList = books
    .map(b => `《${b.title}》— 類別：${b.category}，評分：${b.rating} 分`)
    .join('\n');

  const prompt =
    `以下是我讀過的書單：\n\n${bookList}\n\n` +
    `請根據這份書單，分析我的閱讀性格，包含：\n` +
    `1. 我偏好哪些知識領域和類型\n` +
    `2. 從評分看出我的閱讀品味與挑剔程度\n` +
    `3. 用一個生動的「讀者人設」來形容我（例如：探索型實踐者、情感型思考者…）\n\n` +
    `請用繁體中文回答，語氣親切自然，分段清楚，約 250 字。`;

  return { result: callGemini(prompt) };
}

// ─────────────────────────────────────────────────────────────
//  分析 2：推薦下一本書
// ─────────────────────────────────────────────────────────────
function recommendNextBook(books) {
  const highRated = books.filter(b => b.rating >= 4)
    .map(b => `《${b.title}》(${b.category}, ${b.rating}分)`).join('、');
  const lowRated  = books.filter(b => b.rating <= 3)
    .map(b => `《${b.title}》(${b.category}, ${b.rating}分)`).join('、');

  const prompt =
    `根據我的閱讀紀錄：\n\n` +
    `✅ 喜歡（評分 4–5 分）：${highRated || '無'}\n` +
    `⚠️ 普通（評分 1–3 分）：${lowRated  || '無'}\n\n` +
    `請推薦 3 本我下一步應該讀的真實書籍，要求：\n` +
    `- 符合我的閱讀偏好，或能適度拓展我的視野\n` +
    `- 每本書列出：書名、作者、推薦理由（2–3 句）\n` +
    `- 說明為什麼這本書特別適合我\n\n` +
    `請用繁體中文回答，語氣親切。`;

  return { result: callGemini(prompt) };
}

// ─────────────────────────────────────────────────────────────
//  分析 3：閱讀盲點
// ─────────────────────────────────────────────────────────────
function findReadingBlindSpots(books) {
  const readCategories = [...new Set(books.map(b => b.category).filter(c => c))];

  const allCategories = [
    '自我成長', '心理', '工作效率', '歷史', '科學', '商業',
    '哲學', '文學小說', '科技', '健康', '財經投資', '社會學', '傳記'
  ];

  const unread = allCategories.filter(c => !readCategories.includes(c));

  const prompt =
    `我已閱讀的書籍類別：${readCategories.join('、')}\n\n` +
    `我從未涉獵的常見類別：${unread.length > 0 ? unread.join('、') : '幾乎全覆蓋了！'}\n\n` +
    `請分析我的閱讀盲點：\n` +
    `1. 哪些知識領域我長期忽略？\n` +
    `2. 這些盲點可能帶來什麼影響或限制？\n` +
    `3. 建議我最優先補充哪個類別，並說明原因\n\n` +
    `請用繁體中文回答，語氣親切有建設性，約 250 字。`;

  return { result: callGemini(prompt) };
}
