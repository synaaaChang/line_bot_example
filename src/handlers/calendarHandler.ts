// src/handlers/calendarHandler.ts

import { GoogleCalendarService } from '../utils/mcpClient';
import { GoogleSheetService, User } from '../services/googleSheetService';
import { IntelligentPlanner } from '../services/intelligentPlanner';
import { formatEventsForLine } from '../utils/responseFormatter';
import { LineHandler } from './lineHandler';

interface PlanEvent {
  summary: string;
  date?: string; 
  startTime?: string;
  duration_hours?: number;
  objectiveId?: number;  
}

export class CalendarHandler {
  private googleCalendarService: GoogleCalendarService;
  // 設為 public，這樣 lineHandler 才能透過它呼叫 findOrCreateUser
  public sheetService: GoogleSheetService;
  private lineHandler?: LineHandler;

  constructor() {
    this.googleCalendarService = new GoogleCalendarService();
    // 將 calendarService 的 auth 物件傳給 sheetService，確保使用同一個認證
    this.sheetService = new GoogleSheetService(this.googleCalendarService.auth);
  }

  public setLineHandler(handler: LineHandler) {
    this.lineHandler = handler;
  }

  async initialize(): Promise<void> {
    try {
      await this.googleCalendarService.connect();
      console.log('✅ 日曆處理器初始化完成');
    } catch (error) {
      console.error('❌ 日曆處理器初始化失敗:', error);
      throw error;
    }
  }

