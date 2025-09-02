import { Client, TextMessage, ImageEventMessage, WebhookEvent } from '@line/bot-sdk';
import { CalendarHandler } from './calendarHandler';

export class LineHandler {
  private lineClient: Client;
  private calendarHandler: CalendarHandler;

  constructor(
    channelAccessToken: string,
    mcpServerPath: string
  ) {
    // 初始化 LINE Bot 客戶端
    this.lineClient = new Client({
      channelAccessToken: channelAccessToken
    });

    // 初始化日曆處理器
    this.calendarHandler = new CalendarHandler();
    this.calendarHandler.setLineHandler(this); 
  }

  // 初始化
  async initialize(): Promise<void> {
    try {
      await this.calendarHandler.initialize();
      console.log('✅ LINE 處理器初始化完成');
    } catch (error) {
      console.error('❌ LINE 處理器初始化失敗:', error);
      throw error;
    }
  }

  // 處理 LINE Webhook 事件
  async handleWebhookEvents(events: WebhookEvent[]): Promise<void> {
    // 處理每個事件
    const promises = events.map(event => this.handleSingleEvent(event));
    await Promise.all(promises);
  }

  // 處理單一事件
  private async handleSingleEvent(event: WebhookEvent): Promise<void> {
    try {
      if (event.type !== 'message' || !event.source.userId) {
        console.log('忽略非訊息事件或沒有 userId 的事件:', event.type);
        return;
      }
      
      const userId = event.source.userId;
      const { replyToken } = event; 
      const message = event.message; 
      let responseText: string;

      switch (message.type) {
        case 'text':
          // ✨ 主要修改：將 userId 傳下去
          responseText = await this.handleTextMessage(userId, message as TextMessage);
          break;

        case 'image':
          responseText = await this.handleImageMessage(userId, message as ImageEventMessage);
                break;

        default:
          responseText = '🤖 目前只支援文字訊息。';
      }

      await this.replyMessage(replyToken, responseText);

    } catch (error) {
      console.error('❌ 處理事件失敗:', error);
      
      // 如果有 replyToken，發送錯誤訊息
      if ('replyToken' in event) {
        try {
          await this.replyMessage(
            (event as any).replyToken,
            '😅 抱歉，處理您的訊息時發生錯誤，請稍後再試。'
          );
        } catch (replyError) {
          console.error('❌ 發送錯誤訊息失敗:', replyError);
        }
      }
    }
  }

  // 處理文字訊息
  private async handleTextMessage(userId: string, message: TextMessage): Promise<string> {
    const userText = message.text.trim();
    console.log(`📝 收到來自 [${userId}] 的文字訊息:`, userText);

    // 特殊指令處理
    if (userText === '/help' || userText === '幫助' || userText === '說明') {
      return this.getHelpMessage();
    }

    if (userText === '/status' || userText === '狀態') {
      return '🤖 LINE Calendar Bot 運作正常\n' +
             '📅 Google Calendar 連接正常\n' +
             '✅ 準備為您服務！';
    }

     // 1. 從 Google Sheet 找到或建立使用者
    const userContext = await this.calendarHandler.sheetService.findOrCreateUser(userId); // 偷懶直接從 calendarHandler 拿 sheetService

    // 2. 將包含 {rowNumber, user} 的完整使用者上下文傳遞下去
    return await this.calendarHandler.handleMessage(userContext, message.text);
  
  }

  // 處理圖片訊息
  private async handleImageMessage(userId: string, message: ImageEventMessage): Promise<string> {
    try {
        console.log(`📷 收到來自 [${userId}] 的圖片訊息 [ID: ${message.id}]，開始下載並分析...`);
        
        const imageBuffer = await this.downloadImageContent(message.id);
        
        // ✨ 核心改造：像文字訊息一樣，先找到或建立使用者
        const userContext = await this.calendarHandler.sheetService.findOrCreateUser(userId);
        
        // ✨ 將 userContext 和圖片內容一起交給 calendarHandler
        return await this.calendarHandler.handleImage(userContext, imageBuffer);
                
    } catch (error) {
        console.error('處理圖片訊息失敗:', error);
        return '📷 抱歉，處理您的圖片時發生錯誤，請稍後再試。';
    }
  }

  // 下載圖片內容（未來使用）
  private async downloadImageContent(messageId: string): Promise<Buffer> {
    const stream = await this.lineClient.getMessageContent(messageId);
    const chunks: Buffer[] = [];
    
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  // 回覆訊息給使用者
    private async replyMessage(replyToken: string, text: string): Promise<void> {
      try {
        // ✨ 增加一個防呆檢查，確保不發送空訊息
        if (!text || text.trim() === '') {
          console.warn('⚠️ 偵測到嘗試回覆空訊息，已中止操作。');
          return;
        }

        await this.lineClient.replyMessage(replyToken, {
          type: 'text',
          text: text
        });
        
        console.log('✅ 訊息回覆成功');
      } catch (error: any) {
        console.error('❌ 回覆訊息失敗!');
        
        // ✨ 印出 LINE API 回傳的具體錯誤細節！
        if (error.response) {
          console.error('【LINE API 錯誤詳情】:', JSON.stringify(error.response.data, null, 2));
        } else {
          console.error('【非 API 錯誤】:', error.message);
        }

        throw error;
      }
    }

  // 主動推送訊息給使用者（未來可用於提醒功能）
  async pushMessage(userId: string, text: string): Promise<void> {
    try {
      await this.lineClient.pushMessage(userId, {
        type: 'text',
        text: text
      });
      
      console.log('✅ 推送訊息成功');
    } catch (error) {
      console.error('❌ 推送訊息失敗:', error);
      throw error;
    }
  }

  // 取得幫助訊息
  private getHelpMessage(): string {
    return `🤖 AI 學習助理 Bot 使用說明 🤖

  🧠 **核心學習功能**
  1️⃣ **傳送圖片分析**
    直接傳送您的課堂筆記、活動海報或書籍內頁，我會自動分析內容。

  2️⃣ **進行知識加工**
    分析完圖片後，您可以接著說：
    • "幫我生成心智圖"
    • "出幾題考考我"
    • "為我做個摘要"

  📂 **學習目標管理 (新！)**
  • **建立目標**: "建立目標：準備 OpenVINO 競賽，截止日期是 8/20"
  • **規劃目標**: "幫我規劃『準備 OpenVINO 競賽』"
  • **歸檔筆記**: (分析完筆記後) "將筆記歸檔到『準備 OpenVINO 競賽』"

  📅 **行事曆基礎功能**
  • **查詢**: "今天有什麼事？", "查詢下週行程"
  • **新增**: "明天下午3點演算法小考"
  • **刪除**: "取消明天的會議"

  ❓ **其他指令**
  • "幫助" 或 "/help" - 顯示此說明
  • "你是誰" - Bot 自我介紹

  準備好了嗎？試著傳送一張您的筆記照片給我吧！`;
  }


  // 關閉連接
  async close(): Promise<void> {
    await this.calendarHandler.close();
  }
}