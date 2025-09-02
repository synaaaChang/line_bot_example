//定義資料格式，讓程式知道每種資料長什麼樣子
// LINE Bot 相關型別
export interface LineTextMessage {
  type: 'text';
  text: string;
}

export interface LineImageMessage {
  type: 'image';
  originalContentUrl: string;
  previewImageUrl: string;
}

// 日曆操作意圖
export interface CalendarIntent {
  action: 'list_events' | 'create_event' | 'search_events' | 'update_event' | 'delete_event';
  params: {
    title?: string;
    startTime?: string;
    endTime?: string;
    description?: string;
    location?: string;
    query?: string;
    eventId?: string;
    timeRange?: 'today' | 'tomorrow' | 'week' | 'month';
  };
  confidence: number;
}

// MCP 相關型別
export interface MCPToolCall {
  tool: string;
  arguments: Record<string, any>;
}

export interface MCPResponse {
  success: boolean;
  data?: any;
  error?: string;
}

// Google Calendar 事件型別
export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  location?: string;
  htmlLink: string;
}