  /**
   * 處理來自 LINE 的文字訊息。
   * @param userContext 包含使用者在 Google Sheet 中的列號和資料的物件
   * @param message 使用者傳送的訊息文字
   */
  async handleMessage(userContext: { rowNumber: number; user: User }, message: string): Promise<string> {
    const { rowNumber, user } = userContext;
    // 從 user 物件解析出 JSON 狀態，如果不存在則為 null
    const userState = user.state_json ? JSON.parse(user.state_json) : null;
    
    // --- 狀態處理中心 ---
    // 如果使用者處於某個等待回覆的狀態，優先處理
    if (userState) {
        switch (userState.status) {
            
            // 情況 1：等待使用者確認計畫
            case 'waiting_confirmation': {
                const plan = userState.plan;
                const messageTrimmed = message.trim();

                // ✨ 新的、更嚴格的判斷邏輯 ✨
                const pureConfirmTerms = ['好', '可以', 'ok', '沒問題', '是的', '同意', '好啊', '可以啊'];
                const isPureConfirmation = pureConfirmTerms.includes(messageTrimmed) && messageTrimmed.length < 5;
                
                const negativeResponses = ['不用', '取消', '不要', '不對'];

                if (isPureConfirmation) {
                    // 使用者只回覆了 "好" 或 "可以" 等簡短詞語
                    await this.sheetService.setUserState(rowNumber, null);
                    return this.handleCreatePlan(plan);
                } else if (negativeResponses.some(resp => messageTrimmed.toLowerCase().includes(resp))) {
                    // 使用者回覆了否定詞
                    await this.sheetService.setUserState(rowNumber, null);
                    return '好的，已為您取消安排。';
                } else {
                    // ✨ 其他所有情況，都視為修改意見 ✨
                    console.log(`[對話] 收到計畫修改要求: ${message}`);
                    const modifiedIntent = await IntelligentPlanner.modifyPlan(plan, message);

                    if (modifiedIntent.action === 'plan_complex_task') {
                        const newState = { status: 'waiting_confirmation', plan: modifiedIntent.plan };
                        await this.sheetService.setUserState(rowNumber, newState);
                        return `好的，這是為您調整後的計畫，您覺得如何？\n\n${this.formatPlanForConfirmation(modifiedIntent.plan, false)}`;
                    } else {
                        await this.sheetService.setUserState(rowNumber, null);
                        return modifiedIntent.params?.response || '抱歉，我不太能理解您的修改。';
                    }
                }
            }

            // 情況 2：等待使用者確認要刪除哪個事件
            case 'waiting_delete_confirmation': {
                const eventsToDelete = userState.events;
                const choiceResult = await IntelligentPlanner.parseDeletionChoice(message, eventsToDelete.length);
                let eventsDeletedCount = 0;
                let deletedSummaries: string[] = [];

                if (choiceResult.selection === 'all') {
                    for (const event of eventsToDelete) {
                        await this.googleCalendarService.deleteEventById(event.id);
                        eventsDeletedCount++;
                        deletedSummaries.push(event.summary);
                    }
                } else if (Array.isArray(choiceResult.selection)) {
                    for (const index of choiceResult.selection) {
                        if (eventsToDelete[index]) {
                            await this.googleCalendarService.deleteEventById(eventsToDelete[index].id);
                            eventsDeletedCount++;
                            deletedSummaries.push(eventsToDelete[index].summary);
                        }
                    }
                }

                await this.sheetService.setUserState(rowNumber, null); // 操作完成後清除狀態

                if (eventsDeletedCount > 0) {
                    return `✅ 操作完成！已成功刪除 ${eventsDeletedCount} 個行程：\n- ${deletedSummaries.join('\n- ')}`;
                } else {
                    return '好的，已取消刪除操作。';
                }
            }

            case 'waiting_plan_correction': {
                const partialPlan = userState.partialPlan;
                // 將不完整的計畫和使用者的補充說明，交給 AI 進行合併
                const completeIntent = await IntelligentPlanner.mergePlanWithCorrection(partialPlan, message);
                
                if (completeIntent.error) {
                    await this.sheetService.setUserState(rowNumber, null); // 合併失敗，清除狀態
                    return "抱歉，合併您的修正時發生錯誤，請再試一次。";
                }

                // 用合併後的完整計畫，再次向使用者確認
                const newState = { status: 'waiting_confirmation', plan: completeIntent.plan };
                await this.sheetService.setUserState(rowNumber, newState); // 更新為等待確認的狀態
                return `太好了！這是更新後的完整計畫，您看一下是否正確？\n\n${this.formatPlanForConfirmation(completeIntent.plan, false)}`;
            }
            
            case 'waiting_knowledge_action': {
              const noteId = userState.noteId;
              if (!noteId) {
                  await this.sheetService.setUserState(rowNumber, null);
                  return "抱歉，我忘記我們正在討論哪份筆記了，我們可以重新開始嗎？";
              }

              // 1. 先將使用者的指令交給 AI，判斷其意圖
              const intent = await IntelligentPlanner.understandAndPlan(message);
              console.log(`[歸檔] LLM 解析歸檔意圖:`, intent);

              // 2. 檢查是否是我們新增的「歸檔」指令
              if (intent.action === 'link_note_to_objective' && intent.params?.objectiveTitle) {
                  const objectiveTitle = intent.params.objectiveTitle;
                  
                  // 3. 根據標題找到對應的學習目標
                  const objective = await this.sheetService.findObjectiveByTitle(user.id, objectiveTitle);
                  if (!objective) {
                      return `🤔 找不到名為「${objectiveTitle}」的學習目標。您可以先建立它，或檢查名稱是否正確。`;
                  }
                  
                  // 4. 執行歸檔操作！
                  await this.sheetService.linkNoteToObjective(noteId, objective.objective_id);
                  
                  // 5. 操作完成，清除狀態並回覆使用者
                  await this.sheetService.setUserState(rowNumber, null);
                  return `✅ 好的，已將這份筆記歸檔到您的學習目標「${objective.title}」中！`;
              } 
              else {
                  // 情況 B：如果不是歸檔指令，就執行之前已有的「內容生成」流程
                  const knowledgeData = await this.sheetService.getKnowledgeNoteById(noteId);
                  if (!knowledgeData) {
                      await this.sheetService.setUserState(rowNumber, null);
                      return "抱歉，讀取筆記資料時發生錯誤。";
                  }

                  const finalResult = await IntelligentPlanner.processKnowledge(knowledgeData, message);
                  await this.sheetService.setUserState(rowNumber, null);
                  return finalResult;
              }
          }

            // 預設情況：如果狀態無法識別，清除它以避免卡死
            default:
              await this.sheetService.setUserState(rowNumber, null);
        }
    }
    
    // --- 全新請求處理 ---
    // 如果沒有處於任何等待狀態，就執行全新規劃流程
    try {
        const intent = await IntelligentPlanner.understandAndPlan(message);
        console.log('🎯 LLM 解析意圖:', intent);

        switch (intent.action) {
            case 'plan_complex_task': {
                const plan = intent.plan;
                
                // 如果計畫與某個目標關聯，先去找到目標的 ID
                if (intent.objectiveTitle) {
                    const objective = await this.sheetService.findObjectiveByTitle(user.id, intent.objectiveTitle);
                    if (objective) {
                        // 將 objective_id 注入到每一個 plan item 中，以便後續關聯
                        plan.forEach((item: PlanEvent) => {
                            item.objectiveId = objective.objective_id; 
                        });
                    } else {
                        return `🤔 找不到名為「${intent.objectiveTitle}」的學習目標，要先建立一個嗎？`;
                    }
                }

                const newState = { status: 'waiting_confirmation', plan: plan };
                await this.sheetService.setUserState(rowNumber, newState);
                return this.formatPlanForConfirmation(plan);
            }

            case 'list_events':
                return await this.handleListEvents(intent);

            case 'create_event':
                return await this.handleCreateEvent(intent);

            case 'clarify_or_reject':
                return intent.params.response;

            case 'delete_event':
                return await this.handleDeleteRequest(rowNumber, intent);

            case 'create_learning_objective': {
                const { title, dueDate } = intent.params;
                if (!title) {
                    return "🤔 請告訴我您的學習目標是什麼喔！";
                }
                const newObjective = await this.sheetService.createLearningObjective(user.id, title, dueDate || null);
                let response = `✅ 已為您建立新的學習目標：\n\n🎯 ${newObjective.title}`;
                if (newObjective.due_date) {
                    response += `\n- 截止日期: ${newObjective.due_date}`;
                }
                response += `\n\n接下來，您可以說：「幫我規劃『${newObjective.title}』」，來為這個目標安排具體行程。`;
                return response;
            }
            case 'plan_for_objective': {
                const { objectiveTitle } = intent.params;
                const objective = await this.sheetService.findObjectiveByTitle(user.id, objectiveTitle);

                if (!objective) {
                    return `🤔 找不到名為「${objectiveTitle}」的學習目標，要先建立一個嗎？`;
                }

                // ✨ AI 現在只負責識別意圖，由另一個 AI call 負責生成計畫 ✨
                // 這一步讓職責更分離，效果更好
                const planIntent = await IntelligentPlanner.generatePlanForObjective(objective.title);
                
                // 將 objective_id 注入到每一個 plan item 中
                planIntent.plan.forEach((item: PlanEvent) => {
                    item.objectiveId = objective.objective_id; 
                });

                const newState = { status: 'waiting_confirmation', plan: planIntent.plan };
                await this.sheetService.setUserState(rowNumber, newState);
                return this.formatPlanForConfirmation(planIntent.plan);
            }

            // ✨ plan_complex_task 現在更名為 plan_generic_task ✨
            case 'plan_generic_task': {
                const plan = intent.plan;
                const newState = { status: 'waiting_confirmation', plan: plan };
                await this.sheetService.setUserState(rowNumber, newState);
                return this.formatPlanForConfirmation(plan);
            }
            
            default:
                return '🤔 抱歉，我不太理解您的需求。您可以試試：「幫我規劃下週的讀書計畫」。';
        }
    } catch (error) {
        console.error('❌ 處理訊息錯誤:', error);
        return '😅 抱歉，處理您的請求時發生錯誤，請稍後再試。';
    }
  }

