// get_new_token.js (最終修正版 - 支援 config/.env)
const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const destroyer = require('server-destroy');
const path = require('path'); // ✨ 1. 引入 Node.js 的 'path' 模組

// ✨ 2. 在 config() 中傳入一個物件，明確指定 .env 檔案的路徑
// path.resolve 會建立一個從專案根目錄出發的絕對路徑，確保它總能找到正確的檔案
require('dotenv').config({ path: path.resolve(__dirname, 'config', '.env') });


const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/spreadsheets'
];

// --- 下面的程式碼與之前完全相同，無需修改 ---

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/oauth2callback'
);

async function main() {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.indexOf('/oauth2callback') > -1) {
        const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
        const code = qs.get('code');
        console.log(`✅ 成功獲取授權碼 (code): ${code}`);
        res.end('認證成功！請查看您的終端機輸出。您可以關閉此瀏覽器分頁了。');
        server.destroy();

        const { tokens } = await oauth2Client.getToken(code);
        console.log('\n\n\n🎉 成功獲取新的 Token！🎉');
        console.log('請將下面的 refresh_token 更新到您的 .env 檔案和 Railway 環境變數中：');
        console.log('----------------------------------------------------');
        console.log('GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
        console.log('----------------------------------------------------');
      }
    } catch (e) {
      console.error(e);
      res.end('認證失敗，請檢查終端機錯誤。');
    }
  }).listen(3000, () => {
    const authorizeUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });
    console.log('🚀 請手動複製以下網址，並在您的瀏覽器中開啟它來進行認證：\n');
    console.log(authorizeUrl);
  });
  destroyer(server);
}

main().catch(console.error);