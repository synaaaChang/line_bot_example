// src/utils/responseFormatter.ts

// --- 介面定義 (Type Definitions) ---

// 定義 "開始" 或 "結束" 時間物件的長相
// 因為全天事件用 'date'，有具體時間的事件用 'dateTime'，所以兩者都是可選的。
interface EventDateTime {
  date?: string;
  dateTime?: string;
}

// 定義一個從 Google Calendar API 來的事件物件的長相
interface GoogleCalendarEvent {
  summary: string;
  start: EventDateTime;
  end: EventDateTime;
}


// --- 核心函式 ---

/**
 * 將從 Google Calendar API 獲取的事件陣列，格式化成適合在 LINE 中顯示的文字。
 * 這個版本是完全型別安全的。
 */
export function formatEventsForLine(events: GoogleCalendarEvent[]): string {
  if (!events || events.length === 0) {
    return '📅 太好了，這段時間內沒有任何安排！';
  }

  // 步驟 1: 將事件按日期分組
  // 現在 Map 的型別非常明確：key 是字串，value 是 GoogleCalendarEvent 陣列
  const eventsByDate = new Map<string, GoogleCalendarEvent[]>();

  events.forEach(event => {
    const startDateTime = event.start.dateTime || event.start.date;
    // 如果連 startDateTime 都沒有，這是一個無效事件，直接跳過
    if (!startDateTime) return; 

    const eventDate = new Date(startDateTime);
    const dateKey = eventDate.toISOString().split('T')[0];

    if (!eventsByDate.has(dateKey)) {
      eventsByDate.set(dateKey, []);
    }
    eventsByDate.get(dateKey)!.push(event);
  });

  // 步驟 2: 根據分組數量決定輸出格式
  
  if (eventsByDate.size === 1) {
    // 情況 A: 所有事件都在同一天
    // ✨ 修正 `iterator` 錯誤：
    // eventsByDate.entries().next().value 可能被視為 undefined。
    // 但因為我們在 if (size === 1) 的保護下，可以安全地使用 '!' 來告訴 TypeScript "相信我，這裡一定有值"。
    const [dateKey, dailyEvents] = eventsByDate.entries().next().value!;
    const displayDate = new Date(dateKey + 'T00:00:00');
    
    let response = `📅 您在 ${displayDate.toLocaleDateString('zh-TW')} 有 ${dailyEvents.length} 個行程:\n`;
    // ✨ 'event' 和 'index' 的型別現在會被自動推斷，不再報錯！
    dailyEvents.forEach((event, index) => {
      response += `\n${index + 1}. ${event.summary}${formatEventTime(event)}`;
    });
    return response;
  }
  else {
    // 情況 B: 事件跨越多日
    let response = `📅 為您找到跨越多日的 ${events.length} 個行程：\n`;
    const sortedDates = Array.from(eventsByDate.keys()).sort();

    sortedDates.forEach(dateKey => {
      const displayDate = new Date(dateKey + 'T00:00:00');
      const dailyEvents = eventsByDate.get(dateKey)!;
      response += `\n--- ${displayDate.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })} ---\n`;
      
      dailyEvents.forEach(event => {
        response += `  - ${event.summary}${formatEventTime(event)}\n`;
      });
    });
    return response;
  }
}

/**
 * 輔助函式：格式化單一事件的時間部分。
 * 現在接收的是強型別的 GoogleCalendarEvent。
 */
function formatEventTime(event: GoogleCalendarEvent): string {
  if (event.start.dateTime) {
    const startTime = new Date(event.start.dateTime).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
    const endTime = event.end.dateTime 
      ? new Date(event.end.dateTime).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
      : '';
    return endTime ? `\n   🕐 ${startTime} - ${endTime}` : `\n   🕐 ${startTime}`;
  } else {
    return ' (全天)';
  }
}