  /**
   * 將 AI 規劃好的行程表，格式化成易於閱讀的文字，並詢問使用者是否同意。
   * (此方法無需修改)
   */
  private formatPlanForConfirmation(plan: PlanEvent[], showGreeting: boolean = true): string {
      let response = "";
      if (showGreeting) {
          response += "這是為您建議的計畫草案，您覺得如何？\n\n";
      }

      plan.forEach((item, index) => {
          response += `🗓️ **階段 ${index + 1}: ${item.summary}**\n`;
          // ✨ 智慧顯示日期和時間 ✨
          if (item.date) {
              const displayDate = new Date(item.date + 'T00:00:00');
              response += `   - **日期:** ${displayDate.toLocaleDateString('zh-TW')}\n`;
          }
          if (item.startTime) {
              const displayTime = new Date(item.startTime);
              response += `   - **時間:** ${displayTime.toLocaleString('zh-TW')}\n`;
          }
          // ✨ 智慧顯示時長 ✨
          if (item.duration_hours) {
              response += `   - **時長:** 約 ${item.duration_hours} 小時\n`;
          }
          response += "\n";
      });
      response += "如果您同意這個規劃，請回覆「好」，我就會將它排入您的行事曆！(或提出您的修改意見)";
      return response;
  }

  /**
 * 執行「建立整個計畫」的動作。
 * ✨ 新版本：能夠智慧地處理帶有具體日期的事件。
 * @param plan 一個包含 PlanEvent 物件的陣列
 */
  private async handleCreatePlan(plan: PlanEvent[]): Promise<string> {
      let createdCount = 0;
      let nextAvailableDate = new Date();
      nextAvailableDate.setDate(nextAvailableDate.getDate() + 1); // 從明天開始
      nextAvailableDate.setHours(9, 0, 0, 0); // 預設早上 9 點

      for (const item of plan) {
          let eventStart: Date;

          if (item.date) {
              // 情況 A：計畫帶有具體日期（來自圖片分析）
              eventStart = new Date(item.date + 'T09:00:00'); // 使用計畫的日期
          } else if (item.startTime) {
              // 情況 B：計畫帶有具體時間
              eventStart = new Date(item.startTime);
          } else {
              // 情況 C：計畫無任何日期資訊（來自純文字），使用我們的計數器
              while (nextAvailableDate.getDay() === 0 || nextAvailableDate.getDay() === 6) {
                  nextAvailableDate.setDate(nextAvailableDate.getDate() + 1); // 跳過週末
              }
              eventStart = new Date(nextAvailableDate);
              // 為下一個無日期事件，準備好後一天的日期
              nextAvailableDate.setDate(nextAvailableDate.getDate() + 1);
          }
          
          const eventEnd = new Date(eventStart.getTime() + (item.duration_hours || 1) * 60 * 60 * 1000);

          const eventData = {
              summary: item.summary,
              start: { dateTime: eventStart.toISOString(), timeZone: 'Asia/Taipei' },
              end: { dateTime: eventEnd.toISOString(), timeZone: 'Asia/Taipei' },
          };

          try {
            const createdEvent = await this.googleCalendarService.createEvent(eventData);
            createdCount++;
            if (item.objectiveId) { 
                await this.sheetService.linkEventToObjective(item.objectiveId, createdEvent.id);
            }  
          } catch (error) {
              console.error(`無法建立事件: "${item.summary}"`, error);
          }
      }

      if (createdCount > 0) {
          return `✅ 太棒了！已為您將 ${createdCount} 個任務行程新增到您的 Google Calendar！`;
      } else {
          return `⚠️ 雖然收到了您的指令，但沒有成功新增任何行程，請檢查後再試。`;
      }
  }

