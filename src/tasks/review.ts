// src/tasks/review.ts (Final Version for railway.json)

import { LineHandler } from '../handlers/lineHandler';
import { GoogleSheetService } from '../services/googleSheetService';
import { GoogleCalendarService } from '../utils/mcpClient';
import * as dotenv from 'dotenv';
import * as path from 'path';

// --- 環境變數載入 ---
const envPath = path.resolve(__dirname, '..', '..', 'config', '.env');
dotenv.config({ path: envPath });

// --- 輔助函式 ---
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));


// --- 服務初始化 (保持獨立) ---
function initializeServices() {
    console.log('🔧 (Task) 初始化所有服務...');
    // 推送訊息只需要 Access Token，Secret 可以是空字串
    const lineHandler = new LineHandler(process.env.LINE_CHANNEL_ACCESS_TOKEN!, ''); 
    const calendarService = new GoogleCalendarService();
    const sheetService = new GoogleSheetService(calendarService.auth);
    console.log('✅ (Task) 所有服務初始化完畢。');
    return { lineHandler, calendarService, sheetService };
}


// --- 核心邏輯 (封裝在函式中，保持乾淨) ---
async function runReview() {
    const { lineHandler, calendarService, sheetService } = initializeServices();
    
    console.log('🚀 (Task) 開始執行學習進度回顧任務...');
    const allUsers = await sheetService.getAllUsers();
    console.log(`👥 (Task) 找到 ${allUsers.length} 位使用者需要檢查。`);

    if (allUsers.length === 0) {
        console.log('🤷 (Task) 沒有找到任何使用者，任務結束。');
        return; // 直接返回，讓後續的 process.exit(0) 執行
    }

    for (const user of allUsers) {
        try {
            const activeObjectives = await sheetService.getActiveObjectivesByUserId(user.id);
            if (activeObjectives.length === 0) {
                console.log(`   - (Task) 使用者 ${user.id} 沒有活躍目標，跳過。`);
                continue;
            }

            let reportText = `早安！☀️ 這是您本週的學習進度回顧：\n`;
            let hasOverdueTasks = false;

            for (const objective of activeObjectives) {
                reportText += `\n🎯 **目標：${objective.title}**\n`;
                const eventIds = objective.gcal_event_ids ? objective.gcal_event_ids.split(',') : [];
                
                if (eventIds.length === 0) {
                    reportText += `   - 您還沒有為這個目標安排任何具體行程喔！\n`;
                    continue;
                }
                
                const { upcomingEvents, overdueEvents } = await calendarService.analyzeEventsStatus(eventIds);
                
                if (overdueEvents.length > 0) {
                    hasOverdueTasks = true;
                    reportText += `   - 🔴 **注意！有 ${overdueEvents.length} 個任務已過期：**\n`;
                    overdueEvents.forEach(event => {
                        reportText += `     - ${event.summary}\n`;
                    });
                }

                if (upcomingEvents.length > 0) {
                    reportText += `   - 🟢 **本週即將進行：**\n`;
                    upcomingEvents.forEach(event => {
                        const eventDate = new Date(event.start.dateTime || event.start.date);
                        reportText += `     - ${eventDate.toLocaleDateString('zh-TW')} - ${event.summary}\n`;
                    });
                } else if (overdueEvents.length === 0) {
                    reportText += `   - 👍 本週沒有即將到來的行程，一切都在您的掌握中！\n`;
                }
            }

            if (hasOverdueTasks) {
                reportText += `\n需要我幫您將過期的任務重新安排到本週嗎？ (此功能開發中)`;
            } else {
                reportText += `\n做得很好，繼續保持這個節奏！💪`;
            }
            
            console.log(`[推送] (Task) 準備推送報告給使用者 ${user.line_user_id}`);
            await lineHandler.pushMessage(user.line_user_id, reportText);
            await delay(500); 

        } catch (error) {
            console.error(`(Task) 處理使用者 ${user.id} (${user.line_user_id}) 時發生錯誤:`, error);
        }
    }
}

// --- 執行入口 (還原為 V2 的模式) ---
console.log('--- Cron Job Script Started ---');
runReview()
  .then(() => {
    console.log('✅ (Task) 每週回顧任務執行成功。');
    process.exit(0); // 正常退出
  })
  .catch(error => {
    console.error('❌ (Task) 每週回顧任務執行失敗:', error);
    process.exit(1); // 帶有錯誤碼退出
  });