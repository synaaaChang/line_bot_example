import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export class GoogleCalendarService {
  private calendar: any;
  public auth: OAuth2Client;

  constructor() {
    // 使用環境變數中的 Google 憑證
    const credentials = {
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob'
    };

    this.auth = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      credentials.redirect_uri
    );
    

    // 設定 tokens (從環境變數)
    this.auth.setCredentials({
      access_token: process.env.GOOGLE_ACCESS_TOKEN!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!
    });

    this.calendar = google.calendar({ version: 'v3', auth: this.auth });
  }

  async connect(): Promise<void> {
    try {
      // 測試連接
      await this.calendar.calendarList.list({ maxResults: 1 });
      console.log('✅ Google Calendar 連接成功');
    } catch (error) {
      console.error('❌ Google Calendar 連接失敗:', error);
      throw error;
    }
  }

  async listEvents(timeRange: string = 'today'): Promise<any[]> {
    try {
      const { timeMin, timeMax } = this.getTimeRange(timeRange);

      const response = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 20
      });

      return response.data.items || [];
    } catch (error) {
      console.error('查詢事件失敗:', error);
      return [];
    }
  }

  async createEvent(eventData: any): Promise<any> {
    try {
      const response = await this.calendar.events.insert({
        calendarId: 'primary',
        resource: eventData
      });

      return response.data;
    } catch (error) {
      console.error('創建事件失敗:', error);
      throw error;
    }
  }

  async searchEvents(query: string): Promise<any[]> {
    try {
      const response = await this.calendar.events.list({
        calendarId: 'primary',
        q: query,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 20
      });

      return response.data.items || [];
    } catch (error) {
      console.error('搜尋事件失敗:', error);
      return [];
    }
  }

  async deleteEventById(eventId: string): Promise<void> {
    try {
      await this.calendar.events.delete({
        calendarId: 'primary',
        eventId: eventId,
      });
      console.log(`[GCAL] 成功刪除 Event ID: ${eventId}`);
    } catch (error) {
      console.error(`[GCAL] 刪除 Event ID: ${eventId} 失敗:`, error);
      // 向上拋出錯誤，讓呼叫者知道操作失敗
      throw new Error('刪除 Google Calendar 事件時發生錯誤。');
    }
  }

  private getTimeRange(range: string): { timeMin: string; timeMax: string } {
    const now = new Date();
    let timeMin: Date, timeMax: Date;

    switch (range) {
      case 'today':
        timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        timeMax = new Date(timeMin);
        timeMax.setDate(timeMax.getDate() + 1);
        break;
      case 'tomorrow':
        timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        timeMax = new Date(timeMin);
        timeMax.setDate(timeMax.getDate() + 1);
        break;
      case 'week':
        timeMin = new Date(now);
        timeMax = new Date(now);
        timeMax.setDate(timeMax.getDate() + 7);
        break;
      case 'month':
        timeMin = new Date(now);
        timeMax = new Date(now);
        timeMax.setMonth(timeMax.getMonth() + 1);
        break;
      default:
        timeMin = new Date(now);
        timeMax = new Date(now);
        timeMax.setDate(timeMax.getDate() + 1);
    }

    return {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString()
    };
  }
  
  /**
   * 根據一個計畫陣列，建立多個 Google Calendar 事件。
   * 會自動從隔天開始，避開週末，每天安排一個任務。
   * @param plan 一個包含 { summary: string, duration_hours: number } 的陣列
   * @returns 成功建立的事件陣列
   */
  async createMultipleEvents(plan: any[]): Promise<any[]> {
    const createdEvents = [];
    let eventStartDate = new Date();
    // 從明天開始安排
    eventStartDate.setDate(eventStartDate.getDate() + 1);
    // 預設從早上 9 點開始
    eventStartDate.setHours(9, 0, 0, 0);

    for (const item of plan) {
      // 如果遇到週六(6)或週日(0)，就往後推
      while (eventStartDate.getDay() === 0 || eventStartDate.getDay() === 6) {
        eventStartDate.setDate(eventStartDate.getDate() + 1);
      }

      const startTime = new Date(eventStartDate);
      const endTime = new Date(eventStartDate);
      endTime.setHours(endTime.getHours() + (item.duration_hours || 1)); // 如果沒給時長，預設1小時
      
      const eventData = {
        summary: item.summary,
        description: `由 LINE 智慧規劃助理自動產生。`,
        start: {
          dateTime: startTime.toISOString(),
          timeZone: 'Asia/Taipei'
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: 'Asia/Taipei'
        }
      };

      try {
        const createdEvent = await this.createEvent(eventData);
        createdEvents.push(createdEvent);
      } catch (error) {
        // 即使某個事件建立失敗，也要繼續嘗試下一個，不要中斷整個流程
        console.error(`無法建立事件: "${item.summary}"`, error);
      }

      // 將日期往後推一天，準備安排下一個任務
      eventStartDate.setDate(eventStartDate.getDate() + 1);
    }
    
    return createdEvents;
  }

  async disconnect(): Promise<void> {
    // Google API 不需要特別的斷開連接
    console.log('🔌 Google Calendar 服務已關閉');
  }

  /**
   * ✨ 新增：分析一組事件 ID 的狀態
   * @param eventIds 一個包含 Google Calendar 事件 ID 的陣列
   * @returns 一個包含 upcomingEvents 和 overdueEvents 的物件
   */
  async analyzeEventsStatus(eventIds: string[]): Promise<{ upcomingEvents: any[], overdueEvents: any[] }> {
      const upcomingEvents = [];
      const overdueEvents = [];
      const now = new Date();
      const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      for (const eventId of eventIds) {
          try {
              const response = await this.calendar.events.get({
                  calendarId: 'primary',
                  eventId: eventId,
              });
              const event = response.data;
              const eventStartTime = new Date(event.start.dateTime || event.start.date);
              
              if (event.status === 'cancelled') continue;

              if (eventStartTime < now) {
                  overdueEvents.push(event);
              } else if (eventStartTime <= oneWeekFromNow) {
                  upcomingEvents.push(event);
              }
          } catch (error: any) {
              // 如果事件被使用者手動刪除了，API 會回傳 404，這是正常情況
              if (error.code === 404) {
                  console.log(`[GCAL] 事件 ${eventId} 已被刪除，跳過分析。`);
              } else {
                  console.error(`[GCAL] 獲取事件 ${eventId} 失敗:`, error);
              }
          }
      }
      return { upcomingEvents, overdueEvents };
  }
}