  /**
   * 處理查詢事件的請求。
   * (此方法無需修改)
   */
  private async handleListEvents(intent: any): Promise<string> {
    try {
      const timeRange = intent.params?.timeRange || 'today';
      const events = await this.googleCalendarService.listEvents(timeRange);
      return formatEventsForLine(events);
    } catch (error) {
      console.error('查詢事件失敗:', error);
      return '📅 抱歉，查詢日曆事件時發生錯誤，請確認您的 Google 連接正常。';
    }
  }

  /**
   * 處理建立單一事件的請求。
   * (此方法無需修改)
   */
  private async handleCreateEvent(intent: any): Promise<string> {
    try {
      const params = intent.params;
      if (!params || !params.summary || !params.startTime) {
        return '📝 抱歉，我需要明確的「事件標題」和「開始時間」才能為您新增行程喔！';
      }
      const eventData = {
        summary: params.summary,
        start: {
          dateTime: params.startTime,
          timeZone: 'Asia/Taipei',
        },
        end: {
          dateTime: params.endTime || new Date(new Date(params.startTime).getTime() + 60 * 60 * 1000).toISOString(),
          timeZone: 'Asia/Taipei',
        },
      };
      const createdEvent = await this.googleCalendarService.createEvent(eventData);
      return `✅ 行程新增成功！\n\n📅 ${createdEvent.summary}\n🕐 ${new Date(createdEvent.start.dateTime).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`;
    } catch (error) {
      console.error('創建單一事件失敗:', error);
      return '📅 抱歉，新增行程時發生錯誤，請檢查您的時間格式是否正確。';
    }
  }

