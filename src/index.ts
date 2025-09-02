import express from 'express';
import { middleware, WebhookEvent } from '@line/bot-sdk';
import dotenv from 'dotenv';
import { LineHandler } from './handlers/lineHandler';

// 載入環境變數
// 僅在本地開發時載入 .env 檔案（部署到 Railway 時不載入）
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: './config/.env' });
}

// 檢查必要的環境變數
const requiredEnvVars = [
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET', 
  'GOOGLE_ACCESS_TOKEN',
  'GOOGLE_REFRESH_TOKEN'
];

console.log('🔍 檢查環境變數...');
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ 缺少必要的環境變數: ${envVar}`);
    process.exit(1);
  } else {
    console.log(`✅ ${envVar}: ${envVar.includes('TOKEN') || envVar.includes('SECRET') ? '***' : process.env[envVar]}`);
  }
}

// 取得環境變數 - Railway 會自動設定 PORT
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
  channelSecret: process.env.LINE_CHANNEL_SECRET!,
  port: parseInt(process.env.PORT || '3000') // Railway 會提供 PORT
};


// LINE Bot 設定
const lineConfig = {
  channelAccessToken: config.channelAccessToken,
  channelSecret: config.channelSecret
};

// --- 應用程式初始化 ---
const app = express();
let lineHandler: LineHandler;

console.log('🔧 LINE 設定:', {
  hasAccessToken: !!lineConfig.channelAccessToken,
  hasChannelSecret: !!lineConfig.channelSecret,
  accessTokenLength: lineConfig.channelAccessToken?.length,
  secretLength: lineConfig.channelSecret?.length
});

// 啟動應用程式
async function startApp() {
  try {
    console.log('🚀 啟動 LINE Calendar Bot...');
    lineHandler = new LineHandler(config.channelAccessToken, config.channelSecret);
    await lineHandler.initialize();
    console.log('✅ LINE 處理器初始化完成');
    
    // 健康檢查端點
    app.get('/', (req, res) => {
      console.log('🏥 健康檢查請求');
      res.json({
        status: 'ok',
        message: 'LINE Calendar Bot is running!',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
      });
    });

    // 測試端點 (開發用)
    app.get('/test', (req, res) => {
      console.log('🧪 測試端點請求');
      res.json({
        message: 'Test endpoint working!',
        config: {
          port: config.port,
          hasChannelToken: !!config.channelAccessToken,
          environment: process.env.NODE_ENV || 'development'
        }
      });
    });

    app.use(express.json({
    verify: (req: any, res, buf, encoding) => {
      // 將 buffer 轉換為字串，並存到 req 的一個自訂屬性上
      req.rawBody = buf.toString(encoding as BufferEncoding || 'utf8');
      }
    }));

    app.use(express.urlencoded({ extended: true }));

    // 添加請求日誌中間件
    app.use((req, res, next) => {
      console.log(`📨 ${req.method} ${req.path} - ${new Date().toISOString()}`);
      console.log('Headers:', JSON.stringify(req.headers, null, 2));
      if (req.rawBody) {
        console.log('Raw Body:', req.rawBody);
      }
      next();
    });

    

    // LINE Webhook 端點（使用自定義簽名驗證）
    app.post('/webhook', middleware(lineConfig), async (req, res) => {
        try {
            console.log('✅ LINE 官方中介軟體驗證通過');
            const events: WebhookEvent[] = req.body.events || [];
            console.log(`📨 收到 ${events.length} 個 Webhook 事件`);
            
            if (events.length > 0) {
              console.log('事件詳情:', JSON.stringify(events, null, 2));
              await lineHandler.handleWebhookEvents(events);
            }
            
            res.status(200).json({ success: true });
        } catch (error) {
            console.error('❌ Webhook 處理失敗:', error);
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    });

    // 帶簽名驗證的 webhook 端點 (用於之後修正)
    app.post('/webhook-secure', 
      middleware(lineConfig), 
      async (req, res) => {
        try {
          console.log('✅ LINE 中間件驗證通過');
          const events: WebhookEvent[] = req.body.events;
          console.log(`📨 收到 ${events.length} 個 Webhook 事件`);
          
          if (events && events.length > 0) {
            console.log('事件詳情:', JSON.stringify(events, null, 2));
          }

          // 處理所有事件
          await lineHandler.handleWebhookEvents(events);

          console.log('✅ Webhook 處理成功');
          res.status(200).json({ success: true });
        } catch (error) {
          console.error('❌ Webhook 處理失敗:', error);
          console.error('錯誤堆疊:', error instanceof Error ? error.stack : 'No stack trace');
          res.status(200).json({ 
            success: false, 
            error: 'Internal server error' 
          });
        }
      }
    );

    // 錯誤處理中間件
    app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('❌ Express 錯誤:', error);
      console.error('錯誤堆疊:', error.stack);
      res.status(500).json({
        success: false,
        error: 'Something went wrong!'
      });
    });

    // 4. 啟動伺服器
    const server = app.listen(config.port, '0.0.0.0', () => {
      console.log('🎉 LINE Calendar Bot 啟動成功!');
      console.log(`📡 伺服器運行在 Port: ${config.port}`);
      console.log(`📱 Webhook URL: /webhook`);
      console.log('✅ 準備接收 LINE 訊息...');
      console.log('\n📋 可用端點:');
      console.log(`   GET  /        - 健康檢查`);
      console.log(`   POST /webhook - LINE Webhook`);
      console.log(`   GET  /test    - 測試端點`);
    });

    // 5. 優雅關閉處理
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n📡 收到 ${signal} 信號，正在關閉伺服器...`);
      
      server.close(async () => {
        console.log('🔌 HTTP 伺服器已關閉');
        
        if (lineHandler) {
          await lineHandler.close();
          console.log('🔌 LINE 處理器已關閉');
        }
        
        console.log('👋 LINE Calendar Bot 已安全關閉');
        process.exit(0);
      });
      
      // 強制關閉（如果 10 秒內沒有正常關閉）
      setTimeout(() => {
        console.error('⚠️  強制關閉應用程式');
        process.exit(1);
      }, 10000);
    };

    // 監聽關閉信號
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    console.error('❌ 應用程式啟動失敗:', error);
    console.error('錯誤堆疊:', error instanceof Error ? error.stack : 'No stack trace');
    process.exit(1);
  }
}

// 全域錯誤處理
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ 未處理的 Promise 拒絕:', reason);
  console.error('Promise:', promise);
});

process.on('uncaughtException', (error) => {
  console.error('❌ 未捕獲的異常:', error);
  console.error('錯誤堆疊:', error.stack);
  process.exit(1);
});

// 啟動應用程式
startApp();