  /**
   * 處理刪除事件的請求，現在接收 rowNumber 以設定狀態。
   */
  private async handleDeleteRequest(rowNumber: number, intent: any): Promise<string> {
    const query = intent.params?.query;
    if (!query) {
      return '🤔 請告訴我要刪除哪個行程呢？例如：「刪除明天的會議」。';
    }

    const foundEvents = await this.googleCalendarService.searchEvents(query);

    if (!foundEvents || foundEvents.length === 0) {
      return `🔍 找不到與「${query}」相關的行程。`;
    }

    let response: string;
    // 統一將要設定的狀態儲存在 newState 變數中
    const newState = { status: 'waiting_delete_confirmation', events: foundEvents };

    if (foundEvents.length === 1) {
      const event = foundEvents[0];
      response = `我只找到一個行程符合條件：\n\n📅 ${event.summary}\n🕐 ${new Date(event.start.dateTime).toLocaleString('zh-TW')}\n\n確定要刪除它嗎？(請回覆'是'或'否')`;
    } else {
      let list = `好的，我找到了 ${foundEvents.length} 個符合條件的行程：\n\n`;
      foundEvents.forEach((event, index) => {
        const time = new Date(event.start.dateTime || event.start.date).toLocaleString('zh-TW');
        list += `${index + 1}. ${event.summary} (${time})\n`;
      });
      list += "\n請問您想要刪除哪一個？ (可以回覆數字，例如 '1, 3'、'全部' 或 '取消')";
      response = list;
    }

    // 最後統一設定狀態
    await this.sheetService.setUserState(rowNumber, newState);
    return response;
  }

/**
 * 處理來自 LINE 的圖片訊息，現在會建立對話狀態，並能處理不完整的計畫。
 * @param userContext 包含使用者在 Google Sheet 中的列號和資料的物件
 * @param imageBuffer 使用者上傳圖片的 Buffer 資料
 */
  async handleImage(userContext: { rowNumber: number; user: User }, imageBuffer: Buffer): Promise<string> {
    // 异步执行核心的耗时逻辑，但我们不等待它 (no await)
    this.processImageInBackground(userContext, imageBuffer);
    
    // 立即回覆，消耗掉 replyToken，避免超时
    return '👌 已收到您的圖片，正在請 AI 大腦進行分析，請稍候...';
  }

  /**
   * ✨ 新增的背景处理函式，包含了所有耗时的操作
   */
  private async processImageInBackground(userContext: { rowNumber: number; user: User }, imageBuffer: Buffer): Promise<void> {
    const { user } = userContext;
    try {
        // 1. (耗时) AI 分析
        const intent = await IntelligentPlanner.analyzeImageAndPlan(imageBuffer);
        console.log('🎨 (Background) LLM 圖像初步解析:', intent);
        
        // 2. (耗时) 根据意图准备回覆内容
        const pushMessageText = await this.preparePushMessageFromIntent(userContext, intent);

        // 3. (关键) 使用 pushMessage 主动推送最终结果
        if (this.lineHandler && pushMessageText) {
            await this.lineHandler.pushMessage(user.line_user_id, pushMessageText);
        }

    } catch (error) {
        console.error('❌ (Background) 背景圖片處理失敗:', error);
        // 如果背景处理失败，也主动推送一条错误讯息
        if (this.lineHandler) {
            await this.lineHandler.pushMessage(user.line_user_id, '😵 抱歉，AI 大腦在分析您的圖片時似乎遇到了一點困難，請稍後再試一次。');
        }
    }
  }

  /**
   * ✨ 新增的辅助函式，封装了之前 handleImage 的所有 switch-case 逻辑
   * @returns 最终要推送给用户的文字，或者 null
   */
  private async preparePushMessageFromIntent(userContext: { rowNumber: number; user: User }, intent: any): Promise<string | null> {
      const { rowNumber, user } = userContext;
      
      // ✨ 对计画进行后处理 (从您之前的 handleImage 搬移过来)
      if (intent.action === 'plan_complex_task' && Array.isArray(intent.plan)) {
          console.log('✨ (Background) 執行計畫清理與後處理...');
          const completeEvents: PlanEvent[] = intent.plan.filter(
              (event: PlanEvent) => event.summary && (event.date || event.startTime)
          );
          const uniqueEvents: PlanEvent[] = completeEvents.filter(
              (event: PlanEvent, index: number, self: PlanEvent[]) =>
                  index === self.findIndex((t: PlanEvent) => 
                      t.summary === event.summary && t.date === event.date
                  )
          );
          intent.plan = uniqueEvents;
          console.log('✨ (Background) 清理後的計畫:', intent.plan);
      }
      
      // ✨ 将您之前 handleImage 的 switch-case 逻辑完整搬移到这里 ✨
      switch (intent.action) {
          case 'reconstruct_knowledge': {
              const newNoteId = await this.sheetService.saveKnowledgeNote(user.id, intent);
              const newState = { status: 'waiting_knowledge_action', noteId: newNoteId };
              await this.sheetService.setUserState(rowNumber, newState);
              const title = intent.source || "這份資料";
              return `✅ 分析完成！\n我已經整理好您關於「${title}」的筆記了。\n\n接下來，您想做什麼呢？\n您可以試著說：\n• 「幫我生成心智圖、flashcard、摘要」\n• 「出幾題考考我」\n• 「將筆記歸檔到『[您的目標名稱]』」`;
          }
              
          case 'plan_complex_task': {
              const plan = intent.plan;
              if (this.isPlanComplete(plan)) {
                const newState = { status: 'waiting_confirmation', plan: plan };
                await this.sheetService.setUserState(rowNumber, newState);
                return this.formatPlanForConfirmation(plan);
             } else {
                if (!plan || plan.length === 0) {
                    return '🤔 抱歉，我從圖片中無法提取出任何完整的活動資訊。';
                }
                const newState = { status: 'waiting_plan_correction', partialPlan: intent };
                await this.sheetService.setUserState(rowNumber, newState);
                return this.formatIncompletePlanAsTemplate(plan);
             }
          }

          case 'create_event': {
              if (intent.params && intent.params.startTime) {
                  const newState = { status: 'waiting_confirmation', plan: [intent.params] };
                  await this.sheetService.setUserState(rowNumber, newState);
                  return this.formatPlanForConfirmation(newState.plan);
              } else {
                  const newState = { status: 'waiting_plan_correction', partialPlan: { action: 'plan_complex_task', plan: [intent.params] } };
                  await this.sheetService.setUserState(rowNumber, newState);
                  return this.formatIncompletePlanAsTemplate([intent.params]);
              }
          }

          default:
              return '🤔 抱歉，我從圖片中看不出可以怎麽協助您。';
      }
  }
  
  // (下列輔助方法無需修改)
  private isPlanComplete(plan: any[]): boolean {
    return plan.every(event => event.date || event.startTime);
  }

  private formatIncompletePlanAsTemplate(plan: any[]): string {
    let response = "好的，我從圖片中找到了這些活動，但有些日期不清楚，能請您幫忙提供嗎？\n\n";
    plan.forEach((event, index) => {
      response += `**事件 ${index + 1}:** ${event.summary}\n`;
      const dateValue = event.date || event.startTime;
      response += `  **日期:** ${dateValue || "【請幫我填寫這個日期】"}\n\n`;
    });
    response += "您可以像這樣回覆：『事件1的日期是8/18，事件2是8/20』";
    return response;
  }

  async close(): Promise<void> {
    await this.googleCalendarService.disconnect();
